import { Module } from "@nestjs/common";

import { CoreModule } from "../../core/core.module";
import { AuditModule } from "../audit/audit.module";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [CoreModule, UsersModule, WorkspacesModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
