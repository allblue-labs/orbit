import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { defer, lastValueFrom } from 'rxjs';
import type { ICryptoProvider } from '../../contracts';
import { RequestContextService } from '../../context';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { ConflictException, ValidationException } from '../../exceptions';
import { CRYPTO_PROVIDER } from '../../providers';
import { HotpathRedis } from './hotpath-redis';
import {
  IDEMPOTENT,
  type IdempotencyPolicy,
  type IdempotentResource,
} from './idempotent.decorator';
const TTL_SECONDS = 86_400;
const LOCK_MS = 20_000;
const MAX_REDIS_RESPONSE_BYTES = 256 * 1024;
const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

interface Replay {
  scope: string;
  fingerprint: string;
  access: string;
  expiresAt: number;
  status: number;
  resourceId: string;
  body: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: RequestContextService,
    private readonly rls: RlsTransaction,
    private readonly redis: HotpathRedis,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler) {
    const config = this.reflector.get<IdempotencyPolicy>(
      IDEMPOTENT,
      execution.getHandler(),
    );
    const http = execution.switchToHttp();
    const request = http.getRequest<Request>();
    const key = config && request.headers['idempotency-key'];
    if (key === undefined || !config) return next.handle();
    if (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,160}$/.test(key))
      throw new ValidationException('A chave de idempotência é inválida.');

    return defer(() =>
      this.run(config, key, request, http.getResponse<Response>(), next),
    );
  }

  private async run(
    config: IdempotencyPolicy,
    key: string,
    request: Request,
    response: Response,
    next: CallHandler,
  ): Promise<unknown> {
    const context = this.contexts.get();
    const { organizationId, userId } = context;
    if (!organizationId || !userId || context.actorType !== 'INTERNAL_USER')
      return lastValueFrom(next.handle());

    const scope = hash([organizationId, userId, config.route, key]);
    const fingerprint = hash([
      request.params,
      request.query,
      request.body ?? null,
    ]);
    const access = hash([
      context.businessUnitId,
      [...context.businessUnitIds].sort(),
      [...context.roles].sort(),
      [...context.permissions].sort(),
      context.isOrganizationOwner,
    ]);
    const prefix = `orbit:v1:org:${organizationId}:idem:${scope}`;
    const cached = this.readRedis(
      await this.redis.command<string | null>(['GET', `${prefix}:response`]),
    );
    if (cached?.scope === scope && cached.expiresAt > Date.now()) {
      const result = await this.rls.run((tx) =>
        this.replay(
          cached,
          fingerprint,
          access,
          organizationId,
          userId,
          config.resource,
          tx,
        ),
      );
      response.status(cached.status);
      return result;
    }

    const owner = randomUUID();
    const lock = await this.redis.command<string | null>([
      'SET',
      `${prefix}:lock`,
      owner,
      'NX',
      'PX',
      String(LOCK_MS),
    ]);
    try {
      const result = await this.rls.runAmbient(async (tx) => {
        // Eviction, restart and expiry of the Redis lock cannot let two
        // writers run. The result and domain transaction commit together.
        const [row] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${scope}, 6047)) AS acquired`;
        if (!row?.acquired)
          throw new ConflictException(
            'Esta solicitação ainda está em andamento. Tente novamente.',
            'IDEMPOTENCY_IN_PROGRESS',
          );
        const [persisted] = await tx.$queryRaw<{ ciphertext: string }[]>`
          SELECT response_ciphertext AS ciphertext FROM public.http_idempotency_records
          WHERE scope_hash = ${scope} AND expires_at > statement_timestamp()`;
        if (persisted) {
          const previous = this.decode(persisted.ciphertext);
          if (previous.scope !== scope)
            throw new Error('Idempotency scope mismatch');
          await this.replay(
            previous,
            fingerprint,
            access,
            organizationId,
            userId,
            config.resource,
            tx,
          );
          return { previous, ciphertext: persisted.ciphertext };
        }

        await tx.$executeRaw`DELETE FROM public.http_idempotency_records WHERE scope_hash = ${scope} AND expires_at <= statement_timestamp()`;
        const body: unknown = await lastValueFrom(next.handle());
        const resourceId = (body as { id?: unknown } | null)?.id;
        if (typeof resourceId !== 'string')
          throw new Error('Idempotent handler must return its resource ID');
        const previous: Replay = {
          scope,
          access,
          fingerprint,
          body,
          resourceId,
          status: response.statusCode,
          expiresAt: Date.now() + TTL_SECONDS * 1_000,
        };
        const ciphertext = this.crypto.encrypt(JSON.stringify(previous));
        await tx.$executeRaw`
          INSERT INTO public.http_idempotency_records (scope_hash, organization_id, actor_id, response_ciphertext, expires_at)
          VALUES (${scope}, ${organizationId}::uuid, ${userId}::uuid, ${ciphertext}, ${new Date(previous.expiresAt)})
        `;
        return { previous, ciphertext };
      });

      const { previous, ciphertext } = result;
      const remaining = Math.floor((previous.expiresAt - Date.now()) / 1_000);
      if (
        remaining > 0 &&
        Buffer.byteLength(ciphertext) <= MAX_REDIS_RESPONSE_BYTES
      )
        await this.redis.command([
          'SET',
          `${prefix}:response`,
          ciphertext,
          'EX',
          String(remaining),
        ]);
      response.status(previous.status);
      return previous.body;
    } finally {
      if (lock === 'OK')
        await this.redis.command([
          'EVAL',
          RELEASE_LOCK,
          '1',
          `${prefix}:lock`,
          owner,
        ]);
    }
  }

  private async replay(
    reply: Replay,
    fingerprint: string,
    access: string,
    organizationId: string,
    userId: string,
    resource: IdempotentResource,
    tx: PrismaTransactionClient,
  ) {
    if (reply.fingerprint !== fingerprint)
      throw new ConflictException(
        'Esta chave já foi usada com outros dados.',
        'IDEMPOTENCY_KEY_REUSED',
      );
    const where = { id: reply.resourceId, organizationId, deletedAt: null };
    const visible =
      reply.access === access &&
      (resource === 'financial-entry'
        ? await tx.financialEntry.findFirst({ where, select: { id: true } })
        : await tx.quote.findFirst({
            where: {
              ...where,
              ...(resource === 'mobile-quote' ? { createdById: userId } : {}),
            },
            select: { id: true },
          }));
    if (!visible)
      throw new ConflictException(
        'O registro desta solicitação não está disponível no acesso atual.',
        'IDEMPOTENCY_REPLAY_UNAVAILABLE',
      );
    return reply.body;
  }

  private readRedis(ciphertext: string | null | undefined) {
    if (!ciphertext || Buffer.byteLength(ciphertext) > MAX_REDIS_RESPONSE_BYTES)
      return;
    try {
      return this.decode(ciphertext);
    } catch {
      // Invalid or old cache entries always go through the durable record.
      return undefined;
    }
  }

  private decode(ciphertext: string): Replay {
    return JSON.parse(this.crypto.decrypt(ciphertext)) as Replay;
  }
}

function hash(value: unknown) {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, nested: unknown) => {
        if (!nested || typeof nested !== 'object' || Array.isArray(nested))
          return nested;
        return Object.fromEntries(
          Object.entries(nested).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        );
      }),
    )
    .digest('hex');
}
