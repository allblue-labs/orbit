import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../decorators';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
  type CorporateCall,
} from './corporate-access.guard';
import {
  AnalyticsLifecycleDto,
  AnalyticsPeriodDto,
  AnalyticsRecurringDto,
} from './corporate-analytics.dto';
import { CorporateAnalyticsService } from './corporate-analytics.service';
import { corporateValidation } from './corporate-request';
import {
  ANALYTICS_DELINQUENCY_READ,
  ANALYTICS_LIFECYCLE_READ,
  ANALYTICS_REVENUE_READ,
  ANALYTICS_TRIALS_READ,
} from './technical-credential.service';

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin/analytics', version: '1' })
export class CorporateAnalyticsController {
  constructor(private readonly analytics: CorporateAnalyticsService) {}

  @Get('recurring-revenue')
  @RequiresCorporateCapability(ANALYTICS_REVENUE_READ)
  revenue(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: AnalyticsRecurringDto,
  ) {
    return this.analytics.revenue(call, reference, query);
  }

  @Get('customer-lifecycle')
  @RequiresCorporateCapability(ANALYTICS_LIFECYCLE_READ)
  lifecycle(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: AnalyticsLifecycleDto,
  ) {
    return this.analytics.lifecycle(call, reference, query);
  }

  @Get('trial-conversion')
  @RequiresCorporateCapability(ANALYTICS_TRIALS_READ)
  trials(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: AnalyticsPeriodDto,
  ) {
    return this.analytics.trials(call, reference, query);
  }

  @Get('delinquency')
  @RequiresCorporateCapability(ANALYTICS_DELINQUENCY_READ)
  delinquency(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: AnalyticsPeriodDto,
  ) {
    return this.analytics.delinquency(call, reference, query);
  }
}
