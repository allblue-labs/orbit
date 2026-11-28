import { Injectable } from '@nestjs/common';
import { Prisma, type OrganizationSubscription } from '@prisma/client';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { platformSubscription } from './platform-subscription.projection';
import { isTerminal } from '../subscription-plans/subscriptions/subscription.types';
import { RlsTransaction } from '../../database';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type {
  PlatformListQueryDto,
  UpdatePlatformOrganizationDto,
} from './dto/platform-administration.dto';
import type {
  CorporateAuditReference,
  CorporateMetadataUpdate,
  CorporateOrganizationDetailRecord,
  CorporateOrganizationPage,
} from './corporate-organization.read-model';

const organizationView = {
  owner: {
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      credential: { select: { passwordUpdatedAt: true } },
    },
  },
  adminProvisionings: {
    select: {
      id: true,
      status: true,
      correlationId: true,
      lastErrorCode: true,
      version: true,
      ownerPasswordProvided: true,
      planCode: true,
      billingInterval: true,
      completedAt: true,
      ownerSetupToken: { select: { usedAt: true, expiresAt: true } },
    },
    take: 1,
  },
  plan: {
    select: { id: true, key: true, name: true, isActive: true },
  },
  businessUnits: {
    where: { deletedAt: null },
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      isPrimary: true,
      status: true,
    },
  },
  _count: {
    select: {
      memberships: true,
      operations: true,
      customers: true,
      assets: true,
    },
  },
} satisfies Prisma.OrganizationInclude;

@Injectable()
export class PlatformAdministrationRepository {
  constructor(private readonly rls: RlsTransaction) {}

  transaction<T>(work: (tx: PrismaTransactionClient) => Promise<T>) {
    return this.rls.runAmbient(work, { timeout: 30_000 });
  }

