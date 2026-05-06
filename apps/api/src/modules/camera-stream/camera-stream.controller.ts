import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  cameraStreamAudioChunkUploadSchema,
  cameraStreamDeviceStateUpdateSchema,
  cameraStreamFrameSchema,
  cameraStreamSessionRequestSchema
} from "@safelens/contracts";
import type { Response } from "express";

import { DeviceAuthGuard } from "../../common/auth/device-auth.guard";
import { DeviceRequest } from "../../common/auth/device-request";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { CameraStreamService } from "./camera-stream.service";

@Controller("devices")
export class CameraStreamController {
  constructor(private readonly cameraStreamService: CameraStreamService) {}

  @Get("self-camera-stream/session")
  @UseGuards(DeviceAuthGuard)
  getSelfState(@Req() request: DeviceRequest) {
    return this.cameraStreamService.getSelfState(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId
    );
  }

  @Post("self-camera-stream/state")
  @UseGuards(DeviceAuthGuard)
  updateState(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(cameraStreamDeviceStateUpdateSchema, body);
    return this.cameraStreamService.updateDeviceState(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Post("self-camera-stream/frame")
  @UseGuards(DeviceAuthGuard)
  ingestFrame(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(cameraStreamFrameSchema, body);
    return this.cameraStreamService.ingestFrame(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Post("self-camera-stream/audio-chunk")
  @UseGuards(DeviceAuthGuard)
  ingestAudioChunk(@Req() request: DeviceRequest, @Body() body: unknown) {
    const payload = parseSchema(cameraStreamAudioChunkUploadSchema, body);
    return this.cameraStreamService.ingestAudioChunk(
      request.safelensDevice.workspaceId,
      request.safelensDevice.deviceId,
      payload
    );
  }

  @Post(":id/camera-stream/session")
  @UseGuards(SessionAuthGuard)
  startOrUpdateSession(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Body() body: unknown
  ) {
    const payload = parseSchema(cameraStreamSessionRequestSchema, body);
    return this.cameraStreamService.startOrUpdateSession(
      request.safelensSession.workspaceId,
      deviceId,
      {
        cameraFacing: payload.cameraFacing ?? "back",
        includeAudio: payload.includeAudio ?? false,
        preferredTransport: payload.preferredTransport ?? "mjpeg"
      }
    );
  }

  @Get(":id/camera-stream/session")
  @UseGuards(SessionAuthGuard)
  getState(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.cameraStreamService.getState(
      request.safelensSession.workspaceId,
      deviceId
    );
  }

  @Delete(":id/camera-stream/session")
  @UseGuards(SessionAuthGuard)
  stopSession(@Req() request: SessionRequest, @Param("id") deviceId: string) {
    return this.cameraStreamService.stopSession(
      request.safelensSession.workspaceId,
      deviceId
    );
  }

  @Get(":id/camera-stream/mjpeg")
  @UseGuards(SessionAuthGuard)
  async mjpeg(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Res() response: Response
  ) {
    const boundary = "frame";
    response.status(200);
    response.setHeader(
      "Content-Type",
      `multipart/x-mixed-replace; boundary=${boundary}`
    );
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    let closed = false;
    let lastSentFrameAt: string | null = null;
    request.on("close", () => {
      closed = true;
    });

    while (!closed) {
      const state = await this.cameraStreamService.getMjpegFrame(
        request.safelensSession.workspaceId,
        deviceId
      );
      const hasNewFrame =
        state.lastFrameBase64 &&
        state.lastFrameAt &&
        state.lastFrameAt !== lastSentFrameAt;

      if (hasNewFrame) {
        const frameBase64 = state.lastFrameBase64;
        if (!frameBase64) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        const frameBuffer = Buffer.from(frameBase64, "base64");
        response.write(`--${boundary}\r\n`);
        response.write("Content-Type: image/jpeg\r\n");
        response.write(`Content-Length: ${frameBuffer.length}\r\n\r\n`);
        response.write(frameBuffer);
        response.write("\r\n");
        lastSentFrameAt = state.lastFrameAt;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    response.end();
  }

  @Get(":id/camera-stream/audio")
  @UseGuards(SessionAuthGuard)
  getAudioChunks(
    @Req() request: SessionRequest,
    @Param("id") deviceId: string,
    @Query("sinceSeq") sinceSeq?: string,
    @Query("limit") limit?: string
  ) {
    const parsedSinceSeq = Number.parseInt(sinceSeq ?? "0", 10);
    const parsedLimit = Number.parseInt(limit ?? "8", 10);
    return this.cameraStreamService.getAudioChunks(
      request.safelensSession.workspaceId,
      deviceId,
      {
        sinceServerSequence: Number.isFinite(parsedSinceSeq)
          ? Math.max(0, parsedSinceSeq)
          : 0,
        limit: Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 8
      }
    );
  }
}
