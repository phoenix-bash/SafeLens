import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { telemetryBatchIngestRequestSchema } from "@safelens/contracts";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { DeviceTelemetryService } from "./device-telemetry.service";

@Controller("devices")
export class DeviceTelemetryController {
  constructor(private readonly deviceTelemetryService: DeviceTelemetryService) {}

  @Post("self/telemetry/batches")
  @UseGuards(DeviceAuthGuard)
  ingestBatch(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(telemetryBatchIngestRequestSchema, body);
    return this.deviceTelemetryService.ingestBatch(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Get(":id/telemetry")
  @UseGuards(SessionAuthGuard)
  getState(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.deviceTelemetryService.getState(
      request.safelensSession.workspaceId,
      deviceId
    );
  }
}
