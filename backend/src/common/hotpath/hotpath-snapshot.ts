import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database';
import { HotpathRedis } from './hotpath-redis';

export interface HotpathAccessFence {
  client: string;
  organizationId: string | null;
  cacheable: boolean;
  accessVersion: string | null;
  organizationStatus: string | null;
  operational: boolean;
  billingVersion: string | null;
}

const MAX_SNAPSHOT_BYTES = 64 * 1024;

@Injectable()
export class HotpathSnapshot {
  constructor(
    private readonly redis: HotpathRedis,
    private readonly prisma: PrismaService,
  ) {}

  async fence(sessionId: string, userId: string) {
    const [row] = await this.prisma.$queryRaw<HotpathAccessFence[]>`
      SELECT client, organization_id AS "organizationId", cacheable,
        access_version AS "accessVersion", organization_status AS "organizationStatus",
        operational, billing_version AS "billingVersion"
      FROM public.app_hotpath_access(${sessionId}::uuid, ${userId}::uuid)
    `;
    return row;
  }

  get available(): boolean {
    return this.redis.available;
  }

  async read<T>(key: string): Promise<T | undefined> {
    const json = await this.redis.command<string | null>(['GET', key]);
    if (!json || Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) return;
    try {
      return JSON.parse(json) as T;
    } catch {
      return undefined;
    }
  }

  async write(key: string, value: unknown, ttlSeconds = 120): Promise<void> {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) return;
    await this.redis.command(['SET', key, json, 'EX', String(ttlSeconds)]);
  }
}
