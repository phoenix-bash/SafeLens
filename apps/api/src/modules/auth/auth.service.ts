import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import {
  AuthSession,
  UserSummary,
  WorkspaceSummary
} from "@safelens/contracts";
import { AccessSessionRecord } from "../../core/platform.types";
import { EphemeralStateService } from "../../core/ephemeral-state.service";
import { PrismaService } from "../../core/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UsersService } from "../users/users.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

interface GoogleProfile {
  email: string;
  sub: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ephemeralState: EphemeralStateService,
    private readonly usersService: UsersService,
    private readonly workspacesService: WorkspacesService,
    private readonly auditService: AuditService
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<AuthSession> {
    const normalizedEmail = input.email.toLowerCase();
    const existingUser = await this.usersService.getByEmail(normalizedEmail);

    if (existingUser) {
      throw new ConflictException("An account with this email already exists.");
    }

    const { user, workspace } = await this.prisma.$transaction(async (tx: any) => {
      const userRecord = await tx.user.create({
        data: {
          email: normalizedEmail,
          displayName: input.displayName
        }
      });
      const workspaceRecord = await tx.workspace.create({
        data: {
          ownerUserId: userRecord.id,
          name: `${input.displayName}'s Workspace`
        }
      });
      await tx.authIdentity.create({
        data: {
          userId: userRecord.id,
          provider: "password",
          providerSubject: normalizedEmail,
          email: normalizedEmail,
          passwordHash: this.hashPassword(input.password)
        }
      });

      return { user: userRecord, workspace: workspaceRecord };
    });

    await this.auditService.record({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      eventType: "auth.registered",
      payload: { email: user.email }
    });

    return this.issueAuthSession(user.id, workspace.id);
  }

