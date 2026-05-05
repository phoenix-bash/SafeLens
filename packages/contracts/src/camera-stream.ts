import { z } from "zod";

export const cameraFacingSchema = z.enum(["front", "back"]);
export const cameraStreamTransportSchema = z.enum(["webrtc", "mjpeg"]);
export const cameraStreamStatusSchema = z.enum([
  "idle",
  "starting",
  "live_webrtc",
  "live_mjpeg",
  "stopping",
  "failed",
  "activation_blocked"
]);

export const cameraStreamErrorCodeSchema = z.enum([
  "service_not_armed",
  "fgs_start_blocked",
  "camera_permission_missing",
  "camera_open_failed",
  "signaling_failed",
  "start_timeout"
]);

export const cameraIceServerSchema = z.object({
  urls: z.array(z.string().min(1)).min(1),
  username: z.string().min(1).optional(),
  credential: z.string().min(1).optional()
});

export const cameraStreamSessionRequestSchema = z.object({
  cameraFacing: cameraFacingSchema.default("back"),
  includeAudio: z.boolean().default(false),
  preferredTransport: cameraStreamTransportSchema.default("webrtc")
});

export const cameraStreamViewerSchema = z.object({
  viewerId: z.string().uuid(),
  transport: cameraStreamTransportSchema.nullable(),
  joinedAt: z.string().datetime()
});

export const cameraStreamSignalSchema = z.object({
  type: z.enum(["offer", "answer", "ice-candidate"]),
  sdp: z.string().min(2).optional(),
  candidate: z.string().min(2).optional(),
  sdpMid: z.string().min(1).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).nullable().optional(),
  usernameFragment: z.string().min(1).nullable().optional()
});

export const cameraViewerJoinSchema = z.object({
  deviceId: z.string().uuid(),
  viewerId: z.string().uuid()
});

export const cameraViewerLeaveSchema = cameraViewerJoinSchema;

export const cameraViewerSignalSchema = z.object({
  deviceId: z.string().uuid(),
  viewerId: z.string().uuid(),
  signal: cameraStreamSignalSchema
});

export const cameraViewerTransportUpdateSchema = z.object({
  deviceId: z.string().uuid(),
  viewerId: z.string().uuid(),
  transport: cameraStreamTransportSchema
});

export const cameraDeviceSignalSchema = z.object({
  viewerId: z.string().uuid(),
  signal: cameraStreamSignalSchema
});

export const cameraStreamFrameSchema = z.object({
  capturedAt: z.string().datetime(),
  imageBase64: z.string().min(16),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  cameraFacing: cameraFacingSchema
});

export const cameraStreamAudioChunkUploadSchema = z.object({
  capturedAt: z.string().datetime(),
  sequence: z.number().int().min(0),
  sampleRateHz: z.number().int().positive(),
  channels: z.number().int().min(1).max(2),
  bitsPerSample: z.literal(16),
  pcm16Base64: z.string().min(16),
  cameraSessionId: z.string().uuid().nullable().optional()
});

export const cameraStreamAudioChunkSchema =
  cameraStreamAudioChunkUploadSchema.extend({
    serverSequence: z.number().int().min(1)
  });

export const cameraStreamAudioPollResponseSchema = z.object({
  chunks: z.array(cameraStreamAudioChunkSchema),
  latestServerSequence: z.number().int().min(0)
});

export const cameraStreamDeviceStateUpdateSchema = z.object({
  status: cameraStreamStatusSchema,
  cameraFacing: cameraFacingSchema.optional(),
  includeAudio: z.boolean().optional(),
  audioAvailable: z.boolean().optional(),
  signalingReady: z.boolean().optional(),
  preferredTransport: cameraStreamTransportSchema.optional(),
  cameraSessionId: z.string().uuid().nullable().optional(),
  lastErrorCode: cameraStreamErrorCodeSchema.nullable().optional(),
  lastError: z.string().min(2).max(1024).nullable().optional()
});

export const cameraStreamSessionStateSchema = z.object({
  sessionId: z.string().uuid().nullable(),
  deviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  status: cameraStreamStatusSchema,
  cameraFacing: cameraFacingSchema,
  includeAudio: z.boolean(),
  audioAvailable: z.boolean(),
  signalingReady: z.boolean(),
  preferredTransport: cameraStreamTransportSchema,
  activeTransport: cameraStreamTransportSchema.nullable(),
  viewerCount: z.number().int().min(0),
  viewers: z.array(cameraStreamViewerSchema),
  iceServers: z.array(cameraIceServerSchema),
  lastFrameAt: z.string().datetime().nullable(),
  lastFrameBase64: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  lastErrorCode: cameraStreamErrorCodeSchema.nullable(),
  lastError: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});

export const cameraSessionUpdatedEventSchema = z.object({
  channel: z.literal("camera.session.updated"),
  workspaceId: z.string().uuid(),
  deviceId: z.string().uuid(),
  state: cameraStreamSessionStateSchema
});

export type CameraFacing = z.infer<typeof cameraFacingSchema>;
export type CameraStreamTransport = z.infer<typeof cameraStreamTransportSchema>;
export type CameraStreamStatus = z.infer<typeof cameraStreamStatusSchema>;
export type CameraStreamErrorCode = z.infer<typeof cameraStreamErrorCodeSchema>;
export type CameraIceServer = z.infer<typeof cameraIceServerSchema>;
export type CameraStreamSessionRequest = z.infer<
  typeof cameraStreamSessionRequestSchema
>;
export type CameraStreamViewer = z.infer<typeof cameraStreamViewerSchema>;
export type CameraStreamSignal = z.infer<typeof cameraStreamSignalSchema>;
export type CameraViewerJoin = z.infer<typeof cameraViewerJoinSchema>;
export type CameraViewerLeave = z.infer<typeof cameraViewerLeaveSchema>;
export type CameraViewerSignal = z.infer<typeof cameraViewerSignalSchema>;
export type CameraViewerTransportUpdate = z.infer<
  typeof cameraViewerTransportUpdateSchema
>;
export type CameraDeviceSignal = z.infer<typeof cameraDeviceSignalSchema>;
export type CameraStreamFrame = z.infer<typeof cameraStreamFrameSchema>;
export type CameraStreamAudioChunkUpload = z.infer<
  typeof cameraStreamAudioChunkUploadSchema
>;
export type CameraStreamAudioChunk = z.infer<typeof cameraStreamAudioChunkSchema>;
export type CameraStreamAudioPollResponse = z.infer<
  typeof cameraStreamAudioPollResponseSchema
>;
export type CameraStreamDeviceStateUpdate = z.infer<
  typeof cameraStreamDeviceStateUpdateSchema
>;
export type CameraStreamSessionState = z.infer<
  typeof cameraStreamSessionStateSchema
>;
export type CameraSessionUpdatedEvent = z.infer<
  typeof cameraSessionUpdatedEventSchema
>;
