import { describe, expect, it } from "vitest";

import {
  authSessionSchema,
  pairDeviceRequestSchema,
  pairingCodeViewSchema
} from "../src/index";

describe("contracts", () => {
  it("accepts a valid pairing code view", () => {
    const result = pairingCodeViewSchema.safeParse({
      code: "ABCDEF",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date().toISOString(),
      claimedAt: null
    });

    expect(result.success).toBe(true);
  });

  it("rejects non alphabetic pairing codes", () => {
    const result = pairDeviceRequestSchema.safeParse({
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

    expect(result.success).toBe(false);
  });

  it("requires complete auth session payloads", () => {
    const result = authSessionSchema.safeParse({
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

    expect(result.success).toBe(true);
  });
});
