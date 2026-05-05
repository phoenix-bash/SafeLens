import { Module } from "@nestjs/common";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { CoreModule } from "../../core/core.module";
import { DevicesModule } from "../devices/devices.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [CoreModule, DevicesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, DeviceAuthGuard],
  exports: [NotificationsService]
})
export class NotificationsModule {}
