import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it } from "vitest";

import { EphemeralStateService } from "../src/core/ephemeral-state.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { DevicesService } from "../src/modules/devices/devices.service";
import { PairingService } from "../src/modules/pairing/pairing.service";
import { RealtimeService } from "../src/modules/realtime/realtime.service";
import { UsersService } from "../src/modules/users/users.service";
import { WorkspacesService } from "../src/modules/workspaces/workspaces.service";

class FakePrismaService {
  users: any[] = [];
  workspaces: any[] = [];
  identities: any[] = [];
  refreshTokens: any[] = [];
  devices: any[] = [];
  deviceSessions: any[] = [];
  auditEvents: any[] = [];

  user = {
    create: async ({ data }: any) => {
      const user = {
        id: crypto.randomUUID(),
        email: data.email,
        displayName: data.displayName,
        createdAt: new Date()
      };
      this.users.push(user);
      return user;
    },
    findUnique: async ({ where }: any) => {
      if (where.id) {
        return this.users.find((user) => user.id === where.id) ?? null;
      }
      if (where.email) {
        return this.users.find((user) => user.email === where.email) ?? null;
      }
      return null;
    }
  };

  workspace = {
    create: async ({ data }: any) => {
      const workspace = {
        id: crypto.randomUUID(),
        name: data.name,
        ownerUserId: data.ownerUserId,
        createdAt: new Date()
      };
      this.workspaces.push(workspace);
      return workspace;
    },
    findUnique: async ({ where }: any) => {
      if (where.id) {
        return this.workspaces.find((workspace) => workspace.id === where.id) ?? null;
      }
      if (where.ownerUserId) {
        return (
          this.workspaces.find(
            (workspace) => workspace.ownerUserId === where.ownerUserId
          ) ?? null
        );
      }
      return null;
    }
  };

  authIdentity = {
    create: async ({ data }: any) => {
      const identity = {
        id: crypto.randomUUID(),
        ...data
      };
      this.identities.push(identity);
      return identity;
    },
    findFirst: async ({ where }: any) =>
      this.identities.find(
        (identity) =>
          identity.provider === where.provider && identity.email === where.email
      ) ?? null,
    findUnique: async ({ where }: any) =>
      this.identities.find(
        (identity) =>
          identity.provider === where.provider_providerSubject.provider &&
          identity.providerSubject === where.provider_providerSubject.providerSubject
      ) ?? null
  };

  refreshToken = {
    create: async ({ data }: any) => {
      const token = { ...data, revokedAt: null };
      this.refreshTokens.push(token);
      return token;
    },
    findUnique: async ({ where }: any) =>
      this.refreshTokens.find((token) => token.token === where.token) ?? null,
    update: async ({ where, data }: any) => {
      const token = this.refreshTokens.find((item) => item.token === where.token);
      Object.assign(token, data);
      return token;
    },
    updateMany: async ({ where, data }: any) => {
      this.refreshTokens
        .filter((token) => token.token === where.token)
        .forEach((token) => Object.assign(token, data));
      return { count: 1 };
    }
  };

