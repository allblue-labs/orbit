import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPublicErrors } from '../../../../common/public-errors';
import { Permissions } from '../../../../decorators';
import { ForbiddenException } from '../../../../exceptions';
import { ParseUUIDv7Pipe } from '../../../../pipes';
import type { IdentityRequest } from '../../../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../../../subscription-plans/plan-access';
import {
  CreateContactDto,
  CreateCustomerAddressDto,
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateContactDto,
  UpdateCustomerAddressDto,
  UpdateCustomerDto,
} from './customer.dto';
import { CustomerReadModelMapper } from './customer.mapper';
import { CustomerService } from './customer.service';

@ApiTags('Customers')
@ApiPublicErrors()
@Controller('customers')
@RequiresActivePlan()
export class CustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly readModels: CustomerReadModelMapper,
  ) {}

  @Get()
  @Capabilities('crm.read')
  @Permissions('customers.read')
  async list(
    @Req() request: IdentityRequest,
    @Query() query: CustomerQueryDto,
  ) {
    return this.readModels.list(
      await this.customers.list(this.organizationId(request), query),
    );
  }

  @Get(':id')
  @Capabilities('crm.read')
  @Permissions('customers.read')
  async get(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.readModels.details(
      await this.customers.get(id, this.organizationId(request)),
    );
  }

  @Post()
  @Capabilities('crm.manage')
  @Permissions('customers.create')
  async create(
    @Req() request: IdentityRequest,
    @Body() input: CreateCustomerDto,
  ) {
    return this.readModels.details(
      await this.customers.create(this.organizationId(request), input),
    );
  }

  @Patch(':id')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  async update(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateCustomerDto,
  ) {
    return this.readModels.details(
      await this.customers.update(id, this.organizationId(request), input),
    );
  }

  @Delete(':id')
  @Capabilities('crm.manage')
  @Permissions('customers.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.customers.remove(id, this.organizationId(request));
  }

  /* ---------------------------------------------------------------- */
  /* Endereços de atendimento                                          */
  /* ---------------------------------------------------------------- */

  @Get(':id/addresses')
  @Capabilities('crm.read')
  @Permissions('customers.read')
  @ApiOperation({ summary: 'Endereços para onde o técnico vai' })
  async addresses(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Query('onlyActive') onlyActive?: string,
  ) {
    return this.readModels.addresses(
      await this.customers.listAddresses(
        id,
        this.organizationId(request),
        onlyActive === 'true',
      ),
    );
  }

  @Post(':id/addresses')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  async createAddress(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: CreateCustomerAddressDto,
  ) {
    return this.readModels.address(
      await this.customers.createAddress(
        id,
        this.organizationId(request),
        input,
      ),
    );
  }

  @Patch(':id/addresses/:addressId')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  async updateAddress(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('addressId', ParseUUIDv7Pipe) addressId: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateCustomerAddressDto,
  ) {
    return this.readModels.address(
      await this.customers.updateAddress(
        addressId,
        id,
        this.organizationId(request),
        input,
      ),
    );
  }

  @Delete(':id/addresses/:addressId')
  @Capabilities('crm.manage')
  @Permissions('customers.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAddress(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('addressId', ParseUUIDv7Pipe) addressId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.customers.removeAddress(
      addressId,
      id,
      this.organizationId(request),
    );
  }

  @Get(':id/contacts')
  @Capabilities('crm.read')
  @Permissions('contacts.read')
  async contacts(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.readModels.contacts(
      await this.customers.listContacts(id, this.organizationId(request)),
    );
  }

  @Post(':id/contacts')
  @Capabilities('crm.manage')
  @Permissions('contacts.create')
  async createContact(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: CreateContactDto,
  ) {
    return this.readModels.contact(
      await this.customers.createContact(
        id,
        this.organizationId(request),
        input,
      ),
    );
  }

  @Patch(':id/contacts/:contactId')
  @Capabilities('crm.manage')
  @Permissions('contacts.update')
  async updateContact(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('contactId', ParseUUIDv7Pipe) contactId: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateContactDto,
  ) {
    return this.readModels.contact(
      await this.customers.updateContact(
        contactId,
        id,
        this.organizationId(request),
        input,
      ),
    );
  }

  @Delete(':id/contacts/:contactId')
  @Capabilities('crm.manage')
  @Permissions('contacts.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeContact(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('contactId', ParseUUIDv7Pipe) contactId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.customers.removeContact(
      contactId,
      id,
      this.organizationId(request),
    );
  }

  private organizationId(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }
}
