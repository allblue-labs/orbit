/**
 * Da assinatura para o que a API publica.
 *
 * `allowedActions` é autoridade do servidor: o cliente desenha os botões que
 * chegam, e não deduz o que pode fazer a partir do estado. Deduzir no cliente
 * é como as duas pontas passam a discordar.
 */
import { Injectable } from '@nestjs/common';
import { planDefinition, isKnownPlan } from '../catalog/plan-registry';
import { monthlyWindow } from '../entitlements/usage-window';
import type {
  OrganizationSubscriptionReadModel,
  SubscriptionTrialReadModel,
} from './subscription.read-models';
import type { SubscriptionRow } from './subscription.repository';
import {
  SubscriptionStatus,
  TRIAL_DAYS,
  allowsPlanChange,
  isTerminal,
} from './subscription.types';

export const SubscriptionAction = {
  SUBSCRIBE: 'SUBSCRIBE',
  CANCEL_AT_PERIOD_END: 'CANCEL_AT_PERIOD_END',
  KEEP_SUBSCRIPTION: 'KEEP_SUBSCRIPTION',
  CHANGE_PLAN: 'CHANGE_PLAN',
  CANCEL_SCHEDULED_CHANGE: 'CANCEL_SCHEDULED_CHANGE',
} as const;

@Injectable()
export class SubscriptionMapper {
  details(
    linha: SubscriptionRow & { effectiveStatus: SubscriptionStatus },
    at: Date = new Date(),
  ): OrganizationSubscriptionReadModel {
    const janela = monthlyWindow(linha.billingAnchorAt, at);
    return {
      id: linha.id,
      planCode: linha.planCode,
      planLabel: isKnownPlan(linha.planCode)
        ? planDefinition(linha.planCode).label
        : linha.planCode,
      billingInterval: linha.billingInterval,
      status: linha.effectiveStatus,
      version: linha.version,
      billingPeriod: {
        start: linha.currentPeriodStart.toISOString(),
        end: linha.currentPeriodEnd.toISOString(),
      },
      usagePeriod: {
        start: janela.start.toISOString(),
        end: janela.end.toISOString(),
      },
      trial: this.trial(linha),
      cancelAtPeriodEnd: linha.cancelAtPeriodEnd,
      pendingChange: linha.pendingPlanCode
        ? {
            planCode: linha.pendingPlanCode,
            billingInterval:
              linha.pendingBillingInterval ?? linha.billingInterval,
            effectiveAt: linha.pendingEffectiveAt!.toISOString(),
          }
        : null,
      allowedActions: this.actions(linha),
    };
  }

  private trial(linha: SubscriptionRow): SubscriptionTrialReadModel | null {
    if (!linha.trialStartsAt || !linha.trialEndsAt) return null;
    return {
      eligible: false,
      trialDays: TRIAL_DAYS,
      startsAt: linha.trialStartsAt.toISOString(),
      endsAt: linha.trialEndsAt.toISOString(),
    };
  }

  private actions(
    linha: SubscriptionRow & { effectiveStatus: SubscriptionStatus },
  ): string[] {
    if (linha.effectiveStatus === SubscriptionStatus.PENDING_PAYMENT) {
      return [SubscriptionAction.SUBSCRIBE];
    }
    if (isTerminal(linha.effectiveStatus)) {
      return [SubscriptionAction.SUBSCRIBE];
    }
    const acoes: string[] = [];
    if (linha.cancelAtPeriodEnd) {
      acoes.push(SubscriptionAction.KEEP_SUBSCRIPTION);
    } else {
      acoes.push(SubscriptionAction.CANCEL_AT_PERIOD_END);
    }
    if (allowsPlanChange(linha.effectiveStatus)) {
      acoes.push(SubscriptionAction.CHANGE_PLAN);
    }
    if (linha.pendingPlanCode) {
      acoes.push(SubscriptionAction.CANCEL_SCHEDULED_CHANGE);
    }
    return acoes;
  }
}
