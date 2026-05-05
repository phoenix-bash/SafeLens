import { z } from "zod";
export declare const eventChannelSchema: z.ZodEnum<["pairing.created", "pairing.claimed", "pairing.expired", "device.online", "device.offline", "device.capabilities.updated"]>;
export declare const devicePresenceEventSchema: z.ZodObject<{
    channel: z.ZodEnum<["device.online", "device.offline"]>;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    occurredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    channel: "device.online" | "device.offline";
    deviceId: string;
    occurredAt: string;
}, {
    workspaceId: string;
    channel: "device.online" | "device.offline";
    deviceId: string;
    occurredAt: string;
}>;
export declare const pairingEventSchema: z.ZodObject<{
    channel: z.ZodEnum<["pairing.created", "pairing.claimed", "pairing.expired"]>;
    workspaceId: z.ZodString;
    code: z.ZodString;
    occurredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    workspaceId: string;
    channel: "pairing.created" | "pairing.claimed" | "pairing.expired";
    occurredAt: string;
}, {
    code: string;
    workspaceId: string;
    channel: "pairing.created" | "pairing.claimed" | "pairing.expired";
    occurredAt: string;
}>;
export type EventChannel = z.infer<typeof eventChannelSchema>;
export type DevicePresenceEvent = z.infer<typeof devicePresenceEventSchema>;
export type PairingEvent = z.infer<typeof pairingEventSchema>;
