import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  createDeviceCommandRequestSchema,
  deviceCommandAckRequestSchema
} from "@safelens/contracts";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { DeviceRuntimeService } from "./device-runtime.service";

@Controller("devices")
export class DeviceRuntimeController {
  constructor(private readonly deviceRuntimeService: DeviceRuntimeService) {}

  @Post(":id/commands")
  @UseGuards(SessionAuthGuard)
  createCommand(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Body() body: unknown
  ) {
    const payload = parseSchema(createDeviceCommandRequestSchema, body);
    return this.deviceRuntimeService.createCommand(
      request.safelensSession.workspaceId,
      deviceId,
      {
        ...payload,
        payload: payload.payload ?? {}
      }
    );
  }

  @Get("self/commands")
  @UseGuards(DeviceAuthGuard)
  listPendingCommands(@Req() request: DeviceRequest) {
    return this.deviceRuntimeService.listPendingCommands(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId
    );
  }

  @Post("self/commands/:id/ack")
  @UseGuards(DeviceAuthGuard)
  acknowledgeCommand(
    @Req() request: DeviceRequest,
    @Param("id") commandId: string,
    @Body() body: unknown
  ) {
    const payload = parseSchema(deviceCommandAckRequestSchema, body);
    return this.deviceRuntimeService.acknowledgeCommand(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      commandId,
      payload
    );
  }
}
