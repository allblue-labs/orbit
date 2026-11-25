import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Permissions, Roles } from '../../decorators';
import { IsUUIDv7 } from '../../validators';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { TenantRecovery } from '../tenant-operations/tenant-operation.policy';
import { BillingPolicyService } from './billing-policy.service';

class TicketsQuery {
  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED'])
  status?: 'OPEN' | 'RESOLVED';

  @IsOptional()
  @IsUUIDv7()
  after?: string;
}

class TicketParams {
  @IsUUIDv7()
  id!: string;
}

class TicketResolution {
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  resolution!: string;
}

@Controller('platform-admin/billing/tickets')
@TenantRecovery('platform')
@Roles('PLATFORM_ADMIN')
@Permissions('platform.admin')
export class BillingSupportController {
  constructor(private readonly policies: BillingPolicyService) {}

  @Get()
  list(@Query() query: TicketsQuery) {
    return this.policies.listTickets(query.status ?? 'OPEN', query.after);
  }

  @Patch(':id/resolve')
  resolve(
    @Param() params: TicketParams,
    @Body() input: TicketResolution,
    @Req() request: IdentityRequest,
  ) {
    return this.policies.resolveTicket(
      params.id,
      request.identity!.id,
      input.resolution.trim(),
    );
  }
}
