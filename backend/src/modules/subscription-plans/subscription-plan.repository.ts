import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { InfrastructureException } from '../../exceptions';

export interface PlanTenantAccess {
  userId: string;
  businessUnitIds: readonly string[];
}

/** O que o Postgres diz estar valendo dentro da transação. */
interface ContextProbe {
  role: string;
  organization: string | null;
  units: string | null;
}

@Injectable()
export class SubscriptionPlanRepository {
  private readonly logger = new Logger(SubscriptionPlanRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  listActive() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ monthlyPrice: 'asc' }, { name: 'asc' }],
    });
  }

  findActiveByKey(key: string) {
    return this.prisma.plan.findFirst({ where: { key, isActive: true } });
  }

  createPlan(data: Prisma.PlanCreateInput) {
    return this.prisma.plan.create({ data });
  }

  updatePlan(id: string, data: Prisma.PlanUpdateInput) {
    return this.prisma.plan.update({ where: { id }, data });
  }

  getOrganizationEntitlements(
    organizationId: string,
    access?: PlanTenantAccess,
  ) {
    if (access) {
      return this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(
          `SELECT set_config('app.user_id', $1, true),
                  set_config('app.organization_id', $2, true),
                  set_config('app.business_unit_ids', $3, true)`,
          access.userId,
          organizationId,
          access.businessUnitIds.join(','),
        );
        const organization = await transaction.organization.findUnique({
          where: { id: organizationId, deletedAt: null },
          select: {
            id: true,
            status: true,
            subscriptionStatus: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            externalCustomerId: true,
            externalSubscriptionId: true,
            plan: true,
            subscriptions: {
              where: { endedAt: null },
              orderBy: { startedAt: 'desc' },
              take: 1,
            },
          },
        });

        /**
         * A organização sumiu debaixo do próprio contexto que a declara.
         *
         * Este caminho é o guard de plano: se ele não enxerga a organização,
         * toda rota do inquilino poderia responder 404. Um contexto ausente ou
         * divergente agora é tratado como falha interna; somente um contexto
         * válido pode resultar em ausência real/invisível. A diferença entre
         * *não existe* e *o contexto se
         * perdeu* é o que separa um erro de dados de um defeito de isolamento,
         * e sem ela a PR-26.6 ficou meio dia sem saber qual dos dois tinha.
         */
        if (!organization) {
          const diagnosis = await this.diagnose(
            transaction,
            organizationId,
            access,
          );
          if (
            diagnosis === 'CONTEXT_MISSING' ||
            diagnosis === 'CONTEXT_MISMATCH'
          ) {
            throw new InfrastructureException(
              'Infrastructure operation failed',
              { category: 'TRANSACTION_FAILURE' },
            );
          }
        }

        return organization;
      });
    }
    return this.rls.run((transaction) =>
      transaction.organization.findUnique({
        where: { id: organizationId, deletedAt: null },
        select: {
          id: true,
          status: true,
          subscriptionStatus: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          externalCustomerId: true,
          externalSubscriptionId: true,
          plan: true,
          subscriptions: {
            where: { endedAt: null },
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
      }),
    );
  }

  /**
   * Pergunta ao Postgres o que ele acha que está valendo.
   *
   * Roda **dentro da mesma transação** da consulta que falhou — é a única
   * forma de saber se o `set_config` chegou até aqui. Nenhum dado sensível: só
   * papel, identificadores e o que o próprio processo já tinha em mãos.
   */
  private async diagnose(
    transaction: PrismaTransactionClient,
    organizationId: string,
    access: PlanTenantAccess,
  ): Promise<
    'CONTEXT_MISSING' | 'CONTEXT_MISMATCH' | 'POLICY_DENIED_OR_ABSENT'
  > {
    try {
      const [probe] = await transaction.$queryRaw<ContextProbe[]>`
        SELECT current_user::text AS role,
               NULLIF(current_setting('app.organization_id', true), '') AS organization,
               NULLIF(current_setting('app.business_unit_ids', true), '') AS units
      `;

      const declared = probe?.organization ?? null;
      const reason =
        declared === null
          ? 'CONTEXT_MISSING'
          : declared !== organizationId
            ? 'CONTEXT_MISMATCH'
            : 'POLICY_DENIED_OR_ABSENT';

      this.logger.warn(
        JSON.stringify({
          stage: 'entitlements-not-found',
          reason,
          expectedOrganizationId: organizationId,
          declaredOrganizationId: declared,
          expectedUnits: access.businessUnitIds.length,
          declaredUnits: probe?.units?.split(',').length ?? 0,
          role: probe?.role ?? null,
        }),
      );
      return reason;
    } catch (error) {
      throw new InfrastructureException('Infrastructure operation failed', {
        cause: error,
        category: 'TRANSACTION_FAILURE',
      });
    }
  }

  updateSubscriptionState(
    organizationId: string,
    data: Prisma.OrganizationUpdateInput,
  ) {
    return this.rls.run((transaction) =>
      transaction.organization.update({
        where: { id: organizationId },
        data,
        include: { plan: true },
      }),
    );
  }
}
