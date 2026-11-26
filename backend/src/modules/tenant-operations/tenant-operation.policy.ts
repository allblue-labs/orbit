import { Injectable, SetMetadata } from '@nestjs/common';
import {
  RequestContext,
  RequestContextService,
  RequestContextStorage,
} from '../../context';
import type { UUID } from '../../contracts';
import { RlsTransaction } from '../../database';
import { ForbiddenException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { isOrganizationOperational } from './tenant-operation-state';

export const TENANT_RECOVERY = 'tenant:operational-recovery';
export const TENANT_STATUS_CHANGE = 'tenant:status-change';
export const TenantOperationalChange = () =>
  SetMetadata(TENANT_STATUS_CHANGE, true);
/** Exempts only the operational restriction. Authentication, RBAC and financial gates still apply. */
export const TenantRecovery = (
  purpose: 'identity' | 'billing' | 'platform' | 'context',
) => SetMetadata(TENANT_RECOVERY, purpose);
export const OPERATIONAL_DECISION = 'TENANT_OPERATIONAL_STATUS_CHANGED';
export const CONTINUING_QUEUES: ReadonlySet<string> = new Set([
  'artifact.manifest.issued',
  'quote.status.changed',
  'mobile.sync.cleanup',
  'mobile.evidence.cleanup',
]);
export const TENANT_DEFER_MS = 5 * 60_000;

@Injectable()
export class TenantOperationPolicy {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextService,
    private readonly storage: RequestContextStorage,
  ) {}

  async snapshot() {
    const organizationId = this.contexts.get().organizationId;
    if (!organizationId)
      throw new ForbiddenException('Organization context is required');
    // Explicit predicate plus RLS: a verified platform actor also stays in its authenticated tenant.
    const organization = await this.rls.run((tx) =>
      tx.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          dataPurgeStartedAt: true,
          dataPurgedAt: true,
        },
      }),
    );
    return {
      organizationId,
      status: organization?.status ?? 'UNAVAILABLE',
      operational: Boolean(
        organization &&
        isOrganizationOperational(
          organization.status,
          Boolean(organization.dataPurgeStartedAt || organization.dataPurgedAt),
        ),
      ),
      updatedAt: organization?.updatedAt.toISOString() ?? null,
    };
  }

  async assertOperational(checked?: {
    operational: boolean;
    status: string | null;
  }): Promise<void> {
    const state = checked ?? (await this.snapshot());
    if (!state.operational)
      throw new ForbiddenException(
        'A organização está temporariamente impedida de operar. Entre em contato com o responsável.',
        state.status === 'SUSPENDED'
          ? 'ORGANIZATION_SUSPENDED'
          : 'ORGANIZATION_UNAVAILABLE',
      );
  }

  /** Only for tenant IDs obtained from an already authenticated, server-validated capability. */
  async assertCapabilityTenant(organizationId: string): Promise<void> {
    await this.storage.run(
      new RequestContext({
        requestId: generateUuidV7(),
        actorType: 'SYSTEM',
        userId: null,
        organizationId: organizationId as UUID,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      () => this.assertOperational(),
    );
  }
}
