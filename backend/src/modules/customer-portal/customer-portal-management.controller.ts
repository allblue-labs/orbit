import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPublicErrors } from '../../common/public-errors';
import { Permissions } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { Capabilities } from '../subscription-plans/plan-access';
import { InviteCustomerPortalIdentityDto } from './customer-portal.dto';
import type { CustomerPortalInvitationReadModel } from './customer-portal.read-models';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalInvitationSchema } from './customer-portal.openapi';

@ApiTags('Customer Portal Management')
@ApiPublicErrors()
@Controller({ path: 'customers/:customerId/portal', version: '1' })
export class CustomerPortalManagementController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Post('invitations')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @ApiBody({ type: InviteCustomerPortalIdentityDto })
  @ApiCreatedResponse({ type: CustomerPortalInvitationSchema })
  invite(
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Req() request: IdentityRequest,
    @Body() input: InviteCustomerPortalIdentityDto,
  ): Promise<CustomerPortalInvitationReadModel> {
    return this.portal.invite(customerId, request, input);
  }

  @Post('identities/:identityId/disable')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  disable(
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Param('identityId', ParseUUIDv7Pipe) identityId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.portal.disable(customerId, identityId, request);
  }

  @Post('identities/:identityId/revoke-sessions')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @ApiOkResponse()
  revokeSessions(
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Param('identityId', ParseUUIDv7Pipe) identityId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.portal.revokeSessions(customerId, identityId, request);
  }
}
