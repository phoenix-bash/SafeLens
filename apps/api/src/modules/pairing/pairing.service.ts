import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomInt } from "node:crypto";

import { PairDeviceRequest, PairingCodeView } from "@safelens/contracts";
import { PairingCodeRecord } from "../../core/platform.types";
import { EphemeralStateService } from "../../core/ephemeral-state.service";
import { AuditService } from "../audit/audit.service";
import { DevicesService } from "../devices/devices.service";
import { RealtimeService } from "../realtime/realtime.service";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

@Injectable()
export class PairingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly ephemeralState: EphemeralStateService,
    private readonly devicesService: DevicesService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService
  ) {}

  async createPairingCode(input: {
    workspaceId: string;
    userId: string;
  }): Promise<PairingCodeView> {
    await this.expireOldCodes();

    const code = await this.generateCode();
    const expiresAt = new Date(
      Date.now() + this.getMinutes("PAIRING_CODE_TTL_MINUTES", 10) * 60_000
    ).toISOString();

    await this.ephemeralState.storePairingCode({
      code,
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      expiresAt,
      claimedAt: null,
      deviceId: null
    });

    await this.auditService.record({
      workspaceId: input.workspaceId,
      actorType: "user",
      actorId: input.userId,
      eventType: "pairing.created",
      payload: { code }
    });
    this.realtimeService.emitToWorkspace(input.workspaceId, "pairing.created", {
      channel: "pairing.created",
      workspaceId: input.workspaceId,
      code,
      occurredAt: new Date().toISOString()
    });

    return this.toPairingCodeView({
      code,
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      expiresAt,
      claimedAt: null,
      deviceId: null
    });
  }

  async getPairingCode(
    workspaceId: string,
    code: string
  ): Promise<PairingCodeView> {
    await this.expireOldCodes();

    const pairingCode = await this.ephemeralState.getPairingCode(code);

    if (!pairingCode || pairingCode.workspaceId != workspaceId) {
      throw new NotFoundException("Pairing code not found.");
    }

    return this.toPairingCodeView(pairingCode);
  }

  async pairDevice(input: PairDeviceRequest) {
    await this.expireOldCodes();
    const pairingCode = await this.ephemeralState.getPairingCode(input.code);

    if (!pairingCode) {
      throw new BadRequestException("Pairing code is invalid or expired.");
    }

    if (pairingCode.claimedAt) {
      throw new UnauthorizedException("Pairing code has already been used.");
    }

    if (new Date(pairingCode.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException("Pairing code has expired.");
    }

    const response = await this.devicesService.createPairedDevice({
      workspaceId: pairingCode.workspaceId,
      deviceName: input.deviceName,
      model: input.model,
      manufacturer: input.manufacturer,
      androidVersion: input.androidVersion,
      deviceFingerprint: input.deviceFingerprint,
      capabilities: input.capabilities
    });

    const claimedCode = await this.ephemeralState.claimPairingCode(
      pairingCode.code,
      response.deviceId
    );

    if (!claimedCode?.claimedAt) {
      throw new UnauthorizedException("Pairing code has already been used.");
    }

    await this.auditService.record({
      workspaceId: pairingCode.workspaceId,
      actorType: "device",
      actorId: response.deviceId,
      eventType: "pairing.claimed",
      payload: { code: pairingCode.code }
    });
    this.realtimeService.emitToWorkspace(pairingCode.workspaceId, "pairing.claimed", {
      channel: "pairing.claimed",
      workspaceId: pairingCode.workspaceId,
      code: pairingCode.code,
      occurredAt: claimedCode.claimedAt
    });

    return response;
  }

  private async expireOldCodes() {
    const expired = await this.ephemeralState.expirePairingCodes();

    for (const code of expired) {
      this.realtimeService.emitToWorkspace(code.workspaceId, "pairing.expired", {
        channel: "pairing.expired",
        workspaceId: code.workspaceId,
        code: code.code,
        occurredAt: new Date().toISOString()
      });
    }
  }

  private async generateCode() {
    let code = "";

    do {
      code = Array.from({ length: 6 }, () =>
        ALPHABET.charAt(randomInt(ALPHABET.length))
      ).join("");
    } while (await this.ephemeralState.getPairingCode(code));

    return code;
  }

  private getMinutes(key: string, fallback: number) {
    const rawValue = this.configService.get<string>(key);
    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private toPairingCodeView(record: PairingCodeRecord): PairingCodeView {
    return {
      code: record.code,
      workspaceId: record.workspaceId,
      expiresAt: record.expiresAt,
      claimedAt: record.claimedAt
    };
  }
}
