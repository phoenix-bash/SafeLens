import { Module } from "@nestjs/common";

import { CoreModule } from "../../core/core.module";
import { AuditModule } from "../audit/audit.module";
import { DevicesModule } from "../devices/devices.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { PairingController } from "./pairing.controller";
import { PairingService } from "./pairing.service";

@Module({
  imports: [CoreModule, DevicesModule, AuditModule, RealtimeModule],
  controllers: [PairingController],
  providers: [PairingService]
})
export class PairingModule {}
