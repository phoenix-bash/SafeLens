import { forwardRef, Module } from "@nestjs/common";

import { CameraStreamModule } from "../camera-stream/camera-stream.module";
import { CoreModule } from "../../core/core.module";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

@Module({
  imports: [CoreModule, forwardRef(() => CameraStreamModule)],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService]
})
export class RealtimeModule {}
