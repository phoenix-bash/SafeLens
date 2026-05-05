"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeDeviceSessionRequestSchema = exports.deviceDetailSchema = exports.deviceSummarySchema = exports.deviceCapabilityManifestSchema = exports.deviceCapabilitySchema = exports.featureStatusSchema = void 0;
const zod_1 = require("zod");
exports.featureStatusSchema = zod_1.z.enum(["available", "planned", "unsupported"]);
exports.deviceCapabilitySchema = zod_1.z.object({
    key: zod_1.z.string().min(2),
    label: zod_1.z.string().min(2),
    status: exports.featureStatusSchema
});
exports.deviceCapabilityManifestSchema = zod_1.z.object({
    capabilities: zod_1.z.array(exports.deviceCapabilitySchema).min(1)
});
exports.deviceSummarySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    workspaceId: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    model: zod_1.z.string().min(1),
    manufacturer: zod_1.z.string().min(1),
    androidVersion: zod_1.z.string().min(1),
    isOnline: zod_1.z.boolean(),
    pairedAt: zod_1.z.string().datetime(),
    lastSeenAt: zod_1.z.string().datetime(),
    capabilities: zod_1.z.array(exports.deviceCapabilitySchema)
});
exports.deviceDetailSchema = exports.deviceSummarySchema.extend({
    activeSessionId: zod_1.z.string().uuid().nullable()
});
exports.revokeDeviceSessionRequestSchema = zod_1.z.object({
    reason: zod_1.z.string().min(3).max(160).optional()
});
