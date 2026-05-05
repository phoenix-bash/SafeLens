import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";

import { DeviceCapability, DeviceDetail, DeviceSummary } from "@safelens/contracts";
import { PrismaService } from "../../core/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RealtimeService } from "../realtime/realtime.service";

interface DeviceCapabilityRow {
  key: string;
  label: string;
  status: string;
}

interface DeviceWithCapabilities {
  id: string;
  workspaceId: string;
  fingerprint?: string | null;
  name: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  isOnline: boolean;
  pairedAt: Date;
  lastSeenAt: Date;
  activeSessionId: string | null;
  capabilities: DeviceCapabilityRow[];
  sessions: Array<{
    id: string;
    revokedAt: Date | null;
  }>;
}

interface ActiveDeviceSessionRecord {
  deviceId: string;
  workspaceId: string;
}

const ONLINE_TIMEOUT_MS = 25_000;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService
  ) {}

  async listForWorkspace(workspaceId: string): Promise<DeviceSummary[]> {
    await this.markStaleDevicesOffline(workspaceId);

    const devices = (await this.prisma.device.findMany({
      where: { workspaceId },
      include: {
        capabilities: true,
        sessions: {
          select: {
            id: true,
            revokedAt: true
          }
        }
      },
      orderBy: {
        pairedAt: "desc"
      }
    })) as DeviceWithCapabilities[];

    return devices.map((device) => this.toDeviceSummary(device));
  }

  async getForWorkspace(workspaceId: string, deviceId: string): Promise<DeviceDetail> {
    const device = await this.requireWorkspaceDevice(workspaceId, deviceId);
    return this.toDeviceDetail(device);
  }

  async getActiveDeviceSession(
    deviceToken: string
  ): Promise<ActiveDeviceSessionRecord | null> {
    const session = await this.prisma.deviceSession.findUnique({
      where: { deviceToken }
    });

    if (!session || session.revokedAt) {
      return null;
    }

    return {
      deviceId: session.deviceId,
      workspaceId: session.workspaceId
    };
  }

  async getSelfDevice(deviceId: string, workspaceId: string): Promise<DeviceDetail> {
    const device = await this.requireWorkspaceDevice(workspaceId, deviceId);
    return this.toDeviceDetail(device);
  }

  async heartbeatSelfSession(deviceId: string, workspaceId: string): Promise<DeviceDetail> {
    const now = new Date();

    await this.prisma.$transaction(async (tx: any) => {
      await tx.device.update({
        where: { id: deviceId },
        data: {
          isOnline: true,
          lastSeenAt: now
        }
      });
      await tx.deviceSession.updateMany({
        where: {
          deviceId,
          workspaceId,
          revokedAt: null
        },
        data: {
          lastSeenAt: now
        }
      });
    });

    return this.getSelfDevice(deviceId, workspaceId);
  }

  async createPairedDevice(input: {
    workspaceId: string;
    deviceName: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    deviceFingerprint: string;
    capabilities: DeviceCapability[];
  }) {
    const now = new Date();
    const workspaceDevices = (await this.prisma.device.findMany({
      where: {
        workspaceId: input.workspaceId
      },
      include: {
        capabilities: true,
        sessions: {
          select: {
            id: true,
            revokedAt: true
          }
        }
      },
      orderBy: {
        pairedAt: "desc"
      }
    })) as DeviceWithCapabilities[];

    const exactFingerprintMatch = workspaceDevices.find(
      (device) => device.fingerprint === input.deviceFingerprint
    );
    const legacyMatches = workspaceDevices.filter(
      (device) =>
        !device.fingerprint &&
        device.name === input.deviceName &&
        device.model === input.model &&
        device.manufacturer === input.manufacturer &&
        device.androidVersion === input.androidVersion
    );
    const canonicalDevice = exactFingerprintMatch ?? legacyMatches[0] ?? null;
    const duplicateDevices = workspaceDevices.filter((device) => {
      if (!canonicalDevice || device.id === canonicalDevice.id) {
        return false;
      }

      if (device.fingerprint === input.deviceFingerprint) {
        return true;
      }

      return (
        !device.fingerprint &&
        device.name === input.deviceName &&
        device.model === input.model &&
        device.manufacturer === input.manufacturer &&
        device.androidVersion === input.androidVersion
      );
    });
    const deviceId = canonicalDevice?.id ?? randomUUID();
    const sessionId = randomUUID();
    const sessionTtlDays = this.getDays("REFRESH_TOKEN_TTL_DAYS", 30);
    const deviceToken = randomBytes(32).toString("base64url");
    const supersededDeviceIds = duplicateDevices.map((device) => device.id);

    this.logger.log(
      `Pairing request workspaceId=${input.workspaceId} canonicalDeviceId=${canonicalDevice?.id ?? "new"} supersededDeviceCount=${supersededDeviceIds.length}`
    );

    await this.prisma.$transaction(async (tx: any) => {
      if (canonicalDevice) {
        await tx.deviceSession.updateMany({
          where: {
            deviceId: canonicalDevice.id,
            workspaceId: input.workspaceId,
            revokedAt: null
          },
          data: {
            revokedAt: now
          }
        });
        for (const duplicateDeviceId of supersededDeviceIds) {
          await tx.deviceSession.updateMany({
            where: {
              deviceId: duplicateDeviceId,
              workspaceId: input.workspaceId,
              revokedAt: null
            },
            data: {
              revokedAt: now
            }
          });
        }
        await tx.device.update({
          where: { id: canonicalDevice.id },
          data: {
            fingerprint: input.deviceFingerprint,
            name: input.deviceName,
            model: input.model,
            manufacturer: input.manufacturer,
            androidVersion: input.androidVersion,
            pairedAt: now,
            lastSeenAt: now,
            isOnline: true,
            activeSessionId: sessionId,
            capabilities: {
              deleteMany: {},
              create: input.capabilities.map((capability) => ({
                key: capability.key,
                label: capability.label,
                status: capability.status
              }))
            }
          }
        });
        for (const duplicateDeviceId of supersededDeviceIds) {
          await tx.device.delete({
            where: { id: duplicateDeviceId }
          });
        }
      } else {
        await tx.device.create({
          data: {
            id: deviceId,
            workspaceId: input.workspaceId,
            fingerprint: input.deviceFingerprint,
            name: input.deviceName,
            model: input.model,
            manufacturer: input.manufacturer,
            androidVersion: input.androidVersion,
            pairedAt: now,
            lastSeenAt: now,
            isOnline: true,
            activeSessionId: sessionId,
            capabilities: {
              create: input.capabilities.map((capability) => ({
                key: capability.key,
                label: capability.label,
                status: capability.status
              }))
            }
          }
        });
      }

      await tx.deviceSession.create({
        data: {
          id: sessionId,
          deviceId,
          workspaceId: input.workspaceId,
          deviceToken,
          expiresAt: new Date(
            Date.now() + sessionTtlDays * 24 * 60 * 60_000
          ),
          lastSeenAt: now
        }
      });
    });

    await this.auditService.record({
      workspaceId: input.workspaceId,
      actorType: "device",
      actorId: deviceId,
      eventType: "device.paired",
      payload: {
        deviceName: input.deviceName,
        replacedExistingDevice: Boolean(canonicalDevice),
        supersededDeviceIds
      }
    });
    this.realtimeService.emitToWorkspace(input.workspaceId, "device.online", {
      channel: "device.online",
      workspaceId: input.workspaceId,
      deviceId,
      occurredAt: now.toISOString()
    });
    this.realtimeService.emitToWorkspace(
      input.workspaceId,
      "device.capabilities.updated",
      {
        channel: "device.capabilities.updated",
        workspaceId: input.workspaceId,
        deviceId,
        occurredAt: now.toISOString()
      }
    );

    return {
      deviceId,
      deviceToken,
      workspaceId: input.workspaceId,
      pairedAt: now.toISOString()
    };
  }

  async revokeSession(workspaceId: string, deviceId: string, reason?: string) {
    const device = await this.requireWorkspaceDevice(workspaceId, deviceId);

    if (!device.activeSessionId) {
      return this.toDeviceDetail(device);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      await tx.deviceSession.updateMany({
        where: {
          id: device.activeSessionId
        },
        data: {
          revokedAt: now
        }
      });
      await tx.device.update({
        where: { id: deviceId },
        data: {
          activeSessionId: null,
          isOnline: false,
          lastSeenAt: now
        }
      });
    });

    await this.auditService.record({
      workspaceId,
      actorType: "user",
      actorId: workspaceId,
      eventType: "device.session_revoked",
      payload: { deviceId, reason: reason || "manual" }
    });
    this.realtimeService.emitToWorkspace(workspaceId, "device.offline", {
      channel: "device.offline",
      workspaceId,
      deviceId,
      occurredAt: now.toISOString()
    });
    this.logger.warn(
      `Device session revoked workspaceId=${workspaceId} deviceId=${deviceId} reason=${reason || "manual"}`
    );

    return this.getForWorkspace(workspaceId, deviceId);
  }

  async deleteDevice(workspaceId: string, deviceId: string) {
    await this.requireWorkspaceDevice(workspaceId, deviceId);

    await this.prisma.device.delete({
      where: { id: deviceId }
    });

    await this.auditService.record({
      workspaceId,
      actorType: "user",
      actorId: workspaceId,
      eventType: "device.deleted",
      payload: { deviceId }
    });
    this.realtimeService.emitToWorkspace(workspaceId, "device.offline", {
      channel: "device.offline",
      workspaceId,
      deviceId,
      occurredAt: new Date().toISOString()
    });
    this.logger.warn(
      `Device deleted workspaceId=${workspaceId} deviceId=${deviceId}`
    );

    return { success: true };
  }

  async deleteSelfDevice(deviceId: string, workspaceId: string) {
    return this.revokeSession(workspaceId, deviceId, "device_self_unpair");
  }

  private async requireWorkspaceDevice(workspaceId: string, deviceId: string) {
    const device = (await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        workspaceId
      },
      include: {
        capabilities: true,
        sessions: {
          select: {
            id: true,
            revokedAt: true
          }
        }
      }
    })) as DeviceWithCapabilities | null;

    if (!device) {
      throw new NotFoundException("Device not found.");
    }

    return device;
  }

  private async markStaleDevicesOffline(workspaceId: string) {
    const cutoff = new Date(Date.now() - ONLINE_TIMEOUT_MS);

    await this.prisma.device.updateMany({
      where: {
        workspaceId,
        isOnline: true,
        lastSeenAt: {
          lt: cutoff
        }
      },
      data: {
        isOnline: false
      }
    });
  }

  private async removeDuplicateLegacyDevices(workspaceId: string) {
    const devices = (await this.prisma.device.findMany({
      where: { workspaceId },
      include: {
        capabilities: true,
        sessions: {
          select: {
            id: true,
            revokedAt: true
          }
        }
      },
      orderBy: {
        pairedAt: "desc"
      }
    })) as DeviceWithCapabilities[];

    const legacyGroups = new Map<string, DeviceWithCapabilities[]>();

    for (const device of devices) {
      if (device.fingerprint) {
        continue;
      }

      const legacyKey = [
        device.name,
        device.model,
        device.manufacturer,
        device.androidVersion
      ].join("|");
      const group = legacyGroups.get(legacyKey) ?? [];
      group.push(device);
      legacyGroups.set(legacyKey, group);
    }

    const duplicateDeviceIds = Array.from(legacyGroups.values())
      .filter((group) => group.length > 1)
      .flatMap((group) => group.slice(1).map((device) => device.id));

    if (duplicateDeviceIds.length > 0) {
      this.logger.warn(
        `Removing duplicate legacy devices workspaceId=${workspaceId} duplicateCount=${duplicateDeviceIds.length}`
      );
    }

    for (const duplicateDeviceId of duplicateDeviceIds) {
      await this.prisma.device.delete({
        where: { id: duplicateDeviceId }
      });
    }
  }

  private toDeviceSummary(device: DeviceWithCapabilities): DeviceSummary {
    const isPaired =
      Boolean(device.activeSessionId) ||
      device.sessions.some((session) => session.revokedAt === null);

    return {
      id: device.id,
      workspaceId: device.workspaceId,
      name: device.name,
      model: device.model,
      manufacturer: device.manufacturer,
      androidVersion: device.androidVersion,
      isPaired,
      isOnline: device.isOnline,
      pairedAt: device.pairedAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      capabilities: device.capabilities.map((capability: DeviceCapabilityRow) => ({
        key: capability.key,
        label: capability.label,
        status: capability.status as DeviceCapability["status"]
      }))
    };
  }

  private toDeviceDetail(device: DeviceWithCapabilities): DeviceDetail {
    return {
      ...this.toDeviceSummary(device),
      activeSessionId: device.activeSessionId
    };
  }

  private getDays(key: string, fallback: number) {
    const rawValue = this.configService.get<string>(key);
    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