  device = {
    findMany: async ({ where }: any) =>
      this.devices
        .filter((device) => device.workspaceId === where.workspaceId)
        .map((device) => ({
          ...device,
          sessions: this.deviceSessions
            .filter((session) => session.deviceId === device.id)
            .map((session) => ({
              id: session.id,
              revokedAt: session.revokedAt ?? null
            }))
        })),
    findFirst: async ({ where }: any) =>
      (() => {
        const device =
          this.devices.find(
            (item) =>
              (where.id ? item.id === where.id : true) &&
              (where.workspaceId ? item.workspaceId === where.workspaceId : true) &&
              (where.fingerprint ? item.fingerprint === where.fingerprint : true)
          ) ?? null;

        if (!device) {
          return null;
        }

        return {
          ...device,
          sessions: this.deviceSessions
            .filter((session) => session.deviceId === device.id)
            .map((session) => ({
              id: session.id,
              revokedAt: session.revokedAt ?? null
            }))
        };
      })(),
    create: async ({ data }: any) => {
      const device = {
        id: data.id,
        workspaceId: data.workspaceId,
        fingerprint: data.fingerprint ?? null,
        name: data.name,
        model: data.model,
        manufacturer: data.manufacturer,
        androidVersion: data.androidVersion,
        pairedAt: data.pairedAt,
        lastSeenAt: data.lastSeenAt,
        isOnline: data.isOnline,
        activeSessionId: data.activeSessionId,
        capabilities: data.capabilities.create
      };
      this.devices.push(device);
      return device;
    },
    update: async ({ where, data }: any) => {
      const device = this.devices.find((item) => item.id === where.id);
      if (data.capabilities?.deleteMany) {
        device.capabilities = [];
      }
      if (data.capabilities?.create) {
        device.capabilities = data.capabilities.create;
      }
      const { capabilities, ...deviceData } = data;
      Object.assign(device, deviceData);
      return device;
    },
    updateMany: async ({ where, data }: any) => {
      this.devices
        .filter((device) =>
          (where.workspaceId ? device.workspaceId === where.workspaceId : true) &&
          (where.isOnline !== undefined ? device.isOnline === where.isOnline : true) &&
          (where.lastSeenAt?.lt ? device.lastSeenAt < where.lastSeenAt.lt : true)
        )
        .forEach((device) => Object.assign(device, data));
      return { count: 1 };
    },
    delete: async ({ where }: any) => {
      const index = this.devices.findIndex((device) => device.id === where.id);
      const [deleted] = this.devices.splice(index, 1);
      this.deviceSessions = this.deviceSessions.filter(
        (session) => session.deviceId !== where.id
      );
      return deleted;
    }
  };

  deviceSession = {
    create: async ({ data }: any) => {
      const session = {
        revokedAt: null,
        ...data
      };
      this.deviceSessions.push(session);
      return session;
    },
    findUnique: async ({ where }: any) =>
      this.deviceSessions.find((session) => session.deviceToken === where.deviceToken) ??
      null,
    updateMany: async ({ where, data }: any) => {
      this.deviceSessions
        .filter((session) =>
          (where.id ? session.id === where.id : true) &&
          (where.deviceId ? session.deviceId === where.deviceId : true) &&
          (where.workspaceId ? session.workspaceId === where.workspaceId : true) &&
          (where.revokedAt === null ? session.revokedAt === null : true)
        )
        .forEach((session) => Object.assign(session, data));
      return { count: 1 };
    }
  };

  auditEvent = {
    create: async ({ data }: any) => {
      this.auditEvents.push(data);
      return data;
    }
  };

  $transaction = async (callback: (tx: any) => Promise<any>) => callback(this);
}

