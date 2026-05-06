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

  private async tryRedis<T>(
    operation: (redis: Redis) => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    if (!this.redis) {
      return { ok: false };
    }

    try {
      await this.redis.connect().catch(() => undefined);
      const value = await operation(this.redis);
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis unavailable, using in-memory fallback: ${message}`);
      return { ok: false };
    }
  }

  async storeAccessSession(session: AccessSessionRecord, ttlSeconds: number) {
    const redisWrite = await this.tryRedis((redis) =>
      redis.set(
        this.accessSessionKey(session.token),
        JSON.stringify(session),
        "EX",
        ttlSeconds
      )
    );
    if (redisWrite.ok) {
      return;
    }

    this.accessSessions.set(session.token, session);
  }

  async getAccessSession(token: string): Promise<AccessSessionRecord | undefined> {
    const redisRead = await this.tryRedis((redis) =>
      redis.get(this.accessSessionKey(token))
    );
    if (redisRead.ok) {
      const rawValue = redisRead.value;
      return rawValue ? (JSON.parse(rawValue) as AccessSessionRecord) : undefined;
    }

    const session = this.accessSessions.get(token);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      this.accessSessions.delete(token);
      return undefined;
    }
    return session;
  }

  async deleteAccessSession(token: string) {
    const redisDelete = await this.tryRedis((redis) =>
      redis.del(this.accessSessionKey(token))
    );
    if (redisDelete.ok) {
      return;
    }

    this.accessSessions.delete(token);
  }

  async storePairingCode(record: PairingCodeRecord) {
    const redisWrite = await this.tryRedis(async (redis) => {
      const pipeline = redis.multi();
      pipeline.set(this.pairingCodeKey(record.code), JSON.stringify(record));
      pipeline.zadd(
        "pairing:expiries",
        new Date(record.expiresAt).getTime(),
        record.code
      );
      await pipeline.exec();
      return true;
    });
    if (redisWrite.ok) {
      return;
    }

    this.pairingCodes.set(record.code, record);
  }

  async getPairingCode(code: string): Promise<PairingCodeRecord | undefined> {
    const redisRead = await this.tryRedis((redis) => redis.get(this.pairingCodeKey(code)));
    if (redisRead.ok) {
      const rawValue = redisRead.value;
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
    const redisExpire = await this.tryRedis(async (redis) => {
      const codes = await redis.zrangebyscore("pairing:expiries", 0, now);

      if (!codes.length) {
        return [] as PairingCodeRecord[];
      }

      const records = await Promise.all(
        codes.map(async (code) => {
          const rawValue = await redis.get(this.pairingCodeKey(code));
          return rawValue ? (JSON.parse(rawValue) as PairingCodeRecord) : undefined;
        })
      );

      const pipeline = redis.multi();
      for (const code of codes) {
        pipeline.del(this.pairingCodeKey(code));
        pipeline.zrem("pairing:expiries", code);
      }
      await pipeline.exec();

      return records.filter((record): record is PairingCodeRecord => Boolean(record));
    });
    if (redisExpire.ok) {
      return redisExpire.value;
    }

    const expired: PairingCodeRecord[] = [];

    for (const [code, pairingCode] of this.pairingCodes.entries()) {
      if (!pairingCode.claimedAt && new Date(pairingCode.expiresAt).getTime() <= now) {
        expired.push(pairingCode);
        this.pairingCodes.delete(code);
      }
    }

    return expired;
  }

  async storeCameraStreamState(state: CameraStreamLiveState) {
    const redisWrite = await this.tryRedis((redis) =>
      redis.set(
        this.cameraStreamKey(state.deviceId),
        JSON.stringify(state),
        "EX",
        CAMERA_STREAM_TTL_SECONDS
      )
    );
    if (redisWrite.ok) {
      return;
    }

    this.cameraStreams.set(state.deviceId, state);
  }

  async getCameraStreamState(
    deviceId: string
  ): Promise<CameraStreamLiveState | undefined> {
    const redisRead = await this.tryRedis((redis) =>
      redis.get(this.cameraStreamKey(deviceId))
    );
    if (redisRead.ok) {
      const rawValue = redisRead.value;
      return rawValue ? (JSON.parse(rawValue) as CameraStreamLiveState) : undefined;
    }

    return this.cameraStreams.get(deviceId);
  }

  async deleteCameraStreamState(deviceId: string) {
    const redisDelete = await this.tryRedis((redis) =>
      redis.del(this.cameraStreamKey(deviceId))
    );
    if (redisDelete.ok) {
      return;
    }

    this.cameraStreams.delete(deviceId);
  }

  async appendCameraStreamAudioChunk(
    deviceId: string,
    chunk: Omit<CameraStreamAudioChunk, "serverSequence">
  ): Promise<CameraStreamAudioChunk> {
    const redisAppend = await this.tryRedis(async (redis) => {
      const sequenceKey = this.cameraAudioSequenceKey(deviceId);
      const streamKey = this.cameraAudioKey(deviceId);
      const nextSequence = await redis.incr(sequenceKey);
      const nextChunk: CameraStreamAudioChunk = {
        ...chunk,
        serverSequence: nextSequence
      };

      const pipeline = redis.multi();
      pipeline.rpush(streamKey, JSON.stringify(nextChunk));
      pipeline.ltrim(streamKey, -CAMERA_STREAM_AUDIO_MAX_CHUNKS, -1);
      pipeline.expire(streamKey, CAMERA_STREAM_AUDIO_TTL_SECONDS);
      pipeline.expire(sequenceKey, CAMERA_STREAM_AUDIO_TTL_SECONDS);
      await pipeline.exec();

      return nextChunk;
    });
    if (redisAppend.ok) {
      return redisAppend.value;
    }

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

    const redisRead = await this.tryRedis(async (redis) => {
      const [rawLatestSequence, rawChunks] = await Promise.all([
        redis.get(this.cameraAudioSequenceKey(deviceId)),
        redis.lrange(this.cameraAudioKey(deviceId), 0, -1)
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
    });
    if (redisRead.ok) {
      return redisRead.value;
    }

    const latestServerSequence = this.cameraAudioSequences.get(deviceId) ?? 0;
    const chunks = (this.cameraAudioChunks.get(deviceId) ?? [])
      .filter((item) => item.serverSequence > sinceServerSequence)
      .slice(0, limit);

    return {
      chunks,
      latestServerSequence
    };
  }

  async clearCameraStreamAudioChunks(deviceId: string) {
    const redisDelete = await this.tryRedis((redis) =>
      redis.del(this.cameraAudioKey(deviceId), this.cameraAudioSequenceKey(deviceId))
    );
    if (redisDelete.ok) {
      return;
    }

    this.cameraAudioChunks.delete(deviceId);
    this.cameraAudioSequences.delete(deviceId);
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
