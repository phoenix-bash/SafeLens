import {
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import {
  CallLogBatchIngestRequest,
  CallLogsPage,
  CallLogsQuery
} from "@safelens/contracts";

import { PrismaService } from "../../core/prisma.service";

const DEFAULT_LIMIT = 25;

@Injectable()
export class CallLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestBatch(
    workspaceId: string,
    deviceId: string,
    input: CallLogBatchIngestRequest
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await (tx as any).callLogRecord.findMany({
          where: {
            OR: [
              { clientId: { in: input.callLogs.map((item) => item.clientId) } },
              { fingerprint: { in: input.callLogs.map((item) => item.fingerprint) }, deviceId }
            ]
          },
          select: {
            id: true,
            clientId: true,
            fingerprint: true
          }
        });

        const existingClientIds = new Set(existing.map((item: any) => item.clientId));
        const existingByFingerprint = new Map<string, any>(
          existing.map((item: any) => [item.fingerprint, item])
        );

        for (const item of input.callLogs) {
          if (existingClientIds.has(item.clientId)) {
            continue;
          }

          const existingRecord = existingByFingerprint.get(item.fingerprint);
          if (existingRecord) {
            await (tx as any).callLogRecord.update({
              where: { id: existingRecord.id },
              data: {
                clientId: item.clientId,
                contactName: item.contactName,
                phoneNumber: item.phoneNumber,
                callType: item.callType,
                durationSeconds: item.durationSeconds,
                occurredAt: new Date(item.occurredAt)
              }
            });
            existingClientIds.add(item.clientId);
            continue;
          }

          await (tx as any).callLogRecord.create({
            data: {
              clientId: item.clientId,
              fingerprint: item.fingerprint,
              deviceId,
              workspaceId,
              contactName: item.contactName,
              phoneNumber: item.phoneNumber,
              callType: item.callType,
              durationSeconds: item.durationSeconds,
              occurredAt: new Date(item.occurredAt)
            }
          });
        }
      });
    } catch (error) {
      this.rethrowSchemaSyncError(error);
      throw error;
    }

    return { success: true };
  }

  async clearForDevice(workspaceId: string, deviceId: string) {
    await this.requireWorkspaceDevice(workspaceId, deviceId);

    try {
      await (this.prisma as any).callLogRecord.deleteMany({
        where: {
          deviceId,
          workspaceId
        }
      });
    } catch (error) {
      this.rethrowSchemaSyncError(error);
      throw error;
    }

    return { success: true };
  }

  async listForDevice(
    workspaceId: string,
    deviceId: string,
    query: CallLogsQuery
  ): Promise<CallLogsPage> {
    await this.requireWorkspaceDevice(workspaceId, deviceId);

    const limit = query.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(query.cursor);
    let items: any[];
    try {
      items = await (this.prisma as any).callLogRecord.findMany({
        where: {
          deviceId,
          workspaceId,
          ...(cursor
            ? {
                OR: [
                  { occurredAt: { lt: cursor.occurredAt } },
                  {
                    occurredAt: cursor.occurredAt,
                    id: { lt: cursor.id }
                  }
                ]
              }
            : {})
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: limit + 1
      });
    } catch (error) {
      this.rethrowSchemaSyncError(error);
      throw error;
    }

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const lastItem = pageItems.at(-1);

    return {
      items: pageItems.map((item: any) => ({
        id: item.id,
        clientId: item.clientId,
        deviceId: item.deviceId,
        workspaceId: item.workspaceId,
        fingerprint: item.fingerprint,
        contactName: item.contactName,
        phoneNumber: item.phoneNumber,
        callType: item.callType,
        durationSeconds: item.durationSeconds,
        occurredAt: item.occurredAt.toISOString(),
        createdAt: item.createdAt.toISOString()
      })),
      nextCursor:
        hasMore && lastItem
          ? encodeCursor(lastItem.id, lastItem.occurredAt.toISOString())
          : null
    };
  }

  private async requireWorkspaceDevice(workspaceId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        workspaceId
      }
    });

    if (!device) {
      throw new NotFoundException("Device not found.");
    }

    return device;
  }

  private rethrowSchemaSyncError(error: unknown): never | void {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "";

    if (code === "P2021" || /calllogrecord|call_log_record/i.test(message)) {
      throw new InternalServerErrorException(
        "Call log schema is not applied in the database yet. Run `npm run prisma:push --workspace @safelens/api` and restart the API."
      );
    }
  }
}

function encodeCursor(id: string, occurredAt: string) {
  return Buffer.from(JSON.stringify({ id, occurredAt })).toString("base64url");
}

function decodeCursor(cursor?: string) {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      id: string;
      occurredAt: string;
    };
    return {
      id: parsed.id,
      occurredAt: new Date(parsed.occurredAt)
    };
  } catch {
    return null;
  }
}
