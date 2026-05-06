import {
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import {
  CallRecordingBatchIngestRequest,
  CallRecordingRecord,
  CallRecordingsDownloadRequest,
  CallRecordingsPage,
  CallRecordingsQuery
} from "@safelens/contracts";

import { PrismaService } from "../../core/prisma.service";

const DEFAULT_LIMIT = 10;

type RecordingCursor = {
  id: string;
  capturedAt: string;
};

@Injectable()
export class CallRecordingsService {
  constructor(private readonly prisma: PrismaService) {}

  private getCallRecordingRecordModel() {
    const model = (this.prisma as any).callRecordingRecord;
    if (!model) {
      throw new InternalServerErrorException(
        "Prisma client is out of date for call recordings. Stop the API, run `npm run prisma:generate --workspace @safelens/api`, then restart the API."
      );
    }
    return model;
  }

  async ingestBatch(
    workspaceId: string,
    deviceId: string,
    input: CallRecordingBatchIngestRequest
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await (tx as any).callRecordingRecord.findMany({
          where: {
            OR: [
              { clientId: { in: input.recordings.map((item) => item.clientId) } },
              {
                fingerprint: { in: input.recordings.map((item) => item.fingerprint) },
                deviceId
              }
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

        for (const item of input.recordings) {
          if (existingClientIds.has(item.clientId)) {
            continue;
          }

          const existingRecord = existingByFingerprint.get(item.fingerprint);
          if (existingRecord) {
            await (tx as any).callRecordingRecord.update({
              where: { id: existingRecord.id },
              data: {
                clientId: item.clientId,
                source: item.source,
                fileName: item.fileName,
                mimeType: item.mimeType,
                extension: item.extension,
                byteSize: item.byteSize,
                relativePath: item.relativePath,
                capturedAt: new Date(item.capturedAt),
                contentBase64: item.contentBase64
              }
            });
            existingClientIds.add(item.clientId);
            continue;
          }

          await (tx as any).callRecordingRecord.create({
            data: {
              clientId: item.clientId,
              fingerprint: item.fingerprint,
              deviceId,
              workspaceId,
              source: item.source,
              fileName: item.fileName,
              mimeType: item.mimeType,
              extension: item.extension,
              byteSize: item.byteSize,
              relativePath: item.relativePath,
              capturedAt: new Date(item.capturedAt),
              contentBase64: item.contentBase64
            }
          });
          existingClientIds.add(item.clientId);
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
    query: CallRecordingsQuery
  ): Promise<CallRecordingsPage> {
    await this.requireWorkspaceDevice(workspaceId, deviceId);
    const callRecordingRecordModel = this.getCallRecordingRecordModel();

    const limit = query.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(query.cursor);
    let items: any[];

    try {
      items = await callRecordingRecordModel.findMany({
        where: {
          deviceId,
          workspaceId,
          ...(cursor
            ? {
                OR: [
                  { capturedAt: { lt: new Date(cursor.capturedAt) } },
                  {
                    capturedAt: new Date(cursor.capturedAt),
                    id: { lt: cursor.id }
                  }
                ]
              }
            : {})
        },
        orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
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
      items: pageItems.map((item: any) => this.toRecord(item)),
      nextCursor:
        hasMore && lastItem
          ? encodeCursor(lastItem.id, lastItem.capturedAt.toISOString())
          : null
    };
  }

  async clearForDevice(workspaceId: string, deviceId: string) {
    await this.requireWorkspaceDevice(workspaceId, deviceId);
    const callRecordingRecordModel = this.getCallRecordingRecordModel();

    try {
      await callRecordingRecordModel.deleteMany({
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

  async listForDownload(
    workspaceId: string,
    deviceId: string,
    input: CallRecordingsDownloadRequest
  ) {
    await this.requireWorkspaceDevice(workspaceId, deviceId);
    const callRecordingRecordModel = this.getCallRecordingRecordModel();

    let items: any[];
    try {
      items = await callRecordingRecordModel.findMany({
        where: {
          workspaceId,
          deviceId,
          id: { in: input.ids }
        },
        orderBy: [{ capturedAt: "desc" }, { id: "desc" }]
      });
    } catch (error) {
      this.rethrowSchemaSyncError(error);
      throw error;
    }

    return {
      files: items.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        capturedAt: item.capturedAt.toISOString(),
        contentBase64: item.contentBase64
      }))
    };
  }

  private toRecord(item: any): CallRecordingRecord {
    return {
      id: item.id,
      clientId: item.clientId,
      deviceId: item.deviceId,
      workspaceId: item.workspaceId,
      fingerprint: item.fingerprint,
      source: item.source,
      fileName: item.fileName,
      mimeType: item.mimeType,
      extension: item.extension,
      byteSize: item.byteSize,
      relativePath: item.relativePath,
      capturedAt: item.capturedAt.toISOString(),
      contentBase64: item.contentBase64,
      createdAt: item.createdAt.toISOString()
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

    if (code === "P2021" || /callrecordingrecord|call_recording_record/i.test(message)) {
      throw new InternalServerErrorException(
        "Call recording schema is not applied in the database yet. Run `npm run prisma:push --workspace @safelens/api` and restart the API."
      );
    }
  }
}

function encodeCursor(id: string, capturedAt: string) {
  const value = JSON.stringify({ id, capturedAt });
  return Buffer.from(value).toString("base64url");
}

function decodeCursor(rawCursor?: string | null): RecordingCursor | null {
  if (!rawCursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as {
      id?: unknown;
      capturedAt?: unknown;
    };

    if (typeof parsed.id !== "string" || typeof parsed.capturedAt !== "string") {
      return null;
    }

    return {
      id: parsed.id,
      capturedAt: parsed.capturedAt
    };
  } catch {
    return null;
  }
}
