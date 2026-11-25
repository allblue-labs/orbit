import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  MobileManagement,
  MOBILE_MANAGEMENT_PERMISSIONS,
} from '../../common/mobile-management';
import { Permissions } from '../../decorators';
import { PaginationDto } from '../../dtos';
import { ForbiddenException, ValidationException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { CreateSaleDto, SaleProductQueryDto } from './sales.dto';
import { SalesService, type SaleActor } from './sales.service';

@Controller('sales')
@RequiresActivePlan()
@MobileManagement('sales')
@Permissions(...MOBILE_MANAGEMENT_PERMISSIONS.sales)
@Capabilities(...MOBILE_MANAGEMENT_PERMISSIONS.sales)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @Req() request: IdentityRequest,
    @Query() { page, limit }: PaginationDto,
  ) {
    return this.sales.list(this.actor(request), page, limit);
  }

  @Get('products')
  products(
    @Req() request: IdentityRequest,
    @Query() query: SaleProductQueryDto,
  ) {
    return this.sales.products(this.actor(request), query);
  }

  @Post()
  create(@Req() request: IdentityRequest, @Body() input: CreateSaleDto) {
    return this.sales.create(this.actor(request), input);
  }

  @Get(':id')
  details(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.sales.get(this.actor(request), id);
  }

  @Post(':id/receipt')
  retry(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.sales.retryReceipt(this.actor(request), id);
  }

  @Get(':id/receipt/download')
  download(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.sales.download(this.actor(request), id);
  }

  private actor(request: IdentityRequest): SaleActor {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    if (!identity.businessUnitId)
      throw new ValidationException(
        'Selecione uma unidade para registrar e consultar vendas.',
      );
    if (!identity.businessUnitIds.includes(identity.businessUnitId))
      throw new ForbiddenException(
        'A unidade selecionada não está disponível.',
      );
    return {
      organizationId: identity.organizationId,
      businessUnitId: identity.businessUnitId,
      actorId: identity.id,
      ownOnly: Boolean(
        request.mobileManagementAllowed &&
        identity.organizationRoles?.includes('FIELD_TECHNICIAN'),
      ),
    };
  }
}
