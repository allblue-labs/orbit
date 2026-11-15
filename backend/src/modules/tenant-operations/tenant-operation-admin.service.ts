import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { VerifiedPlatformAuthority } from '../../common/verified-platform-authority';
import { RequestContextService } from '../../context';
import { RlsTransaction } from '../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import { OPERATIONAL_DECISION } from './tenant-operation.policy';
import type { ChangeTenantOperationDto } from './tenant-operation.dto';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class TenantOperationAdminService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextService,
  ) {}

  async change(
    organizationId: string,
    input: ChangeTenantOperationDto,
    key: string | undefined,
  ) {
    const context = this.contexts.get();
    const authority = VerifiedPlatformAuthority.forUser(
      context.platformAuthority,
      context.userId,
    );
    if (
      context.actorType !== 'INTERNAL_USER' ||
      !VerifiedPlatformAuthority.hasRole(
        authority,
        context.userId,
        'PLATFORM_ADMIN',
      ) ||
      !(
        authority?.permissions.includes('*') ||
        authority?.permissions.includes('platform.admin')
      )
    )
      throw new ForbiddenException('Verified platform authority is required');
    if (
      !['ACTIVE', 'SUSPENDED'].includes(input.status) ||
      !['SECURITY', 'ABUSE', 'ADMINISTRATIVE', 'RESOLVED'].includes(
        input.reason,
      ) ||
      !(input.expectedUpdatedAt instanceof Date) ||
      !Number.isFinite(input.expectedUpdatedAt.getTime())
    )
      throw new ValidationException(
        'Revise o estado, motivo e versão informados.',
      );
    if (!key || !/^[A-Za-z0-9_-]{16,120}$/.test(key))
      throw new ValidationException(
        'Informe uma chave de idempotência válida.',
      );
    const correlationId = context.requestId.slice(0, 120);
    const keyHash = hash(key);
    const fingerprint = hash(
      JSON.stringify({
        status: input.status,
        reason: input.reason,
        expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
      }),
    );
    const metadata = {
      authoritySource: 'PLATFORM_ROLE_ASSIGNMENT',
      grantIds: [...authority.assignmentIds],
      correlationId,
      reason: input.reason,
      requestedStatus: input.status,
      expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
      idempotencyKeyHash: keyHash,
      requestFingerprint: fingerprint,
    } satisfies Prisma.InputJsonObject;
    try {
      return await this.rls.run(async (tx) => {
        // Serialize decisions on the root. CAS also protects against unrelated administrative edits.
        await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId}::uuid AND deleted_at IS NULL FOR UPDATE`;
        const before = await tx.organization.findFirst({
          where: { id: organizationId, deletedAt: null },
        });
        if (!before) throw new EntityNotFoundException('Organization');
        const previous = await tx.auditLog.findFirst({
          where: {
            organizationId,
            action: OPERATIONAL_DECISION,
            metadata: { path: ['idempotencyKeyHash'], equals: keyHash },
          },
        });
        const current = () => ({
          status: before.status,
          updatedAt: before.updatedAt.toISOString(),
        });
        if (previous) {
          const prior = previous.metadata as Prisma.JsonObject;
          if (prior.requestFingerprint !== fingerprint)
            throw new ConflictException(
              'A chave já foi usada para uma solicitação diferente.',
              'IDEMPOTENCY_MISMATCH',
            );
          return {
            decisionId: previous.id,
            replayed: true,
            decision: previous.after,
            current: current(),
          };
        }
        if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
          throw new ConflictException(
            'O estado foi alterado. Consulte novamente antes de continuar.',
            'STALE_VERSION',
          );
        if (
          !['ACTIVE', 'ONBOARDING', 'SUSPENDED'].includes(before.status) ||
          before.dataPurgeStartedAt ||
          before.dataPurgedAt
        )
          throw new ConflictException(
            'Esta organização não pode ser reativada por este fluxo.',
          );
        const changed = before.status !== input.status;
        if (changed && input.status === 'ACTIVE') {
          // Financial compatibility still supports legacy ACTIVE tenants. Reopening one must never
          // revive that fallback when the authoritative contract is absent. Do not create/repair it here.
          const contract = await tx.organizationSubscription.findFirst({
            where: { organizationId },
            select: { id: true },
          });
          if (!contract)
            throw new ConflictException(
              'Regularize a contratação antes de reativar a organização.',
              'ORGANIZATION_REACTIVATION_REQUIRES_SUBSCRIPTION',
            );
        }

        const decidedAt = new Date();
        const updatedAt = changed
          ? new Date(
              Math.max(decidedAt.getTime(), before.updatedAt.getTime() + 1),
            )
          : before.updatedAt;
        if (changed) {
          const applied = await tx.organization.updateMany({
            where: { id: organizationId, updatedAt: before.updatedAt },
            data: { status: input.status, updatedAt },
          });
          if (applied.count !== 1)
            throw new ConflictException(
              'O estado foi alterado.',
              'STALE_VERSION',
            );
        }
        // Wake only jobs already deferred because of suspension; future scheduled work keeps its date.
        if (changed && input.status === 'ACTIVE')
          await tx.backgroundJob.updateMany({
            where: {
              organizationId,
              status: 'PENDING',
              lastError: 'ORGANIZATION_SUSPENDED',
            },
            data: { availableAt: decidedAt, lastError: null },
          });
        const after = {
          organizationId,
          previousStatus: before.status,
          status: input.status,
          reason: input.reason,
          updatedAt: updatedAt.toISOString(),
          decidedAt: decidedAt.toISOString(),
          effectiveAt: decidedAt.toISOString(),
          expiresAt: null,
          result: changed ? 'APPLIED' : 'NO_CHANGE',
          operationalOnly: true,
        } satisfies Prisma.InputJsonObject;
        const decision = await tx.auditLog.create({
          data: {
            organizationId,
            userId: context.userId,
            action: OPERATIONAL_DECISION,
            createdAt: changed ? updatedAt : decidedAt,
            entityType: 'ORGANIZATION',
            entityId: organizationId,
            requestId: correlationId,
            before: current(),
            after,
            metadata: {
              ...metadata,
              result: changed ? 'APPLIED' : 'NO_CHANGE',
            },
          },
        });
        return {
          decisionId: decision.id,
          replayed: false,
          decision: after,
          current: { status: input.status, updatedAt: updatedAt.toISOString() },
        };
      });
    } catch (error) {
      // A rolled-back transition still leaves a durable rejection, without leaking tenant existence.
      await this.rls.run(async (tx) => {
        const target = await tx.organization.findFirst({
          where: { id: organizationId },
          select: { id: true, status: true, updatedAt: true },
        });
        await tx.auditLog.create({
          data: {
            organizationId: target?.id,
            userId: context.userId,
            action: 'TENANT_OPERATIONAL_STATUS_REJECTED',
            before: target
              ? {
                  status: target.status,
                  updatedAt: target.updatedAt.toISOString(),
                }
              : undefined,
            entityType: 'ORGANIZATION',
            entityId: organizationId,
            requestId: correlationId,
            metadata: {
              ...metadata,
              result: 'REJECTED',
              code:
                error instanceof ConflictException
                  ? error.code
                  : 'REQUEST_REJECTED',
            },
          },
        });
      });
      throw error;
    }
  }
}
