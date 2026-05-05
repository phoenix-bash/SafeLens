import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../core/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: {
    workspaceId: string;
    actorType: "user" | "device" | "system";
    actorId: string;
    eventType: string;
    payload?: Record<string, unknown>;
  }) {
    return this.prisma.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: input.actorType,
        actorId: input.actorId,
        eventType: input.eventType,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue
      }
    });
  }
}
