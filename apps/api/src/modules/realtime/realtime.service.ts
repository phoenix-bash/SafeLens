import { Injectable } from "@nestjs/common";
import { Server } from "socket.io";

import { EventChannel } from "../../core/platform.types";

@Injectable()
export class RealtimeService {
  private static sharedServer?: Server;
  private server?: Server;

  static attachGlobalServer(server: Server) {
    RealtimeService.sharedServer = server;
  }

  attachServer(server: Server) {
    this.server = server;
    RealtimeService.sharedServer = server;
  }

  private getServer() {
    return this.server ?? RealtimeService.sharedServer;
  }

  emitToWorkspace(
    workspaceId: string,
    channel: EventChannel,
    payload: Record<string, unknown>
  ) {
    this.getServer()?.to(`workspace:${workspaceId}`).emit(channel, payload);
  }

  emitToDevice(
    deviceId: string,
    channel: string,
    payload: Record<string, unknown>
  ) {
    this.getServer()?.to(`device:${deviceId}`).emit(channel, payload);
  }

  emitToSocket(socketId: string, channel: string, payload: Record<string, unknown>) {
    this.getServer()?.to(socketId).emit(channel, payload);
  }
}
