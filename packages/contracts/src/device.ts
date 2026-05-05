import { z } from "zod";

export const featureStatusSchema = z.enum(["available", "planned", "unsupported"]);

export const deviceCapabilitySchema = z.object({
  key: z.string().min(2),
  label: z.string().min(2),
  status: featureStatusSchema
});

export const deviceCapabilityManifestSchema = z.object({
  capabilities: z.array(deviceCapabilitySchema).min(1)
});

export const deviceSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  model: z.string().min(1),
  manufacturer: z.string().min(1),
  androidVersion: z.string().min(1),
  isPaired: z.boolean(),
  isOnline: z.boolean(),
  pairedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  capabilities: z.array(deviceCapabilitySchema)
});

export const deviceDetailSchema = deviceSummarySchema.extend({
  activeSessionId: z.string().uuid().nullable()
});

export const revokeDeviceSessionRequestSchema = z.object({
  reason: z.string().min(3).max(160).optional()
});

export type DeviceCapability = z.infer<typeof deviceCapabilitySchema>;
export type DeviceCapabilityManifest = z.infer<typeof deviceCapabilityManifestSchema>;
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;
export type DeviceDetail = z.infer<typeof deviceDetailSchema>;
export type RevokeDeviceSessionRequest = z.infer<typeof revokeDeviceSessionRequestSchema>;
