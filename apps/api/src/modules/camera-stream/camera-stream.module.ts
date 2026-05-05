import { forwardRef, Module } from "@nestjs/common";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { CoreModule } from "../../core/core.module";
import { AuditModule } from "../audit/audit.module";
import { DevicesModule } from "../devices/devices.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { CameraStreamController } from "./camera-stream.controller";
import { CameraStreamService } from "./camera-stream.service";

@Module({
  imports: [CoreModule, DevicesModule, AuditModule, forwardRef(() => RealtimeModule)],
  controllers: [CameraStreamController],
  providers: [CameraStreamService, DeviceAuthGuard],
  exports: [CameraStreamService]
})
export class CameraStreamModule {}
