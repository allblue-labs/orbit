import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../context';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { ForbiddenException } from '../../exceptions';
import { canRedriveRejectedEmail } from '../email/email-redrive-policy';
import type {
  EmailFailureQuery,
  JobFailureQuery,
  RequeueJob,
} from './admin-jobs.dto';
import { QUEUE_GROUPS } from './queue-groups';

const failureSelect = {
  id: true,
  queue: true,
  organizationId: true,
  businessUnitId: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  redriveGeneration: true,
  correlationId: true,
  lastError: true,
  finishedAt: true,
  failures: {
    select: {
      attempt: true,
      generation: true,
      status: true,
      code: true,
      recordedAt: true,
    },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: 30,
  },
} satisfies Prisma.BackgroundJobSelect;

const recoverableJobFailure = (code: string | null) =>
  code === 'JOB_LEASE_EXPIRED' ||
  code === 'INTERNAL_ERROR:INFRASTRUCTURE_ERROR' ||
  (code !== null &&
    /^(DATABASE_UNAVAILABLE|DATABASE_TIMEOUT|CONNECTION_FAILURE)(?::[A-Z0-9_]{1,40})?$/.test(
      code,
    ));

const safeCode = (code: string | null) =>
  code && /^[A-Z0-9_.:-]{1,160}$/.test(code) ? code : null;

function payloadSummary(queue: string, raw: Prisma.JsonValue) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fields =
    queue === 'artifact.render'
      ? ['executionId', 'renderAttemptId']
      : queue === 'management-report.generate'
        ? ['reportId', 'generationId']
        : [];
  const data = Object.fromEntries(
    fields.flatMap((key) => {
      const value = raw[key];
      return typeof value === 'string' &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
        ? [[key, value]]
        : [];
    }),
  );
  return Object.keys(data).length ? data : null;
}

