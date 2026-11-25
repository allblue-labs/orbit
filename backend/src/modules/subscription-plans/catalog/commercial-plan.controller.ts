import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Permissions, Roles } from '../../../decorators';
import { ValidationException } from '../../../exceptions';
import { IsUUIDv7 } from '../../../validators';
import type { IdentityRequest } from '../../identity/infrastructure/jwt-authentication.guard';
import { TenantRecovery } from '../../tenant-operations/tenant-operation.policy';
import { StripeBillingProvider } from '../../billing/stripe/stripe-billing.provider';
import { CommercialPlanService } from './commercial-plan.service';

export const COMMERCIAL_PLAN_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

class PublishCommercialPlanDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  description!: string;

  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsUUIDv7()
  tenantId?: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  permissions!: string[];

  @IsObject()
  offer!: Record<string, unknown>;
}

@Controller('platform-admin/plans')
@TenantRecovery('platform')
@Roles('PLATFORM_ADMIN')
@Permissions('platform.admin')
export class CommercialPlanController {
  constructor(
    private readonly plans: CommercialPlanService,
    private readonly stripe: StripeBillingProvider,
  ) {}

  @Get()
  list() {
    return this.plans.adminList();
  }

  @Put(':code')
  publish(
    @Param('code') code: string,
    @Body() input: PublishCommercialPlanDto,
    @Req() request: IdentityRequest,
  ) {
    if (!COMMERCIAL_PLAN_CODE.test(code))
      throw new ValidationException('Código de plano inválido.');
    return this.plans.publish(
      code,
      input,
      request.identity!.id,
      input.isActive && this.stripe.isEnabled()
        ? (prices) => this.stripe.validateOfferPrices(prices)
        : undefined,
    );
  }
}
