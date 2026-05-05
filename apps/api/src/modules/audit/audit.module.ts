import { Module } from "@nestjs/common";

import { CoreModule } from "../../core/core.module";
import { AuditService } from "./audit.service";

@Module({
  imports: [CoreModule],
  providers: [AuditService],
  exports: [AuditService]
})
export class AuditModule {}
