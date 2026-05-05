import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EphemeralStateService } from "../src/core/ephemeral-state.service";
import { CameraStreamService } from "../src/modules/camera-stream/camera-stream.service";

class FakePrismaService {
  device = {
    findFirst: vi.fn()
  };

  deviceCommand = {
    create: vi.fn()
  };
}

describe("camera stream session lifecycle", () => {
  const workspaceId = "11111111-1111-1111-1111-111111111111";
  const deviceId = "22222222-2222-2222-2222-222222222222";

  let prisma: FakePrismaService;
  let cameraStreamService: CameraStreamService;

  beforeEach(() => {
    prisma = new FakePrismaService();

    prisma.device.findFirst.mockResolvedValue({
      id: deviceId,
      workspaceId
    });

    prisma.deviceCommand.create.mockImplementation(async ({ data }: any) => ({
      id: "33333333-3333-3333-3333-333333333333",
      ...data,
      createdAt: new Date()
    }));

    const configService = new ConfigService({});
    const ephemeralState = new EphemeralStateService(new ConfigService({}));
    const auditService = {
      record: vi.fn().mockResolvedValue(undefined)
    };
    const realtimeService = {
      emitToWorkspace: vi.fn(),
      emitToDevice: vi.fn(),
      emitToSocket: vi.fn()
    };

    cameraStreamService = new CameraStreamService(
      prisma as any,
      configService,
      ephemeralState,
      auditService as any,
      realtimeService as any
    );
  });

  it("keeps session identity when device reports activation_blocked", async () => {
    const started = await cameraStreamService.startOrUpdateSession(workspaceId, deviceId, {
      cameraFacing: "back",
      includeAudio: false,
      preferredTransport: "webrtc"
    });

    expect(started.sessionId).toBeTruthy();

    await cameraStreamService.updateDeviceState(workspaceId, deviceId, {
      status: "activation_blocked",
      signalingReady: false,
      lastErrorCode: "fgs_start_blocked",
      lastError: "Android blocked camera activation"
    });

    const latest = await cameraStreamService.getState(workspaceId, deviceId);

    expect(latest.sessionId).toBe(started.sessionId);
    expect(latest.status).toBe("activation_blocked");
    expect(latest.signalingReady).toBe(false);
    expect(latest.lastErrorCode).toBe("fgs_start_blocked");
    expect(latest.lastError).toBe("Android blocked camera activation");
  });

  it("clears session identity when device returns to idle", async () => {
    const started = await cameraStreamService.startOrUpdateSession(workspaceId, deviceId, {
      cameraFacing: "front",
      includeAudio: true,
      preferredTransport: "webrtc"
    });

    expect(started.sessionId).toBeTruthy();

    await cameraStreamService.updateDeviceState(workspaceId, deviceId, {
      status: "idle",
      cameraSessionId: started.sessionId,
      signalingReady: false,
      lastError: null
    });

    const latest = await cameraStreamService.getState(workspaceId, deviceId);

    expect(latest.sessionId).toBeNull();
    expect(latest.startedAt).toBeNull();
    expect(latest.status).toBe("idle");
  });

  it("ignores stale idle updates that are missing or mismatched session identity", async () => {
    const started = await cameraStreamService.startOrUpdateSession(workspaceId, deviceId, {
      cameraFacing: "back",
      includeAudio: false,
      preferredTransport: "webrtc"
    });

    await cameraStreamService.updateDeviceState(workspaceId, deviceId, {
      status: "idle",
      signalingReady: false,
      lastError: null
    });

    const afterMissingSessionId = await cameraStreamService.getState(workspaceId, deviceId);

    expect(afterMissingSessionId.sessionId).toBe(started.sessionId);
    expect(afterMissingSessionId.status).toBe("starting");

    await cameraStreamService.updateDeviceState(workspaceId, deviceId, {
      status: "idle",
      cameraSessionId: "33333333-3333-3333-3333-333333333333",
      signalingReady: false,
      lastError: null
    });

    const afterMismatchedSessionId = await cameraStreamService.getState(
      workspaceId,
      deviceId
    );

    expect(afterMismatchedSessionId.sessionId).toBe(started.sessionId);
    expect(afterMismatchedSessionId.status).toBe("starting");
  });
});
