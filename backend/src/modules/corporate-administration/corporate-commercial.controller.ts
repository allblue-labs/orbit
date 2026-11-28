import { ExpandAdministrativeDetailDto } from './corporate-completion.dto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../decorators';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
  type CorporateCall,
} from './corporate-access.guard';
import {
  CorporatePlanCommandDto,
  CorporatePlanQueryDto,
  CorporateSubscriptionCommandDto,
} from './corporate-commercial.dto';
import { CorporateCommercialService } from './corporate-commercial.service';
import { corporateValidation } from './corporate-request';
import {
  PLANS_READ,
  SUBSCRIPTIONS_CHANGE_PLAN,
  SUBSCRIPTIONS_KEEP,
  SUBSCRIPTIONS_CANCEL_SCHEDULED_CHANGE,
  SUBSCRIPTIONS_READ,
  TRIALS_MANAGE,
  TRIALS_READ,
} from './technical-credential.service';

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin', version: '1' })
export class CorporateCommercialController {
  constructor(private readonly commercial: CorporateCommercialService) {}

  @Get('plans')
  @RequiresCorporateCapability(PLANS_READ)
  async plans(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: CorporatePlanQueryDto,
  ) {
    return {
      plans: await this.commercial.plans(
        call,
        reference,
        query.organizationId?.toLowerCase(),
      ),
    };
  }

  @Get('plans/:id')
  @RequiresCorporateCapability(PLANS_READ)
  async plan(
    @CorporateCaller() call: CorporateCall,
    @Param('id') id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: CorporatePlanQueryDto,
  ) {
    const [plan] = await this.commercial.plans(
      call,
      reference,
      query.organizationId?.toLowerCase(),
      id,
    );
    return plan;
  }

  @Get('organizations/:id/subscription')
  @RequiresCorporateCapability(SUBSCRIPTIONS_READ)
  subscription(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    return this.commercial.subscription(call, reference, id.toLowerCase());
  }

  @Get('organizations/:id/trial')
  @RequiresCorporateCapability(TRIALS_READ)
  trial(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: ExpandAdministrativeDetailDto,
  ) {
    return this.commercial.trial(
      call,
      reference,
      id.toLowerCase(),
      query.includeDetails === 'true',
    );
  }

  @Get('organizations/:id/subscription/operations/:operationId')
  @RequiresCorporateCapability(SUBSCRIPTIONS_READ)
  operation(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    return this.commercial.operation(
      call,
      reference,
      id.toLowerCase(),
      operationId,
    );
  }

  @Post('organizations/:id/subscription/change-plan')
  @HttpCode(202)
  @RequiresCorporateCapability(SUBSCRIPTIONS_CHANGE_PLAN)
  changePlan(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) input: CorporatePlanCommandDto,
  ) {
    return this.commercial.write(
      call,
      reference,
      id.toLowerCase(),
      'CHANGE_PLAN',
      key,
      input,
    );
  }

  @Post('organizations/:id/subscription/keep')
  @HttpCode(200)
  @RequiresCorporateCapability(SUBSCRIPTIONS_KEEP)
  keep(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) input: CorporateSubscriptionCommandDto,
  ) {
    return this.commercial.write(
      call,
      reference,
      id.toLowerCase(),
      'KEEP',
      key,
      input,
    );
  }

  @Post('organizations/:id/subscription/cancel-scheduled-change')
  @HttpCode(200)
  @RequiresCorporateCapability(SUBSCRIPTIONS_CANCEL_SCHEDULED_CHANGE)
  cancelScheduledChange(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) input: CorporateSubscriptionCommandDto,
  ) {
    return this.commercial.write(
      call,
      reference,
      id.toLowerCase(),
      'CANCEL_SCHEDULED_CHANGE',
      key,
      input,
    );
  }

  @Post('organizations/:id/trial/start')
  @HttpCode(200)
  @RequiresCorporateCapability(TRIALS_MANAGE)
  startTrial(
    @CorporateCaller() call: CorporateCall,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) input: CorporatePlanCommandDto,
  ) {
    return this.commercial.write(
      call,
      reference,
      id.toLowerCase(),
      'START_TRIAL',
      key,
      input,
    );
  }
}
