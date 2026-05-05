import { Global, Module } from "@nestjs/common";

import { DatabaseSchemaGuardService } from "./database-schema-guard.service";
import { EphemeralStateService } from "./ephemeral-state.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, EphemeralStateService, DatabaseSchemaGuardService],
  exports: [PrismaService, EphemeralStateService]
})
export class CoreModule {}
