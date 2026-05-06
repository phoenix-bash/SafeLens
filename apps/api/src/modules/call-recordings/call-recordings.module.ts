import { Module } from "@nestjs/common";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { CoreModule } from "../../core/core.module";
import { DevicesModule } from "../devices/devices.module";
import { CallRecordingsController } from "./call-recordings.controller";
import { CallRecordingsService } from "./call-recordings.service";

@Module({
  imports: [CoreModule, DevicesModule],
  controllers: [CallRecordingsController],
  providers: [CallRecordingsService, DeviceAuthGuard],
  exports: [CallRecordingsService]
})
export class CallRecordingsModule {}
