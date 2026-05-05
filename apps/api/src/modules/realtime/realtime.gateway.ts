import {
  cameraDeviceSignalSchema,
  cameraViewerJoinSchema,
  cameraViewerLeaveSchema,
  cameraViewerSignalSchema,
  cameraViewerTransportUpdateSchema
} from "@safelens/contracts";
import {
  ConnectedSocket,
  OnGatewayDisconnect,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

import { EventChannel } from "../../core/platform.types";
import { EphemeralStateService } from "../../core/ephemeral-state.service";
import { PrismaService } from "../../core/prisma.service";
import { parseSchema } from "../../common/http/parse-schema";
import { CameraStreamService } from "../camera-stream/camera-stream.service";
import { RealtimeService } from "./realtime.service";

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true
  }
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly ephemeralState: EphemeralStateService,
    private readonly prisma: PrismaService,
    private readonly cameraStreamService: CameraStreamService
  ) {}

  afterInit = (server: Server) => {
    RealtimeService.attachGlobalServer(server);
  };

  async handleDisconnect(client: Socket) {
    const viewerMemberships =
      ((client.data.cameraViewerMemberships as Array<{
        deviceId: string;
        viewerId: string;
        workspaceId: string;
      }>) ?? []);

    await Promise.all(
      viewerMemberships.map((membership) =>
        this.cameraStreamService.leaveViewer(
          membership.workspaceId,
          membership.deviceId,
          membership.viewerId,
          client.id
        )
      )
    );
  }

  @SubscribeMessage("workspace.subscribe")
  async handleWorkspaceSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { accessToken?: string }
  ) {
    const accessToken = payload.accessToken?.trim();

    if (!accessToken) {
      client.emit("workspace.subscribe.failed", {
        message: "Missing access token."
      });
      return;
    }

    const session = await this.ephemeralState.getAccessSession(accessToken);

    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      client.emit("workspace.subscribe.failed", {
        message: "Invalid access token."
      });
      return;
    }

    client.join(`workspace:${session.workspaceId}`);
    client.data.workspaceId = session.workspaceId;
    client.emit("workspace.subscribe.ok", {
      workspaceId: session.workspaceId
    });
  }

  @SubscribeMessage("device.subscribe")
  async handleDeviceSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { deviceToken?: string }
  ) {
    const deviceToken = payload.deviceToken?.trim();

    if (!deviceToken) {
      client.emit("device.subscribe.failed", {
        message: "Missing device token."
      });
      return;
    }

    const session = await this.prisma.deviceSession.findUnique({
      where: { deviceToken }
    });

    if (!session || session.revokedAt) {
      client.emit("device.subscribe.failed", {
        message: "Invalid device token."
      });
      return;
    }

    client.join(`device:${session.deviceId}`);
    client.data.deviceId = session.deviceId;
    client.data.workspaceId = session.workspaceId;
    client.emit("device.subscribe.ok", {
      deviceId: session.deviceId,
      workspaceId: session.workspaceId
    });
  }

  @SubscribeMessage("camera.viewer.join")
  async handleCameraViewerJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown
  ) {
    const workspaceId = client.data.workspaceId as string | undefined;
    if (!workspaceId) {
      client.emit("camera.viewer.join.failed", {
        message: "Workspace socket is not subscribed."
      });
      return;
    }

    const payload = parseSchema(cameraViewerJoinSchema, body);
    try {
      const state = await this.cameraStreamService.joinViewer(
        workspaceId,
        payload.deviceId,
        payload.viewerId,
        client.id
      );

      const existingMemberships =
        ((client.data.cameraViewerMemberships as Array<{
          deviceId: string;
          viewerId: string;
          workspaceId: string;
        }>) ?? []);
      client.data.cameraViewerMemberships = [
        ...existingMemberships.filter(
          (membership) =>
            !(
              membership.deviceId === payload.deviceId &&
              membership.viewerId === payload.viewerId
            )
        ),
        {
          deviceId: payload.deviceId,
          viewerId: payload.viewerId,
          workspaceId
        }
      ];

      client.emit("camera.viewer.join.ok", {
        deviceId: payload.deviceId,
        viewerId: payload.viewerId,
        state
      });
    } catch (error) {
      client.emit("camera.viewer.join.failed", {
        deviceId: payload.deviceId,
        viewerId: payload.viewerId,
        message: error instanceof Error ? error.message : "Could not join camera viewer."
      });
    }
  }

  @SubscribeMessage("camera.viewer.leave")
  async handleCameraViewerLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown
  ) {
    const workspaceId = client.data.workspaceId as string | undefined;
    if (!workspaceId) {
      return;
    }

    const payload = parseSchema(cameraViewerLeaveSchema, body);
    await this.cameraStreamService.leaveViewer(
      workspaceId,
      payload.deviceId,
      payload.viewerId,
      client.id
    );
    client.data.cameraViewerMemberships = (
      (client.data.cameraViewerMemberships as Array<{
        deviceId: string;
        viewerId: string;
        workspaceId: string;
      }>) ?? []
    ).filter(
      (membership) =>
        !(
          membership.deviceId === payload.deviceId &&
          membership.viewerId === payload.viewerId
        )
    );
  }

  @SubscribeMessage("camera.viewer.signal")
  async handleCameraViewerSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown
  ) {
    const workspaceId = client.data.workspaceId as string | undefined;
    if (!workspaceId) {
      return;
    }

    const payload = parseSchema(cameraViewerSignalSchema, body);
    await this.cameraStreamService.relayViewerSignal(workspaceId, payload, client.id);
  }

  @SubscribeMessage("camera.viewer.transport")
  async handleCameraViewerTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown
  ) {
    const workspaceId = client.data.workspaceId as string | undefined;
    if (!workspaceId) {
      return;
    }

    const payload = parseSchema(cameraViewerTransportUpdateSchema, body);
    await this.cameraStreamService.updateViewerTransport(
      workspaceId,
      payload.deviceId,
      payload.viewerId,
      client.id,
      payload.transport
    );
  }

  @SubscribeMessage("camera.device.signal")
  async handleCameraDeviceSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown
  ) {
    const workspaceId = client.data.workspaceId as string | undefined;
    const deviceId = client.data.deviceId as string | undefined;
    if (!workspaceId || !deviceId) {
      return;
    }

    const payload = parseSchema(cameraDeviceSignalSchema, body);
    await this.cameraStreamService.relayDeviceSignal(workspaceId, deviceId, payload);
  }
}
