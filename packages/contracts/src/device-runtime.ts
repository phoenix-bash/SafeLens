import { z } from "zod";
import {
  cameraFacingSchema,
  cameraStreamTransportSchema
} from "./camera-stream";

export const deviceCommandTypeSchema = z.enum([
  "device.refresh_info",
  "device.refresh_notifications",
  "device.refresh_call_logs",
  "device.get_location",
  "device.start_camera_stream",
  "device.stop_camera_stream",
  "device.start_location_reporting",
  "device.stop_location_reporting"
]);

export const deviceCommandStatusSchema = z.enum([
  "pending",
  "acknowledged",
  "completed",
  "failed"
]);

export const refreshInfoCommandPayloadSchema = z.object({
  reason: z.string().min(2).max(120).optional()
});

export const startLocationReportingCommandPayloadSchema = z.object({
  intervalMinutes: z.number().int().min(5).max(15).default(10)
});

export const stopLocationReportingCommandPayloadSchema = z.object({});

export const deviceCommandPayloadSchema = z.object({
  reason: z.string().min(2).max(120).optional(),
  intervalMinutes: z.number().int().min(5).max(15).optional(),
  frameIntervalMs: z.number().int().min(500).max(5000).optional(),
  cameraFacing: cameraFacingSchema.optional(),
  includeAudio: z.boolean().optional(),
  preferredTransport: cameraStreamTransportSchema.optional(),
  cameraSessionId: z.string().uuid().optional()
});

export const createDeviceCommandRequestSchema = z.object({
  type: deviceCommandTypeSchema,
  payload: deviceCommandPayloadSchema.default({})
});

export const deviceCommandViewSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  deviceId: z.string().uuid(),
  type: deviceCommandTypeSchema,
  status: deviceCommandStatusSchema,
  payload: deviceCommandPayloadSchema,
  createdAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable()
});

export const deviceCommandAckRequestSchema = z.object({
  status: z.enum(["acknowledged", "completed", "failed"]),
  lastError: z.string().min(2).max(1024).optional()
});

export const listPendingDeviceCommandsResponseSchema = z.object({
  commands: z.array(deviceCommandViewSchema)
});

export type DeviceCommandType = z.infer<typeof deviceCommandTypeSchema>;
export type DeviceCommandStatus = z.infer<typeof deviceCommandStatusSchema>;
export type DeviceCommandPayload = z.infer<typeof deviceCommandPayloadSchema>;
export type CreateDeviceCommandRequest = z.infer<
  typeof createDeviceCommandRequestSchema
>;
export type DeviceCommandView = z.infer<typeof deviceCommandViewSchema>;
export type DeviceCommandAckRequest = z.infer<
  typeof deviceCommandAckRequestSchema
>;
