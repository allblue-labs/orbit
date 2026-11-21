import {
  Body,
  Controller,
  Get,
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
import { MobileManagement } from '../../common/mobile-management';
import { ApiPublicErrors } from '../../common/public-errors';
import { Permissions } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { Capabilities } from '../subscription-plans/plan-access';
import {
  CreateCustomerPortalAccessDto,
  InviteCustomerPortalIdentityDto,
} from './customer-portal.dto';
import type {
  CustomerPortalAccessCredentialsReadModel,
  CustomerPortalAccessReadModel,
  CustomerPortalInvitationReadModel,
} from './customer-portal.read-models';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalInvitationSchema } from './customer-portal.openapi';

@ApiTags('Customer Portal Management')
@ApiPublicErrors()
@Controller({ path: 'customers/:customerId/portal', version: '1' })
export class CustomerPortalManagementController {
  constructor(private readonly portal: CustomerPortalService) {}

  /*
   * O acesso do cliente, como o owner cria e mantém.
   *
   * `@MobileManagement('customers')`: a ficha do cliente no app do owner faz o
   * mesmo que a página do cliente na web. A permissão de escrita continua sendo
   * `customers.update`, conferida pelo guard de permissões nos dois lados.
   */
  @Get('access')
  @MobileManagement('customers')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @ApiOkResponse()
  access(
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Req() request: IdentityRequest,
  ): Promise<CustomerPortalAccessReadModel> {
    return this.portal.access(customerId, request);
  }

  @Post('access')
  @MobileManagement('customers')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @ApiBody({ type: CreateCustomerPortalAccessDto })
  @ApiCreatedResponse()
  createAccess(
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Req() request: IdentityRequest,
    @Body() input: CreateCustomerPortalAccessDto,
  ): Promise<CustomerPortalAccessCredentialsReadModel> {
    return this.portal.createAccess(customerId, request, input);
  }

  @Post('identities/:identityId/password')
  @MobileManagement('customers')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  resetAccessPassword(
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Param('identityId', ParseUUIDv7Pipe) identityId: string,
    @Req() request: IdentityRequest,
  ): Promise<CustomerPortalAccessCredentialsReadModel> {
    return this.portal.resetAccessPassword(customerId, identityId, request);
  }

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
  @MobileManagement('customers')
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
