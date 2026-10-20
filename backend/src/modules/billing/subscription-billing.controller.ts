/**
 * Comandos comerciais da assinatura.
 *
 * As URLs permanecem estáveis para web/mobile. A implementação mora na
 * fronteira de billing porque uma assinatura vinculada nunca pode mudar
 * localmente antes que o provedor financeiro aceite o mesmo comando.
 */
import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  ChangeSubscriptionPlanDto,
  SubscriptionVersionDto,
} from '../subscription-plans/subscriptions/subscription.dto';
import { SubscriptionMapper } from '../subscription-plans/subscriptions/subscription.mapper';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import { BillingService } from './billing.service';

@ApiTags('Billing')
@Controller('organizations/current/subscription')
export class SubscriptionBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionService,
    private readonly mapper: SubscriptionMapper,
  ) {}

  @Post('cancel')
  @Permissions('subscription.manage')
  async cancel(
    @Req() request: IdentityRequest,
    @Body() input: SubscriptionVersionDto,
  ) {
    const organizationId = this.organizationId(request);
    await this.billing.cancelSubscription(
      organizationId,
      input.expectedVersion,
    );
    return this.details(organizationId);
  }

  @Post('keep')
  @Permissions('subscription.manage')
  async keep(
    @Req() request: IdentityRequest,
    @Body() input: SubscriptionVersionDto,
  ) {
    const organizationId = this.organizationId(request);
    await this.billing.keepSubscription(organizationId, input.expectedVersion);
    return this.details(organizationId);
  }

  @Post('change-plan')
  @Permissions('subscription.manage')
  async changePlan(
    @Req() request: IdentityRequest,
    @Body() input: ChangeSubscriptionPlanDto,
  ) {
    const organizationId = this.organizationId(request);
    await this.billing.changeSubscriptionPlan({
      organizationId,
      expectedVersion: input.expectedVersion,
      planCode: input.planCode,
      billingInterval: input.billingInterval,
    });
    return this.details(organizationId);
  }

  @Post('cancel-scheduled-change')
  @Permissions('subscription.manage')
  async cancelScheduledChange(
    @Req() request: IdentityRequest,
    @Body() input: SubscriptionVersionDto,
  ) {
    const organizationId = this.organizationId(request);
    await this.billing.cancelScheduledPlanChange(
      organizationId,
      input.expectedVersion,
    );
    return this.details(organizationId);
  }

  private async details(organizationId: string) {
    return this.mapper.details(
      await this.subscriptions.requireCurrent(organizationId),
    );
  }

  private organizationId(request: IdentityRequest): string {
    const organizationId = request.identity?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }
}
