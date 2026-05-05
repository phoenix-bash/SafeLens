import { Module } from "@nestjs/common";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { CoreModule } from "../../core/core.module";
import { DevicesModule } from "../devices/devices.module";
import { CallLogsController } from "./call-logs.controller";
import { CallLogsService } from "./call-logs.service";

@Module({
  imports: [CoreModule, DevicesModule],
  controllers: [CallLogsController],
  providers: [CallLogsService, DeviceAuthGuard],
  exports: [CallLogsService]
})
export class CallLogsModule {}
