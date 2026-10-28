import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { RecurringAuthorizationService } from './recurring-authorization.service';
import {
  AuthorizeRecurringAssignmentsDto,
  RecurringAuthorizationQueryDto,
} from './dto/recurring-authorization.dto';

@Controller('operations/recurring-authorizations')
@RequiresActivePlan()
export class RecurringAuthorizationController {
  constructor(private readonly service: RecurringAuthorizationService) {}
  @Get()
  @Capabilities('operations.read')
  @Permissions('operations.assign')
  list(
    @Req() request: IdentityRequest,
    @Query() query: RecurringAuthorizationQueryDto,
  ) {
    return this.service.list(this.actor(request), query);
  }
  @Post()
  @Capabilities('operations.manage')
  @Permissions('operations.assign')
  authorize(
    @Req() request: IdentityRequest,
    @Body() input: AuthorizeRecurringAssignmentsDto,
  ) {
    return this.service.authorize(this.actor(request), input.items);
  }
  private actor(request: IdentityRequest) {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    return {
      id: identity.id,
      organizationId: identity.organizationId,
      businessUnitIds: identity.businessUnitIds,
    };
  }
}
