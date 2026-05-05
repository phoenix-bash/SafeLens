import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppController } from "./app.controller";
import { CoreModule } from "./core/core.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CameraStreamModule } from "./modules/camera-stream/camera-stream.module";
import { CallLogsModule } from "./modules/call-logs/call-logs.module";
import { DevicesModule } from "./modules/devices/devices.module";
import { DeviceRuntimeModule } from "./modules/device-runtime/device-runtime.module";
import { DeviceTelemetryModule } from "./modules/device-telemetry/device-telemetry.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { PairingModule } from "./modules/pairing/pairing.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    CoreModule,
    UsersModule,
    WorkspacesModule,
    AuditModule,
    CameraStreamModule,
    CallLogsModule,
    RealtimeModule,
    AuthModule,
    DevicesModule,
    DeviceRuntimeModule,
    DeviceTelemetryModule,
    NotificationsModule,
    PairingModule
  ],
  controllers: [AppController]
})
export class AppModule {}
