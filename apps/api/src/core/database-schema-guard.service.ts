import { Injectable, InternalServerErrorException, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "./prisma.service";

@Injectable()
export class DatabaseSchemaGuardService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.assertRequiredTables();
  }

  private async assertRequiredTables() {
    const prisma = this.prisma ?? new PrismaClient();
    const requiredTables = [
      "Workspace",
      "Device",
      "NotificationRecord",
      "CallLogRecord"
    ] as const;

    const missingTables: string[] = [];
    try {
      for (const tableName of requiredTables) {
        const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ${tableName}
          ) AS "exists"
        `;

        if (!result[0]?.exists) {
          missingTables.push(tableName);
        }
      }
    } finally {
      if (!this.prisma) {
        await prisma.$disconnect();
      }
    }

    if (!missingTables.length) {
      return;
    }

    throw new InternalServerErrorException(
      `Database schema is out of date. Missing tables: ${missingTables.join(
        ", "
      )}. Run \`npm run prisma:push --workspace @safelens/api\` and restart the API.`
    );
  }
}
