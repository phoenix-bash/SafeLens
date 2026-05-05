import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

import {
  AccessSessionRecord,
  CameraStreamAudioChunk,
  CameraStreamLiveState,
  PairingCodeRecord
} from "./platform.types";

const CAMERA_STREAM_TTL_SECONDS = 600;
const CAMERA_STREAM_AUDIO_TTL_SECONDS = 120;
const CAMERA_STREAM_AUDIO_MAX_CHUNKS = 120;
const CAMERA_STREAM_AUDIO_DEFAULT_LIMIT = 8;
const CAMERA_STREAM_AUDIO_MAX_LIMIT = 32;

@Injectable()
export class EphemeralStateService {
  private readonly logger = new Logger(EphemeralStateService.name);
  private readonly redis?: Redis;
  private readonly accessSessions = new Map<string, AccessSessionRecord>();
  private readonly pairingCodes = new Map<string, PairingCodeRecord>();
  private readonly cameraStreams = new Map<string, CameraStreamLiveState>();
  private readonly cameraAudioChunks = new Map<string, CameraStreamAudioChunk[]>();
  private readonly cameraAudioSequences = new Map<string, number>();

  constructor(private readonly configService?: ConfigService) {
    const redisUrl =
      this.configService?.get<string>("REDIS_URL") || process.env.REDIS_URL;

    if (!redisUrl) {
      this.logger.warn(
        "REDIS_URL is not configured. Falling back to in-memory ephemeral state."
      );
      return;
    }

    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
  }

  async storeAccessSession(session: AccessSessionRecord, ttlSeconds: number) {
    if (!this.redis) {
      this.accessSessions.set(session.token, session);
      return;
    }

    await this.redis.connect().catch(() => undefined);
    await this.redis.set(
      this.accessSessionKey(session.token),
      JSON.stringify(session),
      "EX",
      ttlSeconds
    );
  }

  async getAccessSession(token: string): Promise<AccessSessionRecord | undefined> {
    if (!this.redis) {
      const session = this.accessSessions.get(token);
      if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
        this.accessSessions.delete(token);
        return undefined;
      }
      return session;
    }

