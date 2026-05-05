import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceTelemetryService } from "../src/modules/device-telemetry/device-telemetry.service";

const workspaceId = "11111111-1111-1111-1111-111111111111";
const deviceId = "22222222-2222-2222-2222-222222222222";

type TelemetryHistoryRow = {
  id: string;
  clientId: string;
  deviceId: string;
  workspaceId: string;
  kind: string;
  payload: unknown;
  collectedAt: Date;
  createdAt: Date;
};

class FakePrismaService {
  private readonly history: TelemetryHistoryRow[] = [];
  private telemetryState: any = null;
  private historyIdCounter = 1;

  deviceTelemetryHistory = {
    findMany: vi.fn(async (args: any) => {
      if (args?.where?.clientId?.in) {
        return this.history
          .filter((item) => args.where.clientId.in.includes(item.clientId))
          .map((item) => ({ clientId: item.clientId }));
      }

      if (args?.where?.deviceId) {
        const sorted = [...this.history]
          .filter((item) => item.deviceId === args.where.deviceId)
          .sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime());
        const skip = args.skip ?? 0;
        return sorted.slice(skip);
      }

      return [];
    }),
    createMany: vi.fn(async (args: any) => {
      let inserted = 0;
      for (const row of args.data) {
        const exists = this.history.some((item) => item.clientId === row.clientId);
        if (exists && args.skipDuplicates) {
          continue;
        }

        this.history.push({
          id: `history-${this.historyIdCounter++}`,
          clientId: row.clientId,
          deviceId: row.deviceId,
          workspaceId: row.workspaceId,
          kind: row.kind,
          payload: row.payload,
          collectedAt: row.collectedAt,
          createdAt: new Date()
        });
        inserted += 1;
      }

      return { count: inserted };
    }),
    deleteMany: vi.fn(async (args: any) => {
      const ids = new Set(args.where.id.in as string[]);
      let removed = 0;

      for (let index = this.history.length - 1; index >= 0; index -= 1) {
        if (ids.has(this.history[index].id)) {
          this.history.splice(index, 1);
          removed += 1;
        }
      }

      return { count: removed };
    })
  };

  deviceTelemetryState = {
    findUnique: vi.fn(async () => this.telemetryState),
    create: vi.fn(async ({ data }: any) => {
      this.telemetryState = {
        id: "state-1",
        ...data
      };
      return this.telemetryState;
    }),
    update: vi.fn(async ({ data }: any) => {
      this.telemetryState = {
        ...this.telemetryState,
        ...data
      };
      return this.telemetryState;
    })
  };

  seedHistory(row: Omit<TelemetryHistoryRow, "id" | "createdAt">) {
    this.history.push({
      id: `history-${this.historyIdCounter++}`,
      createdAt: new Date(),
      ...row
    });
  }

  $transaction = async (callback: (tx: any) => Promise<any>) => callback(this);
}

describe("device telemetry ingestion", () => {
  let prisma: FakePrismaService;
  let service: DeviceTelemetryService;

  beforeEach(() => {
    prisma = new FakePrismaService();
    service = new DeviceTelemetryService(prisma as any);
  });

  it("deduplicates by clientId without transaction-aborting unique conflicts", async () => {
    const existingClientId = "33333333-3333-4333-8333-333333333333";
    prisma.seedHistory({
      clientId: existingClientId,
      deviceId,
      workspaceId,
      kind: "battery",
      payload: { battery: { levelPercent: 65, isCharging: false, statusLabel: "Old" } },
      collectedAt: new Date("2026-04-08T09:00:00.000Z")
    });

    const dedupeClientId = "44444444-4444-4444-8444-444444444444";
    await service.ingestBatch(workspaceId, deviceId, {
      snapshots: [
        {
          clientId: existingClientId,
          kind: "battery",
          collectedAt: "2026-04-08T09:01:00.000Z",
          payload: {
            battery: {
              levelPercent: 70,
              isCharging: true,
              statusLabel: "Charging"
            }
          }
        },
        {
          clientId: dedupeClientId,
          kind: "battery",
          collectedAt: "2026-04-08T09:02:00.000Z",
          payload: {
            battery: {
              levelPercent: 80,
              isCharging: true,
              statusLabel: "Charging"
            }
          }
        },
        {
          clientId: dedupeClientId,
          kind: "battery",
          collectedAt: "2026-04-08T09:03:00.000Z",
          payload: {
            battery: {
              levelPercent: 81,
              isCharging: true,
              statusLabel: "Charging"
            }
          }
        }
      ]
    });

    expect(prisma.deviceTelemetryHistory.createMany).toHaveBeenCalledTimes(1);
    const createManyArgs = prisma.deviceTelemetryHistory.createMany.mock.calls[0]?.[0];
    expect(createManyArgs.data).toHaveLength(1);
    expect(createManyArgs.data[0].clientId).toBe(dedupeClientId);
    expect(createManyArgs.skipDuplicates).toBe(true);
    expect(prisma.deviceTelemetryState.create).toHaveBeenCalledTimes(1);

    const state = await prisma.deviceTelemetryState.findUnique({
      where: { deviceId }
    });
    expect(state.latestBattery.levelPercent).toBe(81);
  });
});