@Injectable()
export class AdminJobsService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly context: RequestContextService,
  ) {}

  private admin<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.rls.run(async (tx) => {
      const [authority] = await tx.$queryRaw<{ allowed: boolean }[]>`
        SELECT public.app_is_platform_admin() AND EXISTS (
          SELECT 1 FROM public.platform_role_assignments p
          JOIN public.roles r ON r.id=p.role_id
          WHERE p.user_id=public.app_current_user_id() AND p.revoked_at IS NULL
            AND r.organization_id IS NULL AND r.deleted_at IS NULL AND r.key='PLATFORM_ADMIN'
        ) AS allowed`;
      if (!authority?.allowed)
        throw new ForbiddenException('Acesso administrativo necessário.');
      return work(tx);
    });
  }

  list(query: JobFailureQuery) {
    return this.admin(async (tx) => {
      const group = query.group as keyof typeof QUEUE_GROUPS | undefined;
      const groupQueues = group ? [...QUEUE_GROUPS[group].queues] : undefined;
      const rows = await tx.backgroundJob.findMany({
        where: {
          status: { in: ['DEAD', 'FAILED'] },
          ...(query.queue ? { queue: query.queue } : {}),
          ...(groupQueues ? { AND: [{ queue: { in: groupQueues } }] } : {}),
          ...(query.organizationId
            ? { organizationId: query.organizationId }
            : {}),
          ...(query.code ? { lastError: query.code } : {}),
          ...(query.from || query.through
            ? {
                finishedAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.through ? { lte: new Date(query.through) } : {}),
                },
              }
            : {}),
        },
        take: query.limit + 1,
        ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
        orderBy: [
          { finishedAt: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
        select: {
          ...failureSelect,
          payload: true,
          documentExports: {
            select: { id: true, kind: true, status: true, expiresAt: true },
            take: 1,
          },
        },
      });
      return {
        items: rows
          .slice(0, query.limit)
          .map(({ documentExports, payload, ...row }) => ({
            ...row,
            lastError: safeCode(row.lastError),
            payloadSummary:
              row.queue === 'document.export'
                ? (documentExports[0] ?? null)
                : payloadSummary(row.queue, payload),
          })),
        nextCursor:
          rows.length > query.limit ? rows[query.limit - 1]?.id : null,
      };
    });
  }

  async requeue(input: RequeueJob) {
    try {
      return await this.admin(async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.background_jobs WHERE id=${input.id}::uuid FOR UPDATE`;
        if (!locked) return { id: input.id, result: 'NOT_FOUND' };
        const row = await tx.backgroundJob.findUniqueOrThrow({
          where: { id: input.id },
        });
        if (
          row.redriveGeneration !== input.generation ||
          !['DEAD', 'FAILED'].includes(row.status)
        )
          return { id: input.id, result: 'STALE' };
        const reject = { id: row.id, result: 'REQUIRES_REVIEW' };
        if (
          !row.finishedAt ||
          !row.lastError ||
          !(
            recoverableJobFailure(row.lastError) ||
            (row.queue === 'document.export' && row.lastError === 'JOB_TIMEOUT')
          )
        )
          return reject;
        if (
          ![
            'artifact.render',
            'management-report.generate',
            'document.export',
          ].includes(row.queue)
        )
          return reject;

        // Active or completed work for the same business key supersedes this request.
        const duplicate = await tx.backgroundJob.findFirst({
          where: {
            id: { not: row.id },
            queue: row.queue,
            jobKey: row.jobKey,
            OR: [
              { status: { in: ['PENDING', 'RUNNING'] } },
              { createdAt: { gte: row.createdAt } },
            ],
          },
          select: { id: true },
        });
        if (duplicate) return { id: row.id, result: 'SUPERSEDED' };

        if (row.queue === 'document.export') {
          const payload = row.payload as { exportId?: string } | null;
          const document = await tx.documentExport.findFirst({
            where: { jobId: row.id, organizationId: row.organizationId },
          });
          if (
            !document ||
            document.id !== payload?.exportId ||
            document.businessUnitId !== row.businessUnitId ||
            document.expiresAt <= new Date() ||
            document.status === 'COMPLETED' ||
            document.storageFileId
          )
            return reject;
          const existingFile = await tx.storageFile.findFirst({
            where: {
              organizationId: document.organizationId,
              businessUnitId: document.businessUnitId,
              deletedAt: null,
              metadata: { path: ['documentExportId'], equals: document.id },
            },
            select: { id: true },
          });
          if (existingFile) return reject;
          await tx.documentExport.update({
            where: { id: document.id },
            data: { status: 'PENDING', errorCode: null },
          });
        }

        const generation = input.generation + 1;
        await tx.backgroundJob.update({
          where: { id: row.id },
          data: {
            status: 'PENDING',
            attempts: 0,
            availableAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            startedAt: null,
            finishedAt: null,
            lastError: null,
            redriveGeneration: generation,
          },
        });
        await this.audit(
          tx,
          row.id,
          row.organizationId,
          'BACKGROUND_JOB_REQUEUED',
          {
            queue: row.queue,
            generation,
            attempts: row.attempts,
            errorCode: safeCode(row.lastError),
          },
        );
        return { id: row.id, result: 'REQUEUED', generation };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return { id: input.id, result: 'SUPERSEDED' };
      throw error;
    }
  }

  async batch(items: RequeueJob[]) {
    const results = [];
    for (const item of items) results.push(await this.requeue(item));
    return { items: results };
  }

  listEmail(query: EmailFailureQuery) {
    return this.admin(async (tx) => {
      const options = {
        where: { status: 'FAILED' },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        take: query.limit + 1,
        ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
        select: {
          id: true,
          status: true,
          attempts: true,
          createdAt: true,
          expiresAt: true,
          lastErrorCode: true,
          adminRequeuedAt: true,
          correlationId: true,
          outboundMessages: {
            select: { status: true, feedbackStatus: true, createdAt: true },
            orderBy: { createdAt: 'desc' as const },
            take: 10,
          },
        },
      };
      const rows =
        query.source === 'identity'
          ? await tx.identityEmailDelivery.findMany({
              ...options,
              select: {
                ...options.select,
                purpose: true,
                organizationId: true,
              },
            })
          : await tx.publicContactSubmission.findMany(options);
      return {
        items: rows.slice(0, query.limit).map((row) => ({
          ...row,
          lastErrorCode: safeCode(row.lastErrorCode),
        })),
        nextCursor:
          rows.length > query.limit ? rows[query.limit - 1]?.id : null,
      };
    });
  }

  requeueEmail(source: 'identity' | 'contact', id: string) {
    return this.admin(async (tx) => {
      // Separate statements keep the table name out of request input.
      const locked =
        source === 'identity'
          ? await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM public.identity_email_deliveries WHERE id=${id}::uuid AND status='FAILED' FOR UPDATE`
          : await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM public.public_contact_submissions WHERE id=${id}::uuid AND status='FAILED' FOR UPDATE`;
      if (!locked.length)
        return { id, result: 'NOT_FOUND_OR_ALREADY_REQUEUED' };
      const select = {
        expiresAt: true,
        encryptedPayload: true,
        adminRequeuedAt: true,
        lastErrorCode: true,
        outboundMessages: { select: { status: true, providerMessageId: true } },
      };
      const row =
        source === 'identity'
          ? await tx.identityEmailDelivery.findUnique({
              where: { id },
              select: { ...select, organizationId: true },
            })
          : await tx.publicContactSubmission.findUnique({
              where: { id },
              select,
            });
      if (
        !row ||
        !row.encryptedPayload ||
        row.expiresAt <= new Date() ||
        row.adminRequeuedAt ||
        !canRedriveRejectedEmail(row.lastErrorCode) ||
        !row.outboundMessages.length ||
        row.outboundMessages.some(
          (attempt) => attempt.status !== 'FAILED' || attempt.providerMessageId,
        )
      )
        return { id, result: 'REQUIRES_REVIEW' };

      const data = {
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        adminRequeuedAt: new Date(),
      };
      if (source === 'identity')
        await tx.identityEmailDelivery.update({
          where: { id },
          data: { ...data, finishedAt: null },
        });
      else await tx.publicContactSubmission.update({ where: { id }, data });
      const org =
        'organizationId' in row && typeof row.organizationId === 'string'
          ? row.organizationId
          : null;
      await this.audit(tx, id, org, 'EMAIL_DELIVERY_REQUEUED', {
        source,
        errorCode: safeCode(row.lastErrorCode),
      });
      return { id, result: 'REQUEUED' };
    });
  }

  private audit(
    tx: PrismaTransactionClient,
    id: string,
    organizationId: string | null,
    action: string,
    metadata: Prisma.InputJsonValue,
  ) {
    const actor = this.context.get();
    return tx.auditLog.create({
      data: {
        organizationId,
        userId: actor.userId,
        requestId: actor.requestId,
        action,
        entityType:
          action === 'BACKGROUND_JOB_REQUEUED'
            ? 'BACKGROUND_JOB'
            : 'EMAIL_DELIVERY',
        entityId: id,
        metadata,
      },
    });
  }
}
