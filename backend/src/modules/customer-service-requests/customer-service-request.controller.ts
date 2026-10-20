import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPublicErrors } from '../../common/public-errors';
import { Permissions, Public } from '../../decorators';
import { ForbiddenException, UnauthorizedException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import {
  CustomerPortalGuard,
  type CustomerPortalRequest,
} from '../customer-portal/customer-portal.guard';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  AssignCustomerServiceRequestDto,
  ChangeCustomerServiceRequestStatusDto,
  CreateCustomerServiceRequestDto,
  CustomerServiceRequestInternalQueryDto,
  CustomerServiceRequestMessageDto,
  CustomerServiceRequestPortalQueryDto,
  ConvertCustomerServiceRequestDto,
  ExpectedVersionDto,
  TriageCustomerServiceRequestDto,
} from './customer-service-request.dto';
import { CustomerServiceRequestService } from './customer-service-request.service';
import type {
  CustomerServiceRequestDetailsReadModel,
  CustomerServiceRequestPageReadModel,
} from './customer-service-request.read-models';
import {
  CustomerServiceRequestDetailsSchema,
  CustomerServiceRequestPageSchema,
} from './customer-service-request.openapi';

@Public()
@ApiPublicErrors()
@UseGuards(CustomerPortalGuard)
@ApiBearerAuth('customer-portal')
@ApiTags('Customer Portal Service Requests')
@Controller({ path: 'portal/me/service-requests', version: '1' })
export class CustomerServiceRequestPortalController {
  constructor(private readonly requests: CustomerServiceRequestService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Abre um chamado para o Customer autenticado' })
  @ApiCreatedResponse({
    description: 'Chamado aberto ou replay idempotente',
    type: CustomerServiceRequestDetailsSchema,
  })
  create(
    @Req() request: CustomerPortalRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateCustomerServiceRequestDto,
  ): Promise<CustomerServiceRequestDetailsReadModel> {
    return this.requests.portalCreate(
      this.actor(request),
      idempotencyKey,
      input,
    );
  }

  @Get()
  @ApiOkResponse({
    description: 'Página estável de chamados próprios',
    type: CustomerServiceRequestPageSchema,
  })
  list(
    @Req() request: CustomerPortalRequest,
    @Query() query: CustomerServiceRequestPortalQueryDto,
  ): Promise<CustomerServiceRequestPageReadModel> {
    return this.requests.portalList(this.actor(request), query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CustomerServiceRequestDetailsSchema })
  @ApiNotFoundResponse({
    description: 'Ausente ou pertencente a outro Customer',
  })
  get(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ): Promise<CustomerServiceRequestDetailsReadModel> {
    return this.requests.portalGet(this.actor(request), id);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: CustomerServiceRequestDetailsSchema })
  @ApiOperation({ summary: 'Cancela chamado elegível, sem excluir histórico' })
  cancel(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: ExpectedVersionDto,
  ): Promise<CustomerServiceRequestDetailsReadModel> {
    return this.requests.portalCancel(this.actor(request), id, input);
  }

  private actor(request: CustomerPortalRequest) {
    if (!request.portalActor) throw new UnauthorizedException();
    return request.portalActor;
  }
}

@ApiTags('Customer Service Requests')
@ApiPublicErrors()
@Controller({ path: 'customer-service-requests', version: '1' })
@RequiresActivePlan()
export class CustomerServiceRequestInternalController {
  constructor(private readonly requests: CustomerServiceRequestService) {}

  @Get()
  @ApiOkResponse({ type: CustomerServiceRequestPageSchema })
  @Capabilities('customer_service_requests.read')
  @Permissions('customer_service_requests.read')
  list(
    @Req() request: IdentityRequest,
    @Query() query: CustomerServiceRequestInternalQueryDto,
  ): Promise<CustomerServiceRequestPageReadModel> {
    return this.requests.internalList(this.actor(request), query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CustomerServiceRequestDetailsSchema })
  @Capabilities('customer_service_requests.read')
  @Permissions('customer_service_requests.read')
  get(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ): Promise<CustomerServiceRequestDetailsReadModel> {
    return this.requests.internalGet(this.actor(request), id);
  }

  @Post(':id/triage')
  @ApiCreatedResponse({ type: CustomerServiceRequestDetailsSchema })
  @Capabilities('customer_service_requests.manage')
  @Permissions('customer_service_requests.manage')
  triage(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: TriageCustomerServiceRequestDto,
  ) {
    return this.requests.triage(this.actor(request), id, input);
  }

  @Post(':id/assign')
  @ApiCreatedResponse({ type: CustomerServiceRequestDetailsSchema })
  @Capabilities('customer_service_requests.manage')
  @Permissions('customer_service_requests.manage')
  assign(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: AssignCustomerServiceRequestDto,
  ) {
    return this.requests.assign(this.actor(request), id, input);
  }

  @Post(':id/status')
  @ApiCreatedResponse({ type: CustomerServiceRequestDetailsSchema })
  @Capabilities('customer_service_requests.manage')
  @Permissions('customer_service_requests.manage')
  status(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: ChangeCustomerServiceRequestStatusDto,
  ) {
    return this.requests.changeStatus(this.actor(request), id, input);
  }

  @Post(':id/public-responses')
  @ApiCreatedResponse({ type: CustomerServiceRequestDetailsSchema })
  @Capabilities('customer_service_requests.manage')
  @Permissions('customer_service_requests.manage')
  publicResponse(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: CustomerServiceRequestMessageDto,
  ) {
    return this.requests.addMessage(this.actor(request), id, input, 'PORTAL');
  }

  @Post(':id/internal-notes')
  @ApiCreatedResponse({ type: CustomerServiceRequestDetailsSchema })
  @Capabilities('customer_service_requests.manage')
  @Permissions('customer_service_requests.manage')
  internalNote(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: CustomerServiceRequestMessageDto,
  ) {
    return this.requests.addMessage(this.actor(request), id, input, 'INTERNAL');
  }

  @Post(':id/create-operation')
  @ApiCreatedResponse({ type: CustomerServiceRequestDetailsSchema })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Capabilities('customer_service_requests.manage')
  @Permissions('customer_service_requests.manage')
  convert(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ConvertCustomerServiceRequestDto,
  ) {
    return this.requests.convert(
      this.actor(request),
      id,
      idempotencyKey,
      input,
    );
  }

  private actor(request: IdentityRequest) {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return {
      actorId: identity.id,
      organizationId: identity.organizationId,
      businessUnitIds: identity.businessUnitIds,
      permissions: identity.permissions,
    };
  }
}
