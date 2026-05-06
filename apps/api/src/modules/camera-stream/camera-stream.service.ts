import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import {
  CameraStreamAudioChunkUpload,
  CameraStreamAudioPollResponse,
  CameraDeviceSignal,
  CameraStreamDeviceStateUpdate,
  CameraStreamFrame,
  CameraStreamSessionRequest,
  CameraStreamSessionState,
  CameraStreamTransport,
  CameraViewerSignal,
  CameraViewerTransportUpdate
} from "@safelens/contracts";

import { EphemeralStateService } from "../../core/ephemeral-state.service";
import { CameraStreamLiveState } from "../../core/platform.types";
import { PrismaService } from "../../core/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RealtimeService } from "../realtime/realtime.service";

const DEFAULT_CAMERA_FACING: CameraStreamSessionState["cameraFacing"] = "back";
const DEFAULT_PREFERRED_TRANSPORT: CameraStreamSessionState["preferredTransport"] =
  "mjpeg";
const DEFAULT_ICE_SERVERS: CameraStreamSessionState["iceServers"] = [
  {
    urls: ["stun:stun.l.google.com:19302"]
  },
  {
    urls: ["stun:stun1.l.google.com:19302"]
  }
];

@Injectable()
export class CameraStreamService {
  private readonly logger = new Logger(CameraStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly ephemeralState: EphemeralStateService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService
  ) {}

  async getState(
    workspaceId: string,
    deviceId: string
  ): Promise<CameraStreamSessionState> {
    await this.requireWorkspaceDevice(workspaceId, deviceId);
    return this.getOrCreateState(workspaceId, deviceId);
  }

  async getSelfState(
    workspaceId: string,
    deviceId: string
  ): Promise<CameraStreamSessionState> {
    return this.getState(workspaceId, deviceId);
  }

  async startOrUpdateSession(
    workspaceId: string,
    deviceId: string,
    input: CameraStreamSessionRequest
  ): Promise<CameraStreamSessionState> {
    const device = await this.requireWorkspaceDevice(workspaceId, deviceId);
    await this.ephemeralState.clearCameraStreamAudioChunks(deviceId);

    const resolvedTransport = this.resolvePreferredTransportForDevice(
      input.preferredTransport,
      {
        manufacturer: device.manufacturer,
        model: device.model,
        fingerprint: device.fingerprint ?? null
      }
    );

    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    const nextIceServers = this.getIceServers();
    const now = new Date().toISOString();
    const nextState = this.normalizeState({
      ...current,
      sessionId: randomUUID(),
      status: "starting",
      cameraFacing: input.cameraFacing,
      includeAudio: input.includeAudio,
      audioAvailable: input.includeAudio ? current.audioAvailable : false,
      signalingReady: false,
      preferredTransport: resolvedTransport,
      iceServers: nextIceServers,
      activeTransport: null,
      viewers: [],
      lastFrameAt: null,
      lastFrameBase64: null,
      width: null,
      height: null,
      lastErrorCode: null,
      lastError: null,
      startedAt: now,
      updatedAt: now
    });

    await this.storeAndPublish(nextState);
    await this.createDeviceCommand(workspaceId, deviceId, {
      type: "device.start_camera_stream",
      payload: {
        reason: "camera_session_start",
        cameraFacing: input.cameraFacing,
        includeAudio: input.includeAudio,
        preferredTransport: resolvedTransport,
        cameraSessionId: nextState.sessionId ?? undefined
      }
    });

    return this.toPublicState(nextState);
  }

  async stopSession(
    workspaceId: string,
    deviceId: string
  ): Promise<CameraStreamSessionState> {
    await this.requireWorkspaceDevice(workspaceId, deviceId);

    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    const nextState = this.normalizeState({
      ...current,
      status: "stopping",
      activeTransport: null,
      viewers: [],
      lastErrorCode: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    });

    await this.storeAndPublish(nextState);
    await this.ephemeralState.clearCameraStreamAudioChunks(deviceId);
    await this.createDeviceCommand(workspaceId, deviceId, {
      type: "device.stop_camera_stream",
      payload: {
        reason: "camera_session_stop",
        cameraSessionId: nextState.sessionId ?? undefined
      }
    });

    return this.toPublicState(nextState);
  }