  async canonical(
    tx: PrismaTransactionClient,
    ids: string[],
  ): Promise<Map<string, OrganizationSubscription>> {
    if (!ids.length) return new Map();
    const chosen = await tx.$queryRaw<{ id: string | null }[]>(Prisma.sql`
      SELECT public.app_platform_canonical_subscription_id(o.id) AS id
      FROM organizations o
      WHERE o.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    const rows = await tx.organizationSubscription.findMany({
      where: { id: { in: chosen.flatMap((row) => (row.id ? [row.id] : [])) } },
    });
    return new Map(rows.map((row) => [row.organizationId, row]));
  }

  listCorporateOrganizations(
    filters: Prisma.InputJsonObject,
    audit: CorporateAuditReference,
  ) {
    return this.corporateDirectoryRead<CorporateOrganizationPage>(
      null,
      filters,
      audit,
    );
  }

  findCorporateOrganization(id: string, audit: CorporateAuditReference) {
    return this.corporateDirectoryRead<CorporateOrganizationDetailRecord | null>(
      id,
      {},
      audit,
    );
  }

  private corporateDirectoryRead<T>(
    id: string | null,
    filters: Prisma.InputJsonObject,
    audit: CorporateAuditReference,
  ) {
    return this.rls.run(async (tx) => {
      const [row] = await tx.$queryRaw<[{ data: T }]>`
        SELECT public.app_corporate_read_organizations(
          ${id}::uuid, ${JSON.stringify(filters)}::jsonb,
          ${audit.technicalPrincipalId}::uuid, ${audit.declaredNexusAdministratorId ?? null}::uuid,
          ${audit.correlationId}::text
        ) AS data`;
      return row.data;
    });
  }

  updateCorporateOrganizationMetadata(
    id: string,
    input: {
      displayName?: string;
      primarySegment?: string;
      expectedUpdatedAt: string;
    },
    audit: CorporateAuditReference,
  ) {
    return this.rls.run(async (tx) => {
      const [row] = await tx.$queryRaw<[{ data: CorporateMetadataUpdate }]>`
        SELECT public.app_corporate_update_organization(
          ${id}::uuid, ${input.expectedUpdatedAt}::timestamptz,
          ${input.displayName ?? null}::text, ${input.primarySegment ?? null}::text,
          ${audit.technicalPrincipalId}::uuid, ${audit.declaredNexusAdministratorId ?? null}::uuid,
          ${audit.correlationId}::text
        ) AS data`;
      return row.data;
    });
  }

  private async projectOrganizations(
    tx: PrismaTransactionClient,
    organizations: Prisma.OrganizationGetPayload<{
      include: typeof organizationView;
    }>[],
  ) {
    const subscriptions = await this.canonical(
      tx,
      organizations.map((org) => org.id),
    );
    const plans = await tx.plan.findMany({
      where: {
        key: {
          in: [...subscriptions.values()].flatMap((sub) => [
            sub.planCode,
            ...(sub.pendingPlanCode ? [sub.pendingPlanCode] : []),
          ]),
        },
      },
      select: { id: true, key: true, name: true, isActive: true },
    });
    const at = new Date();
    return organizations.map((org) => {
      const subscription = platformSubscription(subscriptions.get(org.id), at);
      const plan =
        plans.find((plan) => plan.key === subscription.planCode) ?? null;
      const { credential, ...owner } = org.owner;
      const { adminProvisionings, ...organization } = org;
      const workflow = adminProvisionings[0];
      const passwordChanged = !!(
        workflow?.completedAt &&
        credential?.passwordUpdatedAt &&
        credential.passwordUpdatedAt > workflow.completedAt
      );
      const ownerSetup = !workflow
        ? 'UNKNOWN_LEGACY'
        : workflow.ownerPasswordProvided
          ? 'DIRECT_PASSWORD_DEPRECATED'
          : passwordChanged || workflow.ownerSetupToken?.usedAt
            ? 'PASSWORD_CONFIGURED'
            : workflow.ownerSetupToken
              ? workflow.ownerSetupToken.expiresAt <= at
                ? 'EXPIRED'
                : 'SETUP_LINK_QUEUED'
              : 'NOT_QUEUED';
      return {
        ...organization,
        owner,
        planId: plan?.id ?? null,
        plan,
        externalCustomerId:
          subscriptions.get(org.id)?.providerCustomerId ?? null,
        externalSubscriptionId:
          subscriptions.get(org.id)?.providerSubscriptionId ?? null,
        subscriptionStartedAt: subscriptions.get(org.id)?.startedAt ?? null,
        subscriptionStatus: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        subscription,
        legacyBilling: {
          externalCustomerId: org.externalCustomerId,
          externalSubscriptionId: org.externalSubscriptionId,
          planId: org.planId,
          planKey: org.plan.key,
          subscriptionStatus: org.subscriptionStatus,
          currentPeriodEnd: org.currentPeriodEnd,
          inconsistent:
            subscription.source === 'UNKNOWN_LEGACY' ||
            org.plan.key !== subscription.planCode ||
            org.subscriptionStatus !== subscription.status ||
            org.currentPeriodEnd?.getTime() !==
              subscription.currentPeriodEnd?.getTime(),
        },
        provisioning: workflow
          ? {
              id: workflow.id,
              requestedPlanCode: workflow.planCode,
              requestedBillingInterval: workflow.billingInterval,
              status: workflow.status,
              correlationId: workflow.correlationId,
              version: workflow.version,
              lastErrorCode: workflow.lastErrorCode,
              ownerSetup,
              deliveryConfirmation: 'NOT_OBSERVED',
              complete: workflow.status === 'COMPLETED',
            }
          : null,
      };
    });
  }

  overview() {
    return this.rls.run(async (tx) => {
      const totals = {
        organizations: 0,
        users: await tx.user.count({ where: { deletedAt: null } }),
        activeSubscriptions: 0,
        pendingSubscriptions: 0,
        validTrials: 0,
        endedSubscriptions: 0,
        unknownLegacySubscriptions: 0,
        scheduledPlanChanges: 0,
        scheduledCancellations: 0,
        suspendedOrganizations: 0,
        activePlans: await tx.plan.count({ where: { isActive: true } }),
        activeModules: await tx.module.count({ where: { isActive: true } }),
      };
      let cursor: string | undefined;
      const at = new Date();
      for (;;) {
        const batch = await tx.organization.findMany({
          where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true, status: true },
          orderBy: { id: 'asc' },
          take: 200,
        });
        if (!batch.length) break;
        const canonical = await this.canonical(
          tx,
          batch.map((row) => row.id),
        );
        for (const org of batch) {
          totals.organizations++;
          if (org.status === 'SUSPENDED') totals.suspendedOrganizations++;
          const sub = platformSubscription(canonical.get(org.id), at);
          if (sub.source === 'UNKNOWN_LEGACY')
            totals.unknownLegacySubscriptions++;
          else if (sub.status === 'ACTIVE') totals.activeSubscriptions++;
          else if (sub.status === 'TRIALING') totals.validTrials++;
          else if (sub.status === 'PENDING_PAYMENT')
            totals.pendingSubscriptions++;
          else if (isTerminal(sub.status)) totals.endedSubscriptions++;
          if (sub.pendingChange) totals.scheduledPlanChanges++;
          if (sub.cancelAtPeriodEnd) totals.scheduledCancellations++;
        }
        cursor = batch[batch.length - 1]!.id;
        if (batch.length < 200) break;
      }
      return { ...totals, financialSource: 'CANONICAL', asOf: at };
    });
  }

  listOrganizations(query: PlatformListQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              {
                owner: {
                  email: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    return this.rls.run(async (tx) => {
      const data = await tx.organization.findMany({
        where,
        include: organizationView,
        orderBy: { createdAt: 'desc' },
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.organization.count({ where });
      return PaginationHelper.result(
        await this.projectOrganizations(tx, data),
        total,
        pagination,
      );
    });
  }

  findOrganization(id: string) {
    return this.rls.run(async (tx) => {
      const org = await tx.organization.findFirst({
        where: { id, deletedAt: null },
        include: organizationView,
      });
      return org ? (await this.projectOrganizations(tx, [org]))[0] : null;
    });
  }

  listUsers(query: PlatformListQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (tx) => {
      const data = await tx.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          emailVerifiedAt: true,
          lastAuthenticatedAt: true,
          createdAt: true,
          organizationMemberships: {
            where: { deletedAt: null },
            select: {
              organizationId: true,
              status: true,
              role: { select: { key: true } },
            },
          },
          platformRoleAssignments: {
            where: { revokedAt: null },
            select: { role: { select: { key: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.user.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  plansAndModules() {
    return this.rls.run(async (tx) => {
      const plans = await tx.plan.findMany({
        orderBy: { monthlyPrice: 'asc' },
      });
      const modules = await tx.module.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return { plans, modules };
    });
  }

  updateOrganization(
    id: string,
    actorId: string,
    input: UpdatePlatformOrganizationDto,
    auditMetadata: Prisma.InputJsonObject & { correlationId: string },
  ) {
    return this.transaction(async (tx) => {
      const before = await tx.organization.findFirst({
        where: { id, deletedAt: null },
      });
      if (!before) return null;
      if (
        input.planKey !== undefined ||
        input.subscriptionStatus !== undefined ||
        input.currentPeriodEnd !== undefined
      )
        throw new Error('ADMIN_FINANCIAL_FIELDS_READ_ONLY');
      if (input.status !== undefined && input.status !== before.status)
        throw new Error('ADMIN_OPERATIONAL_STATUS_READ_ONLY');
      const change =
        input.displayName !== undefined || input.primarySegment !== undefined;
      if (change) {
        if (!input.expectedUpdatedAt)
          throw new Error('ADMIN_EXPECTED_VERSION_REQUIRED');
        const updated = await tx.organization.updateMany({
          where: { id, updatedAt: input.expectedUpdatedAt },
          data: {
            displayName: input.displayName,
            primarySegment: input.primarySegment,
          },
        });
        if (updated.count !== 1) throw new Error('ADMIN_VERSION_CONFLICT');
      }
      const after = await tx.organization.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          organizationId: id,
          userId: actorId,
          action: 'PLATFORM_ORGANIZATION_UPDATED',
          entityType: 'ORGANIZATION',
          entityId: id,
          requestId: auditMetadata.correlationId,
          before: {
            displayName: before.displayName,
            primarySegment: before.primarySegment,
            updatedAt: before.updatedAt.toISOString(),
          },
          after: {
            displayName: after.displayName,
            primarySegment: after.primarySegment,
            updatedAt: after.updatedAt.toISOString(),
          },
          metadata: {
            ...auditMetadata,
            result: change ? 'CONFIRMED' : 'NO_CHANGE',
          },
        },
      });
      return true;
    });
  }

  findPlan(key: string) {
    return this.rls.run((tx) =>
      tx.plan.findFirst({ where: { key, isActive: true } }),
    );
  }
}