describe("auth and pairing flow", () => {
  let prisma: FakePrismaService;
  let authService: AuthService;
  let pairingService: PairingService;
  let devicesService: DevicesService;

  beforeEach(() => {
    const configService = new ConfigService({
      ACCESS_TOKEN_TTL_MINUTES: "15",
      REFRESH_TOKEN_TTL_DAYS: "30",
      PAIRING_CODE_TTL_MINUTES: "10",
      ENABLE_GOOGLE_DEV_MOCK: "true",
      GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
      GOOGLE_DEFAULT_RETURN_TO: "http://localhost:3000/auth/callback"
    });
    prisma = new FakePrismaService();
    const ephemeralState = new EphemeralStateService(
      new ConfigService({})
    );
    const auditService = new AuditService(prisma as any);
    const usersService = new UsersService(prisma as any);
    const workspacesService = new WorkspacesService(prisma as any);
    const realtimeService = new RealtimeService();
    devicesService = new DevicesService(
      configService,
      prisma as any,
      auditService,
      realtimeService
    );
    authService = new AuthService(
      configService,
      prisma as any,
      ephemeralState,
      usersService,
      workspacesService,
      auditService
    );
    pairingService = new PairingService(
      configService,
      ephemeralState,
      devicesService,
      auditService,
      realtimeService
    );
  });

  it("registers a user and creates a workspace", async () => {
    const session = await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    expect(session.user.email).toBe("owner@example.com");
    expect(session.workspace.ownerUserId).toBe(session.user.id);
  });

  it("rejects duplicate registration", async () => {
    await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    await expect(
      authService.register({
        email: "owner@example.com",
        password: "SafeLens123",
        displayName: "Owner"
      })
    ).rejects.toThrowError(/already exists/i);
  });

  it("creates a code and pairs one device to the workspace", async () => {
    const session = await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    const pairingCode = await pairingService.createPairingCode({
      workspaceId: session.workspace.id,
      userId: session.user.id
    });
    const result = await pairingService.pairDevice({
      code: pairingCode.code,
      deviceName: "Pixel 9 Pro",
      model: "Pixel 9 Pro",
      manufacturer: "Google",
      androidVersion: "15",
      deviceFingerprint: "f".repeat(64),
      capabilities: [
        { key: "camera", label: "Camera Control", status: "available" },
        { key: "location", label: "Location", status: "available" }
      ]
    });

    expect(result.workspaceId).toBe(session.workspace.id);
    const devices = await devicesService.listForWorkspace(session.workspace.id);

    expect(devices).toHaveLength(1);
    expect(devices[0]?.isPaired).toBe(true);
  });

  it("keeps device sessions valid until they are explicitly revoked", async () => {
    const session = await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    const pairingCode = await pairingService.createPairingCode({
      workspaceId: session.workspace.id,
      userId: session.user.id
    });

    const pairResult = await pairingService.pairDevice({
      code: pairingCode.code,
      deviceName: "Pixel 9 Pro",
      model: "Pixel 9 Pro",
      manufacturer: "Google",
      androidVersion: "15",
      deviceFingerprint: "e".repeat(64),
      capabilities: [
        { key: "camera", label: "Camera Control", status: "available" }
      ]
    });

    prisma.deviceSessions[0]!.expiresAt = new Date(Date.now() - 60_000);

    const activeSession = await devicesService.getActiveDeviceSession(
      pairResult.deviceToken
    );

    expect(activeSession?.deviceId).toBe(pairResult.deviceId);

    await devicesService.revokeSession(session.workspace.id, pairResult.deviceId);

    const revokedSession = await devicesService.getActiveDeviceSession(
      pairResult.deviceToken
    );

    expect(revokedSession).toBeNull();
  });

  it("reuses the existing device record when the same device pairs again", async () => {
    const session = await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    const firstPairingCode = await pairingService.createPairingCode({
      workspaceId: session.workspace.id,
      userId: session.user.id
    });
    const firstPair = await pairingService.pairDevice({
      code: firstPairingCode.code,
      deviceName: "Pixel 9 Pro",
      model: "Pixel 9 Pro",
      manufacturer: "Google",
      androidVersion: "15",
      deviceFingerprint: "a".repeat(64),
      capabilities: [
        { key: "camera", label: "Camera Control", status: "available" }
      ]
    });

    const secondPairingCode = await pairingService.createPairingCode({
      workspaceId: session.workspace.id,
      userId: session.user.id
    });
    const secondPair = await pairingService.pairDevice({
      code: secondPairingCode.code,
      deviceName: "Pixel 9 Pro",
      model: "Pixel 9 Pro",
      manufacturer: "Google",
      androidVersion: "15",
      deviceFingerprint: "a".repeat(64),
      capabilities: [
        { key: "location", label: "Location", status: "available" }
      ]
    });

    expect(secondPair.deviceId).toBe(firstPair.deviceId);
    expect(prisma.devices).toHaveLength(1);

    const revokedSession = await devicesService.getActiveDeviceSession(
      firstPair.deviceToken
    );
    const activeSession = await devicesService.getActiveDeviceSession(
      secondPair.deviceToken
    );

    expect(revokedSession).toBeNull();
    expect(activeSession?.deviceId).toBe(firstPair.deviceId);
    expect(prisma.devices[0]?.capabilities).toEqual([
      { key: "location", label: "Location", status: "available" }
    ]);
  });

  it("adopts a legacy device row without a fingerprint and removes duplicate registry entries", async () => {
    const session = await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    prisma.devices.push({
      id: "legacy-device-id",
      workspaceId: session.workspace.id,
      fingerprint: null,
      name: "Pixel 9 Pro",
      model: "Pixel 9 Pro",
      manufacturer: "Google",
      androidVersion: "15",
      pairedAt: new Date(Date.now() - 60_000),
      lastSeenAt: new Date(Date.now() - 60_000),
      isOnline: false,
      activeSessionId: null,
      capabilities: [{ key: "camera", label: "Camera Control", status: "available" }]
    });

    const pairingCode = await pairingService.createPairingCode({
      workspaceId: session.workspace.id,
      userId: session.user.id
    });
    const pairResult = await pairingService.pairDevice({
      code: pairingCode.code,
      deviceName: "Pixel 9 Pro",
      model: "Pixel 9 Pro",
      manufacturer: "Google",
      androidVersion: "15",
      deviceFingerprint: "b".repeat(64),
      capabilities: [
        { key: "location", label: "Location", status: "available" }
      ]
    });

    expect(pairResult.deviceId).toBe("legacy-device-id");
    expect(prisma.devices).toHaveLength(1);
    expect(prisma.devices[0]?.fingerprint).toBe("b".repeat(64));
    expect(prisma.devices[0]?.capabilities).toEqual([
      { key: "location", label: "Location", status: "available" }
    ]);
  });

  it("does not delete duplicate legacy device rows when listing the registry", async () => {
    const session = await authService.register({
      email: "owner@example.com",
      password: "SafeLens123",
      displayName: "Owner"
    });

    prisma.devices.push(
      {
        id: "legacy-device-new",
        workspaceId: session.workspace.id,
        fingerprint: null,
        name: "SafeLens on 2412DPC0AG",
        model: "2412DPC0AG",
        manufacturer: "Xiaomi",
        androidVersion: "16",
        pairedAt: new Date("2026-04-07T08:22:08.978Z"),
        lastSeenAt: new Date("2026-04-07T08:23:09.293Z"),
        isOnline: false,
        activeSessionId: "session-new",
        capabilities: [{ key: "camera", label: "Camera Control", status: "available" }]
      },
      {
        id: "legacy-device-old",
        workspaceId: session.workspace.id,
        fingerprint: null,
        name: "SafeLens on 2412DPC0AG",
        model: "2412DPC0AG",
        manufacturer: "Xiaomi",
        androidVersion: "16",
        pairedAt: new Date("2026-04-07T08:21:45.339Z"),
        lastSeenAt: new Date("2026-04-07T08:22:08.170Z"),
        isOnline: false,
        activeSessionId: "session-old",
        capabilities: [{ key: "camera", label: "Camera Control", status: "available" }]
      }
    );

    prisma.deviceSessions.push(
      {
        id: "session-new",
        deviceId: "legacy-device-new",
        workspaceId: session.workspace.id,
        deviceToken: "token-new",
        expiresAt: new Date(Date.now() + 60_000),
        lastSeenAt: new Date("2026-04-07T08:23:09.293Z"),
        revokedAt: null
      },
      {
        id: "session-old",
        deviceId: "legacy-device-old",
        workspaceId: session.workspace.id,
        deviceToken: "token-old",
        expiresAt: new Date(Date.now() + 60_000),
        lastSeenAt: new Date("2026-04-07T08:22:08.170Z"),
        revokedAt: null
      }
    );

    const devices = await devicesService.listForWorkspace(session.workspace.id);

    expect(devices).toHaveLength(2);
    expect(prisma.devices).toHaveLength(2);
    expect(prisma.devices.some((device) => device.id === "legacy-device-new")).toBe(true);
    expect(prisma.devices.some((device) => device.id === "legacy-device-old")).toBe(true);
  });
});
