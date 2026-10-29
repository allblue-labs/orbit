import { Body, Controller, Post, Req } from '@nestjs/common';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { CheckOperationScheduleDto } from './dto/operation-schedule.dto';
import { OperationScheduleService } from './operation-schedule.service';
@Controller('operations')
@RequiresActivePlan()
export class OperationScheduleController {
  constructor(private readonly schedule: OperationScheduleService) {}
  @Post('schedule-check')
  @Capabilities('operations.read')
  @Permissions('operations.read')
  check(
    @Req() request: IdentityRequest,
    @Body() input: CheckOperationScheduleDto,
  ) {
    if (!request.identity?.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    return this.schedule.check(request.identity.organizationId, input);
  }
}
