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
  notificationBatchIngestRequestSchema,
  notificationsQuerySchema
} from "@safelens/contracts";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { NotificationsService } from "./notifications.service";

@Controller("devices")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post("self/notifications/batches")
  @UseGuards(DeviceAuthGuard)
  ingestBatch(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(notificationBatchIngestRequestSchema, body);
    return this.notificationsService.ingestBatch(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Get(":id/notifications")
  @UseGuards(SessionAuthGuard)
  listForDevice(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Query() query: Record<string, string | undefined>
  ) {
    const payload = parseSchema(notificationsQuerySchema, query);
    return this.notificationsService.listForDevice(
      request.safelensSession.workspaceId,
      deviceId,
      payload
    );
  }

  @Delete(":id/notifications")
  @UseGuards(SessionAuthGuard)
  clearForDevice(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.notificationsService.clearForDevice(
      request.safelensSession.workspaceId,
      deviceId
    );
  }
}
