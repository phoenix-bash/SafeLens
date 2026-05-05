import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../core/prisma.service";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  createForOwner(input: { ownerUserId: string; displayName: string }) {
    return this.prisma.workspace.create({
      data: {
        name: `${input.displayName}'s Workspace`,
        ownerUserId: input.ownerUserId
      }
    });
  }

  getById(workspaceId: string) {
    return this.prisma.workspace.findUnique({
      where: { id: workspaceId }
    });
  }

  getByOwnerUserId(ownerUserId: string) {
    return this.prisma.workspace.findUnique({
      where: { ownerUserId }
    });
  }
}
