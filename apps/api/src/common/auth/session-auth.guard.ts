import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";

import { EphemeralStateService } from "../../core/ephemeral-state.service";
import { SessionRequest } from "./session-request";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly ephemeralState: EphemeralStateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const accessToken = authorization.slice("Bearer ".length).trim();
    const session = await this.ephemeralState.getAccessSession(accessToken);

    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }

    request.safelensSession = {
      accessToken,
      userId: session.userId,
      workspaceId: session.workspaceId
    };

    return true;
  }
}
