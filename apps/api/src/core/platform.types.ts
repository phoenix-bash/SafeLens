export type EventChannel =
  | "pairing.created"
  | "pairing.claimed"
  | "pairing.expired"
  | "device.online"
  | "device.offline"
  | "device.capabilities.updated"
  | "camera.session.updated";

export interface AccessSessionRecord {
  token: string;
  userId: string;
  workspaceId: string;
  expiresAt: string;
}

export interface PairingCodeRecord {
  code: string;
  workspaceId: string;
  createdByUserId: string;
  expiresAt: string;
  claimedAt: string | null;
  deviceId: string | null;
}

export interface CameraStreamLiveState {
  sessionId: string | null;
  deviceId: string;
  workspaceId: string;
  status:
    | "idle"
    | "starting"
    | "live_mjpeg"
    | "stopping"
    | "failed"
    | "activation_blocked";
  cameraFacing: "front" | "back";
  includeAudio: boolean;
  audioAvailable: boolean;
  signalingReady: boolean;
  preferredTransport: "mjpeg";
  activeTransport: "mjpeg" | null;
  viewers: Array<{
    viewerId: string;
    socketId: string;
    transport: "mjpeg" | null;
    joinedAt: string;
  }>;
  iceServers: Array<{
    urls: string[];
    username?: string;
    credential?: string;
  }>;
  lastFrameAt: string | null;
  lastFrameBase64: string | null;
  width: number | null;
  height: number | null;
  lastErrorCode:
    | "service_not_armed"
    | "fgs_start_blocked"
    | "camera_permission_missing"
    | "camera_open_failed"
    | "signaling_failed"
    | "start_timeout"
    | null;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string;
}

export interface CameraStreamAudioChunk {
  serverSequence: number;
  capturedAt: string;
  sequence: number;
  sampleRateHz: number;
  channels: number;
  bitsPerSample: 16;
  pcm16Base64: string;
  cameraSessionId: string;
}
