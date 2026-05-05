import { z } from "zod";

import { deviceCapabilityManifestSchema } from "./device";

export const pairingCodeViewSchema = z.object({
  code: z.string().length(6).regex(/^[A-Z]{6}$/),
  workspaceId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  claimedAt: z.string().datetime().nullable()
});

export const createPairingCodeResponseSchema = pairingCodeViewSchema;

export const pairDeviceRequestSchema = z.object({
  code: z.string().length(6).regex(/^[A-Z]{6}$/),
  deviceName: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  manufacturer: z.string().min(1).max(80),
  androidVersion: z.string().min(1).max(40),
  deviceFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  capabilities: deviceCapabilityManifestSchema.shape.capabilities
});

export const pairDeviceResponseSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(24),
  workspaceId: z.string().uuid(),
  pairedAt: z.string().datetime()
});

export type PairingCodeView = z.infer<typeof pairingCodeViewSchema>;
export type PairDeviceRequest = z.infer<typeof pairDeviceRequestSchema>;
export type PairDeviceResponse = z.infer<typeof pairDeviceResponseSchema>;
