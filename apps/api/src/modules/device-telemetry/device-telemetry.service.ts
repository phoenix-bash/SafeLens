import { Injectable, NotFoundException } from "@nestjs/common";
import {
  DeviceTelemetryState,
  LocationSnapshot,
  TelemetryBatchIngestRequest,
  TelemetrySnapshotIngest
} from "@safelens/contracts";

import { PrismaService } from "../../core/prisma.service";

const HISTORY_LIMIT = 15;

@Injectable()
export class DeviceTelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestBatch(
    workspaceId: string,
    deviceId: string,
    input: TelemetryBatchIngestRequest
  ) {
    await this.prisma.$transaction(async (tx) => {
      const snapshots = dedupeSnapshotsByClientId(input.snapshots);
      const existing = await (tx as any).deviceTelemetryHistory.findMany({
        where: {
          clientId: {
            in: snapshots.map((snapshot) => snapshot.clientId)
          }
        },
        select: {
          clientId: true
        }
      });
      const existingIds = new Set(existing.map((item: any) => item.clientId));
      const newSnapshots = snapshots.filter(
        (snapshot) => !existingIds.has(snapshot.clientId)
      );

      if (newSnapshots.length > 0) {
        await (tx as any).deviceTelemetryHistory.createMany({
          data: newSnapshots.map((snapshot) => ({
            clientId: snapshot.clientId,
            deviceId,
            workspaceId,
            kind: snapshot.kind,
            payload: snapshot.payload,
            collectedAt: new Date(snapshot.collectedAt)
          })),
          skipDuplicates: true
        });
      }

      for (const snapshot of newSnapshots) {
        await this.upsertTelemetryState(tx as any, workspaceId, deviceId, snapshot);
      }

      await this.trimHistory(tx as any, deviceId);
    });

    return { success: true };
  }

  async getState(workspaceId: string, deviceId: string): Promise<DeviceTelemetryState> {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        workspaceId
      }
    });

    if (!device) {
      throw new NotFoundException("Device not found.");
    }

    const [state, history] = await Promise.all([
      (this.prisma as any).deviceTelemetryState.findUnique({
        where: { deviceId }
      }),
      (this.prisma as any).deviceTelemetryHistory.findMany({
        where: {
          deviceId,
          workspaceId
        },
        orderBy: {
          collectedAt: "desc"
        },
        take: HISTORY_LIMIT
      })
    ]);

    return {
      deviceId,
      workspaceId,
      locationReportingEnabled: state?.locationReportingEnabled ?? true,
      locationIntervalMinutes: state?.locationIntervalMinutes ?? 10,
      latestInfoAt: state?.latestInfoAt?.toISOString() ?? null,
      latestBatteryAt: state?.latestBatteryAt?.toISOString() ?? null,
      latestLocationAt: state?.latestLocationAt?.toISOString() ?? null,
      latestInfo: (state?.latestInfo as DeviceTelemetryState["latestInfo"]) ?? null,
      latestBattery:
        (state?.latestBattery as DeviceTelemetryState["latestBattery"]) ?? null,
      latestLocation:
        (state?.latestLocation as DeviceTelemetryState["latestLocation"]) ?? null,
      recentHistory: history.map((item: any) => ({
        id: item.id,
        kind: item.kind as DeviceTelemetryState["recentHistory"][number]["kind"],
        collectedAt: item.collectedAt.toISOString(),
        payload: item.payload as DeviceTelemetryState["recentHistory"][number]["payload"]
      }))
    };
  }

  private async upsertTelemetryState(
    tx: any,
    workspaceId: string,
    deviceId: string,
    snapshot: TelemetrySnapshotIngest
  ) {
    const state = await tx.deviceTelemetryState.findUnique({
      where: { deviceId }
    });
    const collectedAt = new Date(snapshot.collectedAt);

    const nextState =
      snapshot.kind === "device_info"
        ? {
            latestInfo: snapshot.payload.deviceInfo ?? null,
            latestInfoAt: collectedAt
          }
        : snapshot.kind === "battery"
          ? {
              latestBattery: snapshot.payload.battery ?? null,
              latestBatteryAt: collectedAt
            }
          : buildLocationStateUpdate(
              snapshot.payload.location ?? null,
              (state?.latestLocation as DeviceTelemetryState["latestLocation"]) ?? null,
              state?.latestLocationAt ?? null,
              collectedAt
            );

    if (state) {
      await tx.deviceTelemetryState.update({
        where: { deviceId },
        data: nextState
      });
      return;
    }

    await tx.deviceTelemetryState.create({
      data: {
        deviceId,
        workspaceId,
        ...nextState
      }
    });
  }

  private async trimHistory(tx: any, deviceId: string) {
    const history = await tx.deviceTelemetryHistory.findMany({
      where: { deviceId },
      orderBy: {
        collectedAt: "desc"
      },
      skip: HISTORY_LIMIT
    });

    if (!history.length) {
      return;
    }

    await tx.deviceTelemetryHistory.deleteMany({
      where: {
        id: {
          in: history.map((item: any) => item.id)
        }
      }
    });
  }
}

function buildLocationStateUpdate(
  nextLocation: LocationSnapshot | null,
  previousLocation: DeviceTelemetryState["latestLocation"],
  previousLocationAt: Date | null,
  collectedAt: Date
) {
  if (!nextLocation) {
    return {
      latestLocation: null,
      latestLocationAt: collectedAt
    };
  }

  const hasCoordinates = nextLocation.latitude != null && nextLocation.longitude != null;
  const previousHasCoordinates =
    previousLocation?.latitude != null && previousLocation.longitude != null;

  if (!hasCoordinates && previousHasCoordinates && previousLocationAt) {
    return {
      latestLocation: {
        ...previousLocation,
        ...nextLocation,
        latitude: previousLocation.latitude,
        longitude: previousLocation.longitude,
        accuracyMeters: nextLocation.accuracyMeters ?? previousLocation.accuracyMeters,
        provider: nextLocation.provider || previousLocation.provider
      },
      latestLocationAt: previousLocationAt
    };
  }

  return {
    latestLocation: nextLocation,
    latestLocationAt: collectedAt
  };
}

function dedupeSnapshotsByClientId(snapshots: TelemetrySnapshotIngest[]) {
  const byClientId = new Map<string, TelemetrySnapshotIngest>();
  for (const snapshot of snapshots) {
    byClientId.set(snapshot.clientId, snapshot);
  }

  return [...byClientId.values()];
}