  async updateDeviceState(
    workspaceId: string,
    deviceId: string,
    input: CameraStreamDeviceStateUpdate
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);

    if (
      input.status === "idle" &&
      !this.shouldApplyIdleUpdate(current, input.cameraSessionId)
    ) {
      this.logger.warn(
        `Ignoring stale idle camera state update for deviceId=${deviceId} currentSessionId=${current.sessionId ?? "null"} reportedSessionId=${input.cameraSessionId ?? "null"} currentStatus=${current.status}`
      );
      return { success: true };
    }

    const now = new Date().toISOString();
    const clearsSession = input.status === "idle";
    const clearsViewers =
      clearsSession ||
      input.status === "failed" ||
      input.status === "activation_blocked";
    const nextLastError =
      input.lastError === undefined ? null : input.lastError;
    const nextLastErrorCode =
      input.lastErrorCode === undefined ? null : input.lastErrorCode;
    const nextState = this.normalizeState({
      ...current,
      status: input.status,
      viewers: clearsViewers ? [] : current.viewers,
      cameraFacing: input.cameraFacing ?? current.cameraFacing,
      includeAudio: input.includeAudio ?? current.includeAudio,
      audioAvailable:
        input.audioAvailable ??
        (input.includeAudio === false ? false : current.audioAvailable),
      signalingReady: clearsViewers ? false : (input.signalingReady ?? current.signalingReady),
      preferredTransport: input.preferredTransport ?? current.preferredTransport,
      lastErrorCode: nextLastErrorCode,
      lastError: nextLastError,
      sessionId: clearsSession ? null : current.sessionId,
      startedAt: clearsSession ? null : current.startedAt,
      updatedAt: now
    });

    this.logger.log(
      `Camera stream state update deviceId=${deviceId} status ${current.status} -> ${nextState.status} sessionId=${nextState.sessionId ?? "null"}`
    );

