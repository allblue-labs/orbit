import { Injectable } from '@nestjs/common';
import {
  BillingInterval,
  type BillingInterval as BillingIntervalType,
} from '../catalog/plan-catalog.types';
import { CommercialPlanService } from '../catalog/commercial-plan.service';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';
import { TrialEligibilityService } from './trial-eligibility.service';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { TrialNotEligibleException } from './subscription.errors';

export interface ProvisionInput {
  organizationId: string;
  planKey: string;
  legalDocument: string;
  billingInterval?: BillingIntervalType;
  at?: Date;
}

@Injectable()
export class SubscriptionProvisioningService {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly trials: TrialEligibilityService,
    private readonly repository: SubscriptionRepository,
    private readonly plans: CommercialPlanService,
  ) {}

  /** Shared transactional subscription setup for public registration and provisioning. */
  async provisionIn(tx: PrismaTransactionClient, input: ProvisionInput) {
    const plan = await this.plans.selectable(
      input.planKey,
      input.organizationId,
      tx,
    );
    const current = await this.repository.findCurrent(input.organizationId, tx);
    if (current) return current; // Resume observes effects, never overwrites them.
    const startsAt = input.at ?? new Date();
    let trial: { startsAt: Date; endsAt: Date } | null = null;
    if (plan.trialDays > 0) {
      try {
        trial = await this.trials.grantTrial(
          {
            organizationId: input.organizationId,
            planCode: input.planKey,
            legalDocument: input.legalDocument,
            at: startsAt,
          },
          tx,
        );
      } catch (error) {
        if (!(error instanceof TrialNotEligibleException)) throw error;
      }
    }
    return this.subscriptions.create(
      {
        organizationId: input.organizationId,
        planCode: input.planKey,
        billingInterval: input.billingInterval ?? BillingInterval.MONTHLY,
        startsAt,
        access: trial
          ? { kind: 'TRIAL', ...trial }
          : { kind: 'PAYMENT_REQUIRED' },
      },
      tx,
    );
  }
}
