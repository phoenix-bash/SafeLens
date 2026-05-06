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
  callRecordingBatchIngestRequestSchema,
  callRecordingsDownloadRequestSchema,
  callRecordingsQuerySchema
} from "@safelens/contracts";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { CallRecordingsService } from "./call-recordings.service";

@Controller("devices")
export class CallRecordingsController {
  constructor(private readonly callRecordingsService: CallRecordingsService) {}

  @Post("self/call-recordings/batches")
  @UseGuards(DeviceAuthGuard)
  ingestBatch(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(callRecordingBatchIngestRequestSchema, body);
    return this.callRecordingsService.ingestBatch(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Get(":id/call-recordings")
  @UseGuards(SessionAuthGuard)
  listForDevice(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Query() query: Record<string, string | undefined>
  ) {
    const payload = parseSchema(callRecordingsQuerySchema, query);
    return this.callRecordingsService.listForDevice(
      request.safelensSession.workspaceId,
      deviceId,
      payload
    );
  }

  @Post(":id/call-recordings/download")
  @UseGuards(SessionAuthGuard)
  listForDownload(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Body() body: unknown
  ) {
    const payload = parseSchema(callRecordingsDownloadRequestSchema, body);
    return this.callRecordingsService.listForDownload(
      request.safelensSession.workspaceId,
      deviceId,
      payload
    );
  }

  @Delete(":id/call-recordings")
  @UseGuards(SessionAuthGuard)
  clearForDevice(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.callRecordingsService.clearForDevice(
      request.safelensSession.workspaceId,
      deviceId
    );
  }
}