    await this.storeAndPublish(nextState);
    if (clearsSession) {
      await this.ephemeralState.clearCameraStreamAudioChunks(deviceId);
    }
    return { success: true };
  }

  private shouldApplyIdleUpdate(
    current: CameraStreamLiveState,
    reportedSessionId?: string | null
  ) {
    if (!current.sessionId) {
      return true;
    }

    if (reportedSessionId && reportedSessionId === current.sessionId) {
      return true;
    }

    // Backward compatibility for clients that do not yet send cameraSessionId.
    return reportedSessionId == null && current.status === "stopping";
  }

  async ingestFrame(workspaceId: string, deviceId: string, frame: CameraStreamFrame) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    const nextState = this.normalizeState({
      ...current,
      cameraFacing: frame.cameraFacing,
      lastFrameAt: frame.capturedAt,
      lastFrameBase64: frame.imageBase64,
      width: frame.width,
      height: frame.height,
      updatedAt: new Date().toISOString()
    });

    await this.storeAndPublish(nextState);
    return { success: true };
  }

  async ingestAudioChunk(
    workspaceId: string,
    deviceId: string,
    chunk: CameraStreamAudioChunkUpload
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    if (!current.sessionId || current.status === "idle" || current.status === "stopping") {
      return { success: true, accepted: false };
    }

    if (chunk.cameraSessionId && chunk.cameraSessionId !== current.sessionId) {
      this.logger.warn(
        `Ignoring stale camera audio chunk for deviceId=${deviceId} currentSessionId=${current.sessionId} reportedSessionId=${chunk.cameraSessionId}`
      );
      return { success: true, accepted: false };
    }

    await this.ephemeralState.appendCameraStreamAudioChunk(deviceId, {
      capturedAt: chunk.capturedAt,
      sequence: chunk.sequence,
      sampleRateHz: chunk.sampleRateHz,
      channels: chunk.channels,
      bitsPerSample: chunk.bitsPerSample,
      pcm16Base64: chunk.pcm16Base64,
      cameraSessionId: current.sessionId
    });

    if (current.includeAudio && !current.audioAvailable) {
      const nextState = this.normalizeState({
        ...current,
        audioAvailable: true,
        updatedAt: new Date().toISOString()
      });
      await this.storeAndPublish(nextState);
    }

    return { success: true, accepted: true };
  }

  async getAudioChunks(
    workspaceId: string,
    deviceId: string,
    input?: {
      sinceServerSequence?: number;
      limit?: number;
    }
  ): Promise<CameraStreamAudioPollResponse> {
    await this.requireWorkspaceDevice(workspaceId, deviceId);

    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    if (!current.sessionId) {
      return {
        chunks: [],
        latestServerSequence: 0
      };
    }

    const result = await this.ephemeralState.getCameraStreamAudioChunks(deviceId, {
      sinceServerSequence: input?.sinceServerSequence,
      limit: input?.limit
    });

    return {
      chunks: result.chunks.filter(
        (chunk) => chunk.cameraSessionId === current.sessionId
      ),
      latestServerSequence: result.latestServerSequence
    };
  }

  async joinViewer(
    workspaceId: string,
    deviceId: string,
    viewerId: string,
    socketId: string
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);

    if (!current.sessionId) {
      throw new BadRequestException("Camera session is not active.");
    }

    if (
      current.status === "activation_blocked" ||
      current.status === "failed" ||
      current.status === "stopping"
    ) {
      throw new BadRequestException(
        current.lastError ?? "Camera session is not available for viewing."
      );
    }

    const conflictingViewer = current.viewers.find(
      (viewer) => viewer.viewerId !== viewerId || viewer.socketId !== socketId
    );
    if (conflictingViewer) {
      throw new BadRequestException(
        "Camera stream already has an active viewer for this device."
      );
    }

    const nextState = this.normalizeState({
      ...current,
      viewers: [
        ...current.viewers.filter((viewer) => viewer.viewerId !== viewerId),
        {
          viewerId,
          socketId,
          transport: null,
          joinedAt: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    });

    await this.storeAndPublish(nextState);
    return this.toPublicState(nextState);
  }

  async leaveViewer(
    workspaceId: string,
    deviceId: string,
    viewerId: string,
    socketId?: string
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    const nextViewers = current.viewers.filter(
      (viewer) =>
        viewer.viewerId !== viewerId ||
        (socketId != null && viewer.socketId !== socketId)
    );
    const nextStatus =
      current.status === "stopping" || current.status === "idle"
        ? current.status
        : this.resolveLiveStatus(current.status, nextViewers);
    const nextState = this.normalizeState({
      ...current,
      viewers: nextViewers,
      status: nextStatus,
      updatedAt: new Date().toISOString()
    });

    await this.storeAndPublish(nextState);
    return this.toPublicState(nextState);
  }

  async updateViewerTransport(
    workspaceId: string,
    deviceId: string,
    viewerId: string,
    socketId: string,
    transport: CameraStreamTransport
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    const hasViewer = current.viewers.some(
      (viewer) => viewer.viewerId === viewerId && viewer.socketId === socketId
    );
    if (!hasViewer) {
      throw new BadRequestException("Viewer is not joined to the camera session.");
    }
    const nextState = this.normalizeState({
      ...current,
      viewers: current.viewers.map((viewer) =>
        viewer.viewerId === viewerId && viewer.socketId === socketId
          ? { ...viewer, transport }
          : viewer
      ),
      updatedAt: new Date().toISOString()
    });

    await this.storeAndPublish(nextState);
    return this.toPublicState(nextState);
  }

  async relayViewerSignal(
    workspaceId: string,
    payload: CameraViewerSignal,
    socketId: string
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, payload.deviceId);
    const viewer = current.viewers.find(
      (item) => item.viewerId === payload.viewerId && item.socketId === socketId
    );

    if (!viewer) {
      throw new BadRequestException("Viewer is not joined to the camera session.");
    }

    this.realtimeService.emitToDevice(payload.deviceId, "camera.device.signal", payload);
    return { success: true };
  }

  async relayDeviceSignal(
    workspaceId: string,
    deviceId: string,
    payload: CameraDeviceSignal
  ) {
    const current = await this.getOrCreateLiveState(workspaceId, deviceId);
    const viewer = current.viewers.find((item) => item.viewerId === payload.viewerId);

    if (!viewer) {
      throw new BadRequestException("Viewer is not joined to the camera session.");
    }

    this.realtimeService.emitToSocket(viewer.socketId, "camera.viewer.signal", {
      deviceId,
      viewerId: payload.viewerId,
      signal: payload.signal
    });
    return { success: true };
  }

  async getMjpegFrame(
    workspaceId: string,
    deviceId: string
  ): Promise<CameraStreamSessionState> {
    return this.getState(workspaceId, deviceId);
  }

  private async getOrCreateState(
    workspaceId: string,
    deviceId: string
  ): Promise<CameraStreamSessionState> {
    return this.toPublicState(await this.getOrCreateLiveState(workspaceId, deviceId));
  }

  private async getOrCreateLiveState(
    workspaceId: string,
    deviceId: string
  ): Promise<CameraStreamLiveState> {
    const state = await this.ephemeralState.getCameraStreamState(deviceId);
    if (state) {
      const normalized = this.normalizeState(state);
      if (normalized.iceServers.length > 0) {
        return normalized;
      }

      const repaired = this.normalizeState({
        ...normalized,
        iceServers: this.getIceServers(),
        updatedAt: new Date().toISOString()
      });
      await this.ephemeralState.storeCameraStreamState(repaired);
      return repaired;
    }

    const now = new Date().toISOString();
    const nextState = this.normalizeState({
      sessionId: null,
      deviceId,
      workspaceId,
      status: "idle",
      cameraFacing: DEFAULT_CAMERA_FACING,
      includeAudio: false,
      audioAvailable: false,
      signalingReady: false,
      preferredTransport: DEFAULT_PREFERRED_TRANSPORT,
      activeTransport: null,
      viewers: [],
      iceServers: this.getIceServers(),
      lastFrameAt: null,
      lastFrameBase64: null,
      width: null,
      height: null,
      lastErrorCode: null,
      lastError: null,
      startedAt: null,
      updatedAt: now
    });

    await this.ephemeralState.storeCameraStreamState(nextState);
    return nextState;
  }

  private normalizeState(state: CameraStreamLiveState): CameraStreamLiveState {
    const activeTransport = this.computeActiveTransport(state.viewers);
    return {
      ...state,
      lastErrorCode: state.lastErrorCode ?? null,
      activeTransport,
      status:
        state.status === "failed" ||
        state.status === "activation_blocked" ||
        state.status === "stopping" ||
        state.status === "idle"
          ? state.status
          : this.resolveLiveStatus(state.status, state.viewers)
    };
  }

  private resolveLiveStatus(
    currentStatus: CameraStreamLiveState["status"],
    viewers: CameraStreamLiveState["viewers"]
  ): CameraStreamLiveState["status"] {
    const activeTransport = this.computeActiveTransport(viewers);
    if (activeTransport === "mjpeg") {
      return "live_mjpeg";
    }
    return currentStatus === "idle" ? "idle" : "starting";
  }

  private computeActiveTransport(viewers: CameraStreamLiveState["viewers"]) {
    if (viewers.some((viewer) => viewer.transport === "mjpeg")) {
      return "mjpeg" as const;
    }
    return null;
  }

  private toPublicState(state: CameraStreamLiveState): CameraStreamSessionState {
    return {
      sessionId: state.sessionId,
      deviceId: state.deviceId,
      workspaceId: state.workspaceId,
      status: state.status,
      cameraFacing: state.cameraFacing,
      includeAudio: state.includeAudio,
      audioAvailable: state.audioAvailable,
      signalingReady: state.signalingReady,
      preferredTransport: state.preferredTransport,
      activeTransport: state.activeTransport,
      viewerCount: state.viewers.length,
      viewers: state.viewers.map((viewer) => ({
        viewerId: viewer.viewerId,
        transport: viewer.transport,
        joinedAt: viewer.joinedAt
      })),
      iceServers: state.iceServers,
      lastFrameAt: state.lastFrameAt,
      lastFrameBase64: state.lastFrameBase64,
      width: state.width,
      height: state.height,
      lastErrorCode: state.lastErrorCode,
      lastError: state.lastError,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt
    };
  }

  private async storeAndPublish(state: CameraStreamLiveState) {
    await this.ephemeralState.storeCameraStreamState(state);
    this.realtimeService.emitToWorkspace(state.workspaceId, "camera.session.updated", {
      channel: "camera.session.updated",
      workspaceId: state.workspaceId,
      deviceId: state.deviceId,
      state: this.toPublicState(state)
    });
  }

  private getIceServers(): CameraStreamSessionState["iceServers"] {
    const rawValue = this.configService.get<string>("WEBRTC_ICE_SERVERS_JSON");
    if (!rawValue?.trim()) {
      return DEFAULT_ICE_SERVERS;
    }

    try {
      const parsed = JSON.parse(rawValue) as Array<{
        urls: string[] | string;
        username?: string;
        credential?: string;
      }>;
      const normalized = parsed
        .map((item) => ({
          urls: Array.isArray(item.urls) ? item.urls : [item.urls],
          username: item.username,
          credential: item.credential
        }))
        .filter((item) => item.urls.length > 0);
      return normalized.length > 0 ? normalized : DEFAULT_ICE_SERVERS;
    } catch {
      return DEFAULT_ICE_SERVERS;
    }
  }

  private resolvePreferredTransportForDevice(
    requestedTransport: CameraStreamSessionRequest["preferredTransport"],
    _device: {
      manufacturer: string;
      model: string;
      fingerprint: string | null;
    }
  ): CameraStreamSessionRequest["preferredTransport"] {
    return requestedTransport === "mjpeg" ? "mjpeg" : "mjpeg";
  }

  private async requireWorkspaceDevice(workspaceId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        workspaceId
      }
    });

    if (!device) {
      throw new NotFoundException("Device not found.");
    }

    return device;
  }

  private async createDeviceCommand(
    workspaceId: string,
    deviceId: string,
    input: {
      type: "device.start_camera_stream" | "device.stop_camera_stream";
      payload: Record<string, unknown>;
    }
  ) {
    const now = new Date();
    const command = await (this.prisma as any).deviceCommand.create({
      data: {
        deviceId,
        workspaceId,
        type: input.type,
        status: "pending",
        payload: input.payload,
        dispatchedAt: now
      }
    });

    await this.auditService.record({
      workspaceId,
      actorType: "user",
      actorId: workspaceId,
      eventType: "device.command.created",
      payload: {
        deviceId,
        type: input.type
      }
    });

    this.realtimeService.emitToDevice(deviceId, "device.command", {
      id: command.id,
      workspaceId: command.workspaceId,
      deviceId: command.deviceId,
      type: command.type,
      status: command.status,
      payload: command.payload ?? {},
      createdAt: command.createdAt.toISOString(),
      acknowledgedAt: null,
      completedAt: null,
      lastError: null
    });
  }
}
