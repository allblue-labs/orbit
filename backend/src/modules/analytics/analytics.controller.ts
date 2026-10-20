import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { PlanCapability } from '../subscription-plans/catalog/plan-catalog.types';
import {
  ProductCapabilities,
  ProductFeature,
  RequiresProductFeature,
} from '../subscription-plans/product-access';

@ApiTags('Analytics Engine')
@ApiBearerAuth()
@Controller('analytics')
@RequiresActivePlan()
@Capabilities('analytics.read')
@Permissions('analytics.read')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Aggregate the complete Analytics Read Model' })
  @ApiOkResponse({
    description: 'KPIs, trends, health, forecasts and environmental impact',
  })
  overview(@Req() request: IdentityRequest, @Query() query: AnalyticsQueryDto) {
    return this.analytics.overview(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  @Get('kpis')
  @ApiOperation({
    summary:
      'Return operational, PMOC, equipment, technician and contract KPIs',
  })
  kpis(@Req() request: IdentityRequest, @Query() query: AnalyticsQueryDto) {
    return this.analytics.kpis(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  @Get('trends')
  trends(@Req() request: IdentityRequest, @Query() query: AnalyticsQueryDto) {
    return this.analytics.trends(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  @Get('health')
  health(@Req() request: IdentityRequest, @Query() query: AnalyticsQueryDto) {
    return this.analytics.health(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  @Get('forecasts')
  @ApiOperation({
    summary: 'Return simple statistical projections over analytical series',
  })
  forecasts(
    @Req() request: IdentityRequest,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.forecasts(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  @Get('environmental-impact')
  @ApiOperation({
    summary:
      'Transform Weather & Environmental Intelligence into operational impact indicators',
  })
  environmentalImpact(@Req() request: IdentityRequest) {
    this.org(request);
    return this.analytics.environmentalImpact();
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Return a compact, widget-ready Dashboard Read Model',
  })
  dashboard(
    @Req() request: IdentityRequest,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.dashboard(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  @Get('intelligence')
  @ProductCapabilities(PlanCapability.ORBIT_INTELLIGENCE)
  @RequiresProductFeature(ProductFeature.ORBIT_INTELLIGENCE)
  @ApiOperation({
    summary: 'Return the stable analytics context for Orbit Intelligence',
  })
  intelligence(
    @Req() request: IdentityRequest,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.intelligenceContext(
      this.org(request),
      query,
      request.identity!.permissions,
    );
  }

  private org(request: IdentityRequest) {
    if (!request.identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return request.identity.organizationId;
  }
}
