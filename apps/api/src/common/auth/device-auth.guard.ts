import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";

import { DevicesService } from "../../modules/devices/devices.service";
import { DeviceRequest } from "./device-request";

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly devicesService: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing device bearer token.");
    }

    const deviceToken = authorization.slice("Bearer ".length).trim();
    const session = await this.devicesService.getActiveDeviceSession(deviceToken);

    if (!session) {
      throw new UnauthorizedException("Device token is invalid or expired.");
    }

    request.safelensDevice = {
      deviceToken,
      deviceId: session.deviceId,
      workspaceId: session.workspaceId
    };

    return true;
  }
}
