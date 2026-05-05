import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  callLogBatchIngestRequestSchema,
  callLogsQuerySchema
} from "@safelens/contracts";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { CallLogsService } from "./call-logs.service";

@Controller("devices")
export class CallLogsController {
  constructor(private readonly callLogsService: CallLogsService) {}

  @Post("self/call-logs/batches")
  @UseGuards(DeviceAuthGuard)
  ingestBatch(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(callLogBatchIngestRequestSchema, body);
    return this.callLogsService.ingestBatch(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Get(":id/call-logs")
  @UseGuards(SessionAuthGuard)
  listForDevice(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Query() query: Record<string, string | undefined>
  ) {
    const payload = parseSchema(callLogsQuerySchema, query);
    return this.callLogsService.listForDevice(
      request.safelensSession.workspaceId,
      deviceId,
      payload
    );
  }

  @Delete(":id/call-logs")
  @UseGuards(SessionAuthGuard)
  clearForDevice(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.callLogsService.clearForDevice(
      request.safelensSession.workspaceId,
      deviceId
    );
  }
}
