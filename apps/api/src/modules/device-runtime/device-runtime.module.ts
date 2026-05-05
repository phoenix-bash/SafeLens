import { Module } from "@nestjs/common";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { CoreModule } from "../../core/core.module";
import { AuditModule } from "../audit/audit.module";
import { DevicesModule } from "../devices/devices.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { DeviceRuntimeController } from "./device-runtime.controller";
import { DeviceRuntimeService } from "./device-runtime.service";

@Module({
  imports: [CoreModule, AuditModule, RealtimeModule, DevicesModule],
  controllers: [DeviceRuntimeController],
  providers: [DeviceRuntimeService, DeviceAuthGuard],
  exports: [DeviceRuntimeService]
})
export class DeviceRuntimeModule {}
