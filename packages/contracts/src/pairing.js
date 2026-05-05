"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairDeviceResponseSchema = exports.pairDeviceRequestSchema = exports.createPairingCodeResponseSchema = exports.pairingCodeViewSchema = void 0;
const zod_1 = require("zod");
const device_1 = require("./device");
exports.pairingCodeViewSchema = zod_1.z.object({
    code: zod_1.z.string().length(6).regex(/^[A-Z]{6}$/),
    workspaceId: zod_1.z.string().uuid(),
    expiresAt: zod_1.z.string().datetime(),
    claimedAt: zod_1.z.string().datetime().nullable()
});
exports.createPairingCodeResponseSchema = exports.pairingCodeViewSchema;
exports.pairDeviceRequestSchema = zod_1.z.object({
    code: zod_1.z.string().length(6).regex(/^[A-Z]{6}$/),
    deviceName: zod_1.z.string().min(1).max(80),
    model: zod_1.z.string().min(1).max(80),
    manufacturer: zod_1.z.string().min(1).max(80),
    androidVersion: zod_1.z.string().min(1).max(40),
    capabilities: device_1.deviceCapabilityManifestSchema.shape.capabilities
});
exports.pairDeviceResponseSchema = zod_1.z.object({
    deviceId: zod_1.z.string().uuid(),
    deviceToken: zod_1.z.string().min(24),
    workspaceId: zod_1.z.string().uuid(),
    pairedAt: zod_1.z.string().datetime()
});
