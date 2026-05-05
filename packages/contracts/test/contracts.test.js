"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../src/index");
(0, vitest_1.describe)("contracts", () => {
    (0, vitest_1.it)("accepts a valid pairing code view", () => {
        const result = index_1.pairingCodeViewSchema.safeParse({
            code: "ABCDEF",
            workspaceId: "11111111-1111-4111-8111-111111111111",
            expiresAt: new Date().toISOString(),
            claimedAt: null
        });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)("rejects non alphabetic pairing codes", () => {
        const result = index_1.pairDeviceRequestSchema.safeParse({
            code: "123456",
            deviceName: "Pixel",
            model: "Pixel 9",
            manufacturer: "Google",
            androidVersion: "15",
            capabilities: [
                {
                    key: "camera",
                    label: "Camera Control",
                    status: "available"
                }
            ]
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("requires complete auth session payloads", () => {
        const result = index_1.authSessionSchema.safeParse({
            accessToken: "a".repeat(24),
            refreshToken: "b".repeat(24),
            expiresAt: new Date().toISOString(),
            user: {
                id: "11111111-1111-4111-8111-111111111111",
                email: "owner@example.com",
                displayName: "Owner",
                createdAt: new Date().toISOString()
            },
            workspace: {
                id: "22222222-2222-4222-8222-222222222222",
                name: "Owner Workspace",
                ownerUserId: "11111111-1111-4111-8111-111111111111",
                createdAt: new Date().toISOString()
            }
        });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
});
