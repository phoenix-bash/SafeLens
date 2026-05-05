"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairingEventSchema = exports.devicePresenceEventSchema = exports.eventChannelSchema = void 0;
const zod_1 = require("zod");
exports.eventChannelSchema = zod_1.z.enum([
    "pairing.created",
    "pairing.claimed",
    "pairing.expired",
    "device.online",
    "device.offline",
    "device.capabilities.updated"
]);
exports.devicePresenceEventSchema = zod_1.z.object({
    channel: zod_1.z.enum(["device.online", "device.offline"]),
    workspaceId: zod_1.z.string().uuid(),
    deviceId: zod_1.z.string().uuid(),
    occurredAt: zod_1.z.string().datetime()
});
exports.pairingEventSchema = zod_1.z.object({
    channel: zod_1.z.enum(["pairing.created", "pairing.claimed", "pairing.expired"]),
    workspaceId: zod_1.z.string().uuid(),
    code: zod_1.z.string().length(6),
    occurredAt: zod_1.z.string().datetime()
});
