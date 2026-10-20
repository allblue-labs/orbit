import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions, Public, Roles, Surfaces } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { ParseUUIDv7Pipe } from '../../pipes';
import {
  CreatePlanDto,
  RecordUsageDto,
  UpdatePlanDto,
} from './subscription-plan.dto';
import { SubscriptionPlanService } from './subscription-plan.service';
import { EntitlementService } from './entitlements/entitlement.service';
import { SubscriptionMapper } from './subscriptions/subscription.mapper';
import { SubscriptionService } from './subscriptions/subscription.service';
import { UsageService } from './usage.service';
import { RequiresActivePlan } from './plan-access';
import { ProductAccessService } from './product-access';

@ApiTags('Plans')
@Controller()
export class SubscriptionPlanController {
  constructor(
    private readonly plans: SubscriptionPlanService,
    private readonly usage: UsageService,
    private readonly entitlements: EntitlementService,
    private readonly subscriptions: SubscriptionService,
    private readonly subscriptionMapper: SubscriptionMapper,
    private readonly productAccess: ProductAccessService,
  ) {}

  @Public()
  @Get('plans')
  listPlans() {
    return this.plans.listPlans();
  }

  /**
   * O catálogo comercial congelado.
   *
   * Vem do código, não do banco: é o mesmo catálogo que decide acesso, e
   * publicar uma segunda cópia editável abriria espaço para as duas
   * divergirem. Só informação comercial — nada de cobrança (§99).
   */
  @Public()
  @Get('plans/catalog')
  planCatalog() {
    return this.entitlements.catalog();
  }

  @Post('plans')
  @Roles('PLATFORM_ADMIN')
  createPlan(@Body() input: CreatePlanDto) {
    return this.plans.createPlan(input);
  }

  @Patch('plans/:id')
  @Roles('PLATFORM_ADMIN')
  updatePlan(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: UpdatePlanDto,
  ) {
    return this.plans.updatePlan(id, input);
  }

  @Get('organizations/current/subscription')
  @Surfaces('WEB', 'MOBILE', 'API')
  getSubscription(@Req() request: IdentityRequest) {
    return this.plans.getEntitlements(this.organizationId(request));
  }

  /**
   * Quanto esta organização tem, quanto usou e quanto falta.
   *
   * O servidor é a autoridade: o cliente lê `current`, `limit` e `remaining`,
   * e nunca recalcula teto (§95, §96). O razão de uso não aparece — só o
   * agregado que interessa a quem está olhando a tela.
   */
  @Get('organizations/current/entitlements')
  @Permissions('usage.read')
  currentEntitlements(@Req() request: IdentityRequest) {
    return this.entitlements.describe(this.organizationId(request));
  }

  /** Product contract for clients; separate from route capabilities/RBAC. */
  @Get('organizations/current/product-access')
  @Surfaces('WEB', 'MOBILE', 'API')
  productAccessState(@Req() request: IdentityRequest) {
    return this.productAccess.describe(this.organizationId(request));
  }

  /**
   * A assinatura corrente, já reconciliada.
   *
   * `version` volta no corpo porque todo comando a exige de volta: é o
   * controle otimista que impede cancelar e trocar de plano ao mesmo tempo de
   * produzir um estado que ninguém pediu.
   */
  @Get('organizations/current/subscription-details')
  @Permissions('usage.read')
  async currentSubscription(@Req() request: IdentityRequest) {
    return this.subscriptionMapper.details(
      await this.subscriptions.requireCurrent(this.organizationId(request)),
    );
  }

  @Get('organizations/current/usage')
  @RequiresActivePlan()
  @Permissions('usage.read')
  listUsage(@Req() request: IdentityRequest) {
    return this.usage.listCurrent(this.organizationId(request));
  }

  @Post('organizations/current/usage')
  @RequiresActivePlan()
  @Permissions('usage.manage')
  recordUsage(@Req() request: IdentityRequest, @Body() input: RecordUsageDto) {
    return this.usage.record(this.organizationId(request), input);
  }

  private organizationId(request: IdentityRequest): string {
    const organizationId = request.identity?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }
}
