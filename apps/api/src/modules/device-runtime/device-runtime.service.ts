import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateDeviceCommandRequest,
  DeviceCommandAckRequest,
  DeviceCommandView
} from "@safelens/contracts";

import { PrismaService } from "../../core/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RealtimeService } from "../realtime/realtime.service";

@Injectable()
export class DeviceRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService
  ) {}

  async createCommand(
    workspaceId: string,
    deviceId: string,
    input: CreateDeviceCommandRequest
  ): Promise<DeviceCommandView> {
    await this.requireWorkspaceDevice(workspaceId, deviceId);

    const payload = this.resolveCommandPayload(input);

    const now = new Date();
    const command = await (this.prisma as any).deviceCommand.create({
      data: {
        deviceId,
        workspaceId,
        type: input.type,
        status: "pending",
        payload,
        dispatchedAt: now
      }
    });

    if (input.type === "device.start_location_reporting") {
      await this.upsertTelemetryState(deviceId, workspaceId, {
        locationReportingEnabled: true,
        locationIntervalMinutes: input.payload.intervalMinutes ?? 10
      });
    }

    if (input.type === "device.stop_location_reporting") {
      await this.upsertTelemetryState(deviceId, workspaceId, {
        locationReportingEnabled: false
      });
    }

    await this.auditService.record({
      workspaceId,
      actorType: "user",
      actorId: workspaceId,
      eventType: "device.command.created",
      payload: {
        deviceId,
        type: input.type
      }
    });

    const view = this.toCommandView(command);
    this.realtimeService.emitToDevice(deviceId, "device.command", view);
    return view;
  }

  private resolveCommandPayload(input: CreateDeviceCommandRequest) {
    if (input.type !== "device.refresh_call_recordings") {
      return input.payload;
    }

    const xiaomiPaths = this.parsePathsEnv(
      this.configService.get<string>("CALL_RECORDINGS_XIAOMI_PATHS")
    );
    const vivoPaths = this.parsePathsEnv(
      this.configService.get<string>("CALL_RECORDINGS_VIVO_PATHS")
    );

    return {
      ...input.payload,
      recordingsOffset: input.payload.recordingsOffset ?? 0,
      recordingsLimit: input.payload.recordingsLimit ?? 10,
      xiaomiCallRecordingPaths:
        input.payload.xiaomiCallRecordingPaths?.length
          ? input.payload.xiaomiCallRecordingPaths
          : xiaomiPaths,
      vivoCallRecordingPaths:
        input.payload.vivoCallRecordingPaths?.length
          ? input.payload.vivoCallRecordingPaths
          : vivoPaths
    };
  }

  private parsePathsEnv(rawValue: string | undefined) {
    if (!rawValue?.trim()) {
      return [];
    }

    const parsed = rawValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return parsed;
  }

  async listPendingCommands(
    workspaceId: string,
    deviceId: string
  ): Promise<{ commands: DeviceCommandView[] }> {
    const commands = await (this.prisma as any).deviceCommand.findMany({
      where: {
        workspaceId,
        deviceId,
        status: "pending"
      },
      orderBy: {
        createdAt: "asc"
      },
      take: 20
    });

    return {
      commands: commands.map((command: any) => this.toCommandView(command))
    };
  }

  async getCommand(
    workspaceId: string,
    deviceId: string,
    commandId: string
  ): Promise<DeviceCommandView> {
    const command = await (this.prisma as any).deviceCommand.findFirst({
      where: {
        id: commandId,
        workspaceId,
        deviceId
      }
    });

    if (!command) {
      throw new NotFoundException("Device command not found.");
    }

    return this.toCommandView(command);
  }

  async acknowledgeCommand(
    workspaceId: string,
    deviceId: string,
    commandId: string,
    input: DeviceCommandAckRequest
  ): Promise<DeviceCommandView> {
    const command = await (this.prisma as any).deviceCommand.findFirst({
      where: {
        id: commandId,
        workspaceId,
        deviceId
      }
    });

    if (!command) {
      throw new NotFoundException("Device command not found.");
    }

    const now = new Date();
    const updated = await (this.prisma as any).deviceCommand.update({
      where: { id: commandId },
      data: {
        status: input.status,
        acknowledgedAt:
          input.status === "acknowledged" || input.status === "completed" || input.status === "failed"
            ? command.acknowledgedAt ?? now
            : command.acknowledgedAt,
        completedAt:
          input.status === "completed" || input.status === "failed" ? now : null,
        lastError: input.lastError ?? null
      }
    });

    await this.auditService.record({
      workspaceId,
      actorType: "device",
      actorId: deviceId,
      eventType: "device.command.updated",
      payload: {
        commandId,
        status: updated.status
      }
    });

    return this.toCommandView(updated);
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

  private async upsertTelemetryState(
    deviceId: string,
    workspaceId: string,
    data: Record<string, unknown>
  ) {
    await (this.prisma as any).deviceTelemetryState.upsert({
      where: { deviceId },
      create: {
        deviceId,
        workspaceId,
        ...data
      },
      update: data
    });
  }

  private toCommandView(command: {
    id: string;
    workspaceId: string;
    deviceId: string;
    type: string;
    status: string;
    payload: unknown;
    createdAt: Date;
    acknowledgedAt: Date | null;
    completedAt: Date | null;
    lastError: string | null;
  }): DeviceCommandView {
    return {
      id: command.id,
      workspaceId: command.workspaceId,
      deviceId: command.deviceId,
      type: command.type as DeviceCommandView["type"],
      status: command.status as DeviceCommandView["status"],
      payload: (command.payload ?? {}) as DeviceCommandView["payload"],
      createdAt: command.createdAt.toISOString(),
      acknowledgedAt: command.acknowledgedAt?.toISOString() ?? null,
      completedAt: command.completedAt?.toISOString() ?? null,
      lastError: command.lastError
    };
  }
}