    await this.redis.connect().catch(() => undefined);
    const rawValue = await this.redis.get(this.accessSessionKey(token));
    return rawValue
      ? (JSON.parse(rawValue) as AccessSessionRecord)
      : undefined;
  }

  async deleteAccessSession(token: string) {
    if (!this.redis) {
      this.accessSessions.delete(token);
      return;
    }

    await this.redis.connect().catch(() => undefined);
    await this.redis.del(this.accessSessionKey(token));
  }

  async storePairingCode(record: PairingCodeRecord) {
    if (!this.redis) {
      this.pairingCodes.set(record.code, record);
      return;
    }

    await this.redis.connect().catch(() => undefined);
    const pipeline = this.redis.multi();
    pipeline.set(this.pairingCodeKey(record.code), JSON.stringify(record));
    pipeline.zadd("pairing:expiries", new Date(record.expiresAt).getTime(), record.code);
    await pipeline.exec();
  }

  async getPairingCode(code: string): Promise<PairingCodeRecord | undefined> {
    if (!this.redis) {
      const record = this.pairingCodes.get(code);
      if (!record) {
        return undefined;
      }

      if (new Date(record.expiresAt).getTime() <= Date.now()) {
        this.pairingCodes.delete(code);
        return undefined;
      }

      return record;
    }

    await this.redis.connect().catch(() => undefined);
    const rawValue = await this.redis.get(this.pairingCodeKey(code));

    if (!rawValue) {
      return undefined;
    }

    const record = JSON.parse(rawValue) as PairingCodeRecord;

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      await this.deletePairingCode(code);
      return undefined;
    }

    return record;
  }

  async claimPairingCode(code: string, deviceId: string) {
    const existing = await this.getPairingCode(code);

    if (!existing || existing.claimedAt) {
      return existing;
    }

    const claimedRecord: PairingCodeRecord = {
      ...existing,
      claimedAt: new Date().toISOString(),
      deviceId
    };

    await this.storePairingCode(claimedRecord);
    return claimedRecord;
  }

  async expirePairingCodes(now = Date.now()) {
    if (!this.redis) {
      const expired: PairingCodeRecord[] = [];

      for (const [code, pairingCode] of this.pairingCodes.entries()) {
        if (
          !pairingCode.claimedAt &&
          new Date(pairingCode.expiresAt).getTime() <= now
        ) {
          expired.push(pairingCode);
          this.pairingCodes.delete(code);
        }
      }

      return expired;
    }

    await this.redis.connect().catch(() => undefined);
    const codes = await this.redis.zrangebyscore("pairing:expiries", 0, now);

    if (!codes.length) {
      return [];
    }

    const records = await Promise.all(
      codes.map(async (code) => {
        const rawValue = await this.redis!.get(this.pairingCodeKey(code));
        return rawValue
          ? (JSON.parse(rawValue) as PairingCodeRecord)
          : undefined;
      })
    );

    const pipeline = this.redis.multi();
    for (const code of codes) {
      pipeline.del(this.pairingCodeKey(code));
      pipeline.zrem("pairing:expiries", code);
    }
    await pipeline.exec();

    return records.filter((record): record is PairingCodeRecord => Boolean(record));
  }

  async storeCameraStreamState(state: CameraStreamLiveState) {
    if (!this.redis) {
      this.cameraStreams.set(state.deviceId, state);
      return;
    }

    await this.redis.connect().catch(() => undefined);
    await this.redis.set(
      this.cameraStreamKey(state.deviceId),
      JSON.stringify(state),
      "EX",
      CAMERA_STREAM_TTL_SECONDS
    );
  }

  async getCameraStreamState(
    deviceId: string
  ): Promise<CameraStreamLiveState | undefined> {
    if (!this.redis) {
      return this.cameraStreams.get(deviceId);
    }

    await this.redis.connect().catch(() => undefined);
    const rawValue = await this.redis.get(this.cameraStreamKey(deviceId));
    return rawValue
      ? (JSON.parse(rawValue) as CameraStreamLiveState)
      : undefined;
  }

  async deleteCameraStreamState(deviceId: string) {
    if (!this.redis) {
      this.cameraStreams.delete(deviceId);
      return;
    }

    await this.redis.connect().catch(() => undefined);
    await this.redis.del(this.cameraStreamKey(deviceId));
  }

  async appendCameraStreamAudioChunk(
    deviceId: string,
    chunk: Omit<CameraStreamAudioChunk, "serverSequence">
  ): Promise<CameraStreamAudioChunk> {
    if (!this.redis) {
      const nextSequence = (this.cameraAudioSequences.get(deviceId) ?? 0) + 1;
      const nextChunk: CameraStreamAudioChunk = {
        ...chunk,
        serverSequence: nextSequence
      };
      const current = this.cameraAudioChunks.get(deviceId) ?? [];
      this.cameraAudioChunks.set(
        deviceId,
        [...current, nextChunk].slice(-CAMERA_STREAM_AUDIO_MAX_CHUNKS)
      );
      this.cameraAudioSequences.set(deviceId, nextSequence);
      return nextChunk;
    }

    await this.redis.connect().catch(() => undefined);
    const sequenceKey = this.cameraAudioSequenceKey(deviceId);
    const streamKey = this.cameraAudioKey(deviceId);
    const nextSequence = await this.redis.incr(sequenceKey);
    const nextChunk: CameraStreamAudioChunk = {
      ...chunk,
      serverSequence: nextSequence
    };

    const pipeline = this.redis.multi();
    pipeline.rpush(streamKey, JSON.stringify(nextChunk));
    pipeline.ltrim(streamKey, -CAMERA_STREAM_AUDIO_MAX_CHUNKS, -1);
    pipeline.expire(streamKey, CAMERA_STREAM_AUDIO_TTL_SECONDS);
    pipeline.expire(sequenceKey, CAMERA_STREAM_AUDIO_TTL_SECONDS);
    await pipeline.exec();

    return nextChunk;
  }

  async getCameraStreamAudioChunks(
    deviceId: string,
    options?: {
      sinceServerSequence?: number;
      limit?: number;
    }
  ): Promise<{
    chunks: CameraStreamAudioChunk[];
    latestServerSequence: number;
  }> {
    const sinceServerSequence = Math.max(0, options?.sinceServerSequence ?? 0);
    const requestedLimit = options?.limit ?? CAMERA_STREAM_AUDIO_DEFAULT_LIMIT;
    const limit = Math.min(
      Math.max(1, requestedLimit),
      CAMERA_STREAM_AUDIO_MAX_LIMIT
    );

    if (!this.redis) {
      const latestServerSequence = this.cameraAudioSequences.get(deviceId) ?? 0;
      const chunks = (this.cameraAudioChunks.get(deviceId) ?? [])
        .filter((item) => item.serverSequence > sinceServerSequence)
        .slice(0, limit);

      return {
        chunks,
        latestServerSequence
      };
    }

    await this.redis.connect().catch(() => undefined);
    const [rawLatestSequence, rawChunks] = await Promise.all([
      this.redis.get(this.cameraAudioSequenceKey(deviceId)),
      this.redis.lrange(this.cameraAudioKey(deviceId), 0, -1)
    ]);

    const latestServerSequence = Number(rawLatestSequence ?? "0") || 0;
    const decodedChunks = rawChunks
      .map((item) => {
        try {
          return JSON.parse(item) as CameraStreamAudioChunk;
        } catch {
          return undefined;
        }
      })
      .filter((item): item is CameraStreamAudioChunk => Boolean(item));

    const chunks = decodedChunks
      .filter((item) => item.serverSequence > sinceServerSequence)
      .slice(0, limit);

    return {
      chunks,
      latestServerSequence
    };
  }

  async clearCameraStreamAudioChunks(deviceId: string) {
    if (!this.redis) {
      this.cameraAudioChunks.delete(deviceId);
      this.cameraAudioSequences.delete(deviceId);
      return;
    }

    await this.redis.connect().catch(() => undefined);
    await this.redis.del(
      this.cameraAudioKey(deviceId),
      this.cameraAudioSequenceKey(deviceId)
    );
  }

  private async deletePairingCode(code: string) {
    if (!this.redis) {
      this.pairingCodes.delete(code);
      return;
    }

    const pipeline = this.redis.multi();
    pipeline.del(this.pairingCodeKey(code));
    pipeline.zrem("pairing:expiries", code);
    await pipeline.exec();
  }

  private accessSessionKey(token: string) {
    return `access-session:${token}`;
  }

  private pairingCodeKey(code: string) {
    return `pairing-code:${code}`;
  }

  private cameraStreamKey(deviceId: string) {
    return `camera-stream:${deviceId}`;
  }

  private cameraAudioKey(deviceId: string) {
    return `camera-audio:${deviceId}`;
  }

  private cameraAudioSequenceKey(deviceId: string) {
    return `camera-audio-seq:${deviceId}`;
  }
}
