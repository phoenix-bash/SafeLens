import { Module } from "@nestjs/common";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { CoreModule } from "../../core/core.module";
import { DevicesModule } from "../devices/devices.module";
import { DeviceTelemetryController } from "./device-telemetry.controller";
import { DeviceTelemetryService } from "./device-telemetry.service";

@Module({
  imports: [CoreModule, DevicesModule],
  controllers: [DeviceTelemetryController],
  providers: [DeviceTelemetryService, DeviceAuthGuard],
  exports: [DeviceTelemetryService]
})
export class DeviceTelemetryModule {}
