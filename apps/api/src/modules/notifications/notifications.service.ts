import { Injectable, NotFoundException } from "@nestjs/common";
import {
  NotificationBatchIngestRequest,
  NotificationsPage,
  NotificationsQuery
} from "@safelens/contracts";

import { PrismaService } from "../../core/prisma.service";

const DEFAULT_LIMIT = 20;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestBatch(
    workspaceId: string,
    deviceId: string,
    input: NotificationBatchIngestRequest
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await (tx as any).notificationRecord.findMany({
        where: {
          OR: [
            { clientId: { in: input.notifications.map((item) => item.clientId) } },
            { fingerprint: { in: input.notifications.map((item) => item.fingerprint) }, deviceId }
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

      for (const item of input.notifications) {
        if (existingClientIds.has(item.clientId)) {
          continue;
        }

        const existingRecord = existingByFingerprint.get(item.fingerprint);
        if (existingRecord) {
          await (tx as any).notificationRecord.update({
            where: { id: existingRecord.id },
            data: {
              clientId: item.clientId,
              packageName: item.packageName,
              appLabel: item.appLabel,
              title: item.title,
              text: item.text,
              postedAt: new Date(item.postedAt)
            }
          });
          existingClientIds.add(item.clientId);
          existingByFingerprint.set(item.fingerprint, {
            ...existingRecord,
            clientId: item.clientId
          });
          continue;
        }

        await (tx as any).notificationRecord.create({
          data: {
            clientId: item.clientId,
            fingerprint: item.fingerprint,
            deviceId,
            workspaceId,
            packageName: item.packageName,
            appLabel: item.appLabel,
            title: item.title,
            text: item.text,
            postedAt: new Date(item.postedAt)
          }
        });
      }
    });

    return { success: true };
  }

  async clearForDevice(workspaceId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        workspaceId
      }
    });

    if (!device) {
      throw new NotFoundException("Device not found.");
    }

    await (this.prisma as any).notificationRecord.deleteMany({
      where: {
        deviceId,
        workspaceId
      }
    });

    return { success: true };
  }

  async listForDevice(
    workspaceId: string,
    deviceId: string,
    query: NotificationsQuery
  ): Promise<NotificationsPage> {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        workspaceId
      }
    });

    if (!device) {
      throw new NotFoundException("Device not found.");
    }

    const limit = query.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const where = {
      deviceId,
      workspaceId,
      ...(query.appLabel ? { appLabel: query.appLabel } : {}),
      ...(query.query
        ? {
            OR: [
              { title: { contains: query.query, mode: "insensitive" as const } },
              { text: { contains: query.query, mode: "insensitive" as const } }
            ]
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { postedAt: { lt: cursor.postedAt } },
              {
                postedAt: cursor.postedAt,
                id: { lt: cursor.id }
              }
            ]
          }
        : {})
    };

    const items = await (this.prisma as any).notificationRecord.findMany({
      where,
      orderBy: [{ postedAt: "desc" }, { id: "desc" }],
      take: limit + 1
    });

    const appGroupsRaw = await (this.prisma as any).notificationRecord.groupBy({
      by: ["appLabel"],
      where: {
        deviceId,
        workspaceId
      },
      _count: {
        _all: true
      }
    });

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const lastItem = pageItems.at(-1);

    return {
      items: pageItems.map((item: any) => ({
        id: item.id,
        clientId: item.clientId,
        deviceId: item.deviceId,
        workspaceId: item.workspaceId,
        packageName: item.packageName,
        appLabel: item.appLabel,
        title: item.title,
        text: item.text,
        postedAt: item.postedAt.toISOString(),
        createdAt: item.createdAt.toISOString()
      })),
      nextCursor:
        hasMore && lastItem
          ? encodeCursor(lastItem.id, lastItem.postedAt.toISOString())
          : null,
      appGroups: appGroupsRaw
        .map((group: any) => ({
          appLabel: group.appLabel,
          count: group._count._all
        }))
        .sort((left: any, right: any) => right.count - left.count || left.appLabel.localeCompare(right.appLabel))
    };
  }
}

function encodeCursor(id: string, postedAt: string) {
  return Buffer.from(JSON.stringify({ id, postedAt })).toString("base64url");
}

function decodeCursor(cursor?: string) {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      id: string;
      postedAt: string;
    };
    return {
      id: parsed.id,
      postedAt: new Date(parsed.postedAt)
    };
  } catch {
    return null;
  }
}
