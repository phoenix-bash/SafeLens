import { Module } from "@nestjs/common";

import { CoreModule } from "../../core/core.module";
import { UsersService } from "./users.service";

@Module({
  imports: [CoreModule],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
