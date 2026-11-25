import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import {
  IdentityEmailOutbox,
  type ClaimedIdentityEmail,
} from '../identity/infrastructure/identity-email.outbox';
import {
  accountEmailOwner,
  type AccountEmailPurpose,
} from './account-email-policy';
import {
  transactionalEmail,
  accountEmailLink,
} from './transactional-templates';
import { EntitlementRepository } from '../subscription-plans/entitlements/entitlement.repository';
import {
  fromSubscription,
  limitFor,
} from '../subscription-plans/entitlements/effective-entitlements';
import { monthlyWindow } from '../subscription-plans/entitlements/usage-window';
import {
  AllocationResource,
  UsageResource,
} from '../subscription-plans/catalog/plan-catalog.types';
import { project } from '../subscription-plans/subscriptions/subscription.projection';
import { grantsProductAccess } from '../subscription-plans/subscriptions/subscription.types';

const labels: Record<string, string> = {
  BUSINESS_UNITS: 'unidades',
  PLATFORM_USERS: 'usuários',
  FIELD_TECHNICIANS: 'equipe em campo',
  AUXILIARY_TECHNICIANS: 'equipe em campo',
  ACTIVE_CUSTOMERS: 'clientes ativos',
  ACTIVE_EQUIPMENT: 'equipamentos',
  ACTIVE_PMOC_PLANS: 'contratos PMOC',
  ACTIVE_RVT_CONFIGURATIONS: 'configurações RVT',
  SERVICE_ORDERS_CREATED: 'ordens de serviço no mês',
  PMOC_DOCUMENTS_ISSUED: 'documentos PMOC no mês',
  RVT_DOCUMENTS_ISSUED: 'documentos RVT no mês',
  OTHER_DOCUMENTS_ISSUED: 'outros documentos no mês',
  AUTOMATION_RUNS: 'automações no mês',
  AI_COMPUTE: 'análises no mês',
  STORAGE_BYTES: 'armazenamento',
};
type Notice = {
  purpose: AccountEmailPurpose;
  eventKey: string;
  resources?: string[];
  organizationName?: string;
};
@Injectable()
export class AccountNoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: IdentityEmailOutbox,
    private readonly entitlements: EntitlementRepository,
  ) {}
  private platform<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.is_platform_admin','true',true)`;
        return work(tx);
      },
      { timeout: 30000 },
    );
  }
  private async statesIn(
    tx: PrismaTransactionClient,
    userId: string,
    at = new Date(),
  ): Promise<Notice[]> {
    const owner = await accountEmailOwner(tx, userId);
    if (!owner?.verifiedAt) return [];
    const org = await tx.organization.findUnique({
      where: { id: owner.organizationId },
      select: {
        displayName: true,
        dataPurgeStartedAt: true,
        dataPurgedAt: true,
      },
    });
    if (!org || org.dataPurgeStartedAt || org.dataPurgedAt) return [];
    const current = await tx.organizationSubscription.findFirst({
      where: { organizationId: owner.organizationId, endedAt: null },
    });
    const subscription =
      current ??
      (await tx.organizationSubscription.findFirst({
        where: { organizationId: owner.organizationId },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      }));
    if (!subscription || subscription.status === 'PENDING_PAYMENT') return [];
    const state = project(
      {
        ...subscription,
        providerManaged: !!subscription.providerSubscriptionId,
      },
      at,
    );
    if (!grantsProductAccess(state.status)) {
      const expired =
        subscription.status === 'TRIALING' || subscription.status === 'EXPIRED'
          ? (subscription.trialEndsAt ?? subscription.currentPeriodEnd)
          : state.status === 'SUSPENDED'
            ? (state.graceEndsAt ?? subscription.currentPeriodEnd)
            : subscription.currentPeriodEnd;
      const age = at.getTime() - expired.getTime();
      if (age < 86400000 || age > 7 * 86400000) return [];
      const checkout = await tx.billingCheckoutAttempt.findFirst({
        where: {
          organizationId: owner.organizationId,
          status: { in: ['CREATING', 'OPEN'] },
        },
      });
      if (checkout) return [];
      return [
        {
          purpose: 'PLAN_EXPIRED',
          eventKey: `${subscription.id}:${expired.toISOString()}`,
          organizationName: org.displayName,
        },
      ];
    }
    if (subscription.endedAt) return [];
    const rights = fromSubscription(
      subscription.planCode,
      subscription.planCode,
      subscription.entitlementsSnapshot,
      true,
    );
    const window = monthlyWindow(subscription.billingAnchorAt, at),
      resources: string[] = [];
    for (const resource of Object.values(AllocationResource)) {
      const limit = limitFor(rights, resource);
      if (
        limit.kind === 'LIMITED' &&
        (await this.entitlements.countAllocation(
          owner.organizationId,
          resource,
          tx,
        )) > limit.value
      )
        resources.push(labels[resource] ?? 'limites de cadastros');
    }
    for (const resource of Object.values(UsageResource)) {
      const limit = limitFor(rights, resource);
      if (limit.kind === 'LIMITED') {
        const current = await this.entitlements.sumUsage(
          owner.organizationId,
          resource,
          window,
          tx,
        );
        if (current > 0 && current >= limit.value)
          resources.push(labels[resource] ?? 'limites de uso');
      }
    }
    return resources.length
      ? [
          {
            purpose: 'PLAN_LIMIT_REACHED',
            eventKey: `${subscription.id}:${subscription.planCode}:${window.start.toISOString()}:${subscription.limitsChangedAt?.toISOString() ?? ''}`,
            organizationName: org.displayName,
            resources: [...new Set(resources)],
          },
        ]
      : [];
  }
  async scan(at = new Date(), after?: string) {
    const owners = await this.platform((tx) =>
      tx.accountEmailOwner.findMany({
        where: after ? { userId: { gt: after } } : {},
        orderBy: { userId: 'asc' },
        take: 25,
        select: { userId: true },
      }),
    );
    for (const owner of owners)
      await this.platform(async (tx) => {
        const states = await this.statesIn(tx, owner.userId, at);
        for (const state of states)
          await this.outbox.enqueueNoticeIn(
            tx,
            owner.userId,
            state.purpose,
            state.eventKey,
            { eventKey: state.eventKey },
          );
      });
    return owners.length === 25 ? owners[24]!.userId : undefined;
  }
  /** Refresh state immediately before sending; reactivation/adequation suppresses stale work. */
  async prepare(row: ClaimedIdentityEmail, data: Record<string, unknown>) {
    return this.platform(async (tx) => {
      if (!row.userId) return null;
      const owner = await accountEmailOwner(tx, row.userId);
      if (!owner) return null;
      if (row.purpose === 'PASSWORD_CHANGED')
        return transactionalEmail('PASSWORD_CHANGED', {
          name: owner.displayName,
          link: accountEmailLink(true),
        });
      const state = (await this.statesIn(tx, row.userId)).find(
        (s) => s.purpose === row.purpose && s.eventKey === data.eventKey,
      );
      return state
        ? transactionalEmail(state.purpose, {
            name: owner.displayName,
            link: accountEmailLink(),
            resources: state.resources,
            organizationName: state.organizationName,
          })
        : null;
    });
  }
}
