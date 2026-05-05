import { z } from "zod";

export const eventChannelSchema = z.enum([
  "pairing.created",
  "pairing.claimed",
  "pairing.expired",
  "device.online",
  "device.offline",
  "device.capabilities.updated",
  "camera.session.updated"
]);

export const devicePresenceEventSchema = z.object({
  channel: z.enum(["device.online", "device.offline"]),
  workspaceId: z.string().uuid(),
  deviceId: z.string().uuid(),
  occurredAt: z.string().datetime()
});

export const pairingEventSchema = z.object({
  channel: z.enum(["pairing.created", "pairing.claimed", "pairing.expired"]),
  workspaceId: z.string().uuid(),
  code: z.string().length(6),
  occurredAt: z.string().datetime()
});

export type EventChannel = z.infer<typeof eventChannelSchema>;
export type DevicePresenceEvent = z.infer<typeof devicePresenceEventSchema>;
export type PairingEvent = z.infer<typeof pairingEventSchema>;