  async login(input: { email: string; password: string }): Promise<AuthSession> {
    const normalizedEmail = input.email.toLowerCase();
    const identity = await this.prisma.authIdentity.findFirst({
      where: {
        provider: "password",
        email: normalizedEmail
      }
    });

    if (!identity?.passwordHash) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (!this.verifyPassword(input.password, identity.passwordHash)) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    return this.issueAuthSession(
      identity.userId,
      await this.requireWorkspaceId(identity.userId)
    );
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    if (
      !token ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Refresh token is invalid or expired.");
    }

    await this.prisma.refreshToken.update({
      where: { token: refreshToken },
      data: {
        revokedAt: new Date()
      }
    });

    return this.issueAuthSession(token.userId, token.workspaceId);
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          token: refreshToken
        },
        data: {
          revokedAt: new Date()
        }
      });
    }

    return { success: true };
  }

  async exchangeGoogleCallback(params: {
    code?: string;
    state?: string;
    mockEmail?: string;
    mockName?: string;
  }) {
    const profile = params.mockEmail
      ? this.buildMockGoogleProfile(params.mockEmail, params.mockName)
      : await this.fetchGoogleProfile(params.code);

    const session = await this.upsertGoogleIdentity(profile);
    const returnTo = this.parseState(params.state);
    const encodedSession = Buffer.from(JSON.stringify(session), "utf8").toString(
      "base64url"
    );

    return `${returnTo}#session=${encodeURIComponent(encodedSession)}`;
  }

  buildGoogleStartUrl(returnTo?: string) {
    const target =
      returnTo ||
      this.configService.get("GOOGLE_DEFAULT_RETURN_TO") ||
      "http://localhost:3000/auth/callback";
    const state = Buffer.from(JSON.stringify({ returnTo: target }), "utf8").toString(
      "base64url"
    );
    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
    const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");
    const useMock = this.configService.get<string>("ENABLE_GOOGLE_DEV_MOCK") === "true";

    if (!clientId || !redirectUri || useMock) {
      const callbackUrl = new URL(
        redirectUri || "http://localhost:4000/auth/google/callback"
      );
      callbackUrl.searchParams.set("mock_email", "developer@safelens.local");
      callbackUrl.searchParams.set("mock_name", "SafeLens Developer");
      callbackUrl.searchParams.set("state", state);
      return callbackUrl.toString();
    }

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return url.toString();
  }

  getSessionByAccessToken(accessToken: string): Promise<AccessSessionRecord | undefined> {
    return this.ephemeralState.getAccessSession(accessToken);
  }

  private async upsertGoogleIdentity(profile: GoogleProfile): Promise<AuthSession> {
    const normalizedEmail = profile.email.toLowerCase();
    const existingIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: "google",
          providerSubject: profile.sub
        }
      }
    });

    if (existingIdentity) {
      const workspaceId = await this.requireWorkspaceId(existingIdentity.userId);
      await this.auditService.record({
        workspaceId,
        actorType: "user",
        actorId: existingIdentity.userId,
        eventType: "auth.google_login",
        payload: { email: normalizedEmail }
      });
      return this.issueAuthSession(existingIdentity.userId, workspaceId);
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      let user = await tx.user.findUnique({
        where: { email: normalizedEmail }
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: normalizedEmail,
            displayName: profile.name
          }
        });
      }

      let workspace = await tx.workspace.findUnique({
        where: { ownerUserId: user.id }
      });

      if (!workspace) {
        workspace = await tx.workspace.create({
          data: {
            ownerUserId: user.id,
            name: `${user.displayName}'s Workspace`
          }
        });
      }

      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: "google",
          providerSubject: profile.sub,
          email: normalizedEmail
        }
      });

      return { user, workspace };
    });

    await this.auditService.record({
      workspaceId: result.workspace.id,
      actorType: "user",
      actorId: result.user.id,
      eventType: "auth.google_login",
      payload: { email: normalizedEmail }
    });

    return this.issueAuthSession(result.user.id, result.workspace.id);
  }

  private parseState(state?: string) {
    const fallback =
      this.configService.get<string>("GOOGLE_DEFAULT_RETURN_TO") ||
      "http://localhost:3000/auth/callback";

    if (!state) {
      return fallback;
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8")
      ) as { returnTo?: string };
      return decoded.returnTo || fallback;
    } catch {
      return fallback;
    }
  }

  private async fetchGoogleProfile(code?: string): Promise<GoogleProfile> {
    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = this.configService.get<string>("GOOGLE_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");

    if (!code || !clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException("Google OAuth is not configured correctly.");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });

    if (!tokenResponse.ok) {
      throw new BadRequestException("Failed to exchange Google authorization code.");
    }

    const tokenPayload = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenPayload.access_token) {
      throw new BadRequestException("Google token payload did not include an access token.");
    }

    const userinfoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`
        }
      }
    );

    if (!userinfoResponse.ok) {
      throw new BadRequestException("Failed to read Google user profile.");
    }

    const userinfo = (await userinfoResponse.json()) as GoogleProfile;

    if (!userinfo.email || !userinfo.sub || !userinfo.name) {
      throw new BadRequestException("Google user profile is incomplete.");
    }

    return userinfo;
  }

  private buildMockGoogleProfile(mockEmail: string, mockName?: string): GoogleProfile {
    return {
      email: mockEmail.toLowerCase(),
      sub: `mock-${mockEmail.toLowerCase()}`,
      name: mockName || "SafeLens Developer"
    };
  }

  private async issueAuthSession(userId: string, workspaceId: string): Promise<AuthSession> {
    const accessToken = randomBytes(24).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const accessTtlMinutes = this.getNumber("ACCESS_TOKEN_TTL_MINUTES", 15);
    const refreshTtlDays = this.getNumber("REFRESH_TOKEN_TTL_DAYS", 30);
    const accessExpiresAt = new Date(
      Date.now() + accessTtlMinutes * 60_000
    ).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + refreshTtlDays * 24 * 60 * 60_000
    );

    await this.ephemeralState.storeAccessSession(
      {
        token: accessToken,
        userId,
        workspaceId,
        expiresAt: accessExpiresAt
      },
      accessTtlMinutes * 60
    );

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        workspaceId,
        expiresAt: refreshExpiresAt
      }
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: accessExpiresAt,
      user: await this.toUserSummary(userId),
      workspace: await this.toWorkspaceSummary(workspaceId)
    };
  }

  private async toUserSummary(userId: string): Promise<UserSummary> {
    const user = await this.usersService.getById(userId);

    if (!user) {
      throw new UnauthorizedException("User account no longer exists.");
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString()
    };
  }

  private async toWorkspaceSummary(workspaceId: string): Promise<WorkspaceSummary> {
    const workspace = await this.workspacesService.getById(workspaceId);

    if (!workspace) {
      throw new UnauthorizedException("Workspace no longer exists.");
    }

    return {
      id: workspace.id,
      name: workspace.name,
      ownerUserId: workspace.ownerUserId,
      createdAt: workspace.createdAt.toISOString()
    };
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, encoded: string) {
    const [salt, expectedHash] = encoded.split(":");

    if (!salt || !expectedHash) {
      return false;
    }

    const actualHash = scryptSync(password, salt, 64);
    return timingSafeEqual(actualHash, Buffer.from(expectedHash, "hex"));
  }

  private async requireWorkspaceId(userId: string) {
    const workspace = await this.workspacesService.getByOwnerUserId(userId);

    if (!workspace) {
      throw new UnauthorizedException("Workspace not found.");
    }

    return workspace.id;
  }

  private getNumber(key: string, fallback: number) {
    const rawValue = this.configService.get<string>(key);
    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
