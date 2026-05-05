import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import { revokeDeviceSessionRequestSchema } from "@safelens/contracts";
import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { DevicesService } from "./devices.service";

@Controller("devices")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  list(@Req() request: SessionRequest) {
    return this.devicesService.listForWorkspace(request.safelensSession.workspaceId);
  }

  @Get("self/session")
  @UseGuards(DeviceAuthGuard)
  getSelf(@Req() request: DeviceRequest) {
    return this.devicesService.getSelfDevice(
      request.safelensDevice.deviceId,
      request.safelensDevice.workspaceId
    );
  }

  @Delete("self/session")
  @UseGuards(DeviceAuthGuard)
  unpairSelf(@Req() request: DeviceRequest) {
    return this.devicesService.deleteSelfDevice(
      request.safelensDevice.deviceId,
      request.safelensDevice.workspaceId
    );
  }

  @Post("self/heartbeat")
  @UseGuards(DeviceAuthGuard)
  heartbeatSelf(@Req() request: DeviceRequest) {
    return this.devicesService.heartbeatSelfSession(
      request.safelensDevice.deviceId,
      request.safelensDevice.workspaceId
    );
  }

  @Get(":id")
  @UseGuards(SessionAuthGuard)
  get(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.devicesService.getForWorkspace(
      request.safelensSession.workspaceId,
      deviceId
    );
  }

  @Delete(":id")
  @UseGuards(SessionAuthGuard)
  remove(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.devicesService.deleteDevice(
      request.safelensSession.workspaceId,
      deviceId
    );
  }

  @Post(":id/revoke-session")
  @UseGuards(SessionAuthGuard)
  revokeSession(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Body() body: unknown
  ) {
    const payload = parseSchema(revokeDeviceSessionRequestSchema, body);
    return this.devicesService.revokeSession(
      request.safelensSession.workspaceId,
      deviceId,
      payload.reason
    );
  }
}
