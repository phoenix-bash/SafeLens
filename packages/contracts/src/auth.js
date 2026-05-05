"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authSessionSchema = exports.logoutRequestSchema = exports.refreshRequestSchema = exports.loginRequestSchema = exports.registerRequestSchema = exports.workspaceSummarySchema = exports.userSummarySchema = void 0;
const zod_1 = require("zod");
exports.userSummarySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    email: zod_1.z.string().email(),
    displayName: zod_1.z.string().min(1),
    createdAt: zod_1.z.string().datetime()
});
exports.workspaceSummarySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    ownerUserId: zod_1.z.string().uuid(),
    createdAt: zod_1.z.string().datetime()
});
exports.registerRequestSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    displayName: zod_1.z.string().min(2).max(60)
});
exports.loginRequestSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8)
});
exports.refreshRequestSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(24)
});
exports.logoutRequestSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(24).optional()
});
exports.authSessionSchema = zod_1.z.object({
    accessToken: zod_1.z.string().min(24),
    refreshToken: zod_1.z.string().min(24),
    expiresAt: zod_1.z.string().datetime(),
    user: exports.userSummarySchema,
    workspace: exports.workspaceSummarySchema
});
