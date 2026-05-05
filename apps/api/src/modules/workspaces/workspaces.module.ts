import { Module } from "@nestjs/common";

import { CoreModule } from "../../core/core.module";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [CoreModule],
  providers: [WorkspacesService],
  exports: [WorkspacesService]
})
export class WorkspacesModule {}
