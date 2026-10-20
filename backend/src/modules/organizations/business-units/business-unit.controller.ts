import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../../decorators';
import { ForbiddenException } from '../../../exceptions';
import { ParseUUIDv7Pipe } from '../../../pipes';
import type { IdentityRequest } from '../../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../../subscription-plans/plan-access';
import {
  CreateBusinessUnitDto,
  UpdateBusinessUnitDto,
  UpdateBusinessUnitLogoDto,
} from '../dto/organization.dto';
import { BusinessUnitService } from './business-unit.service';
import { OrganizationReadModelMapper } from '../organization.mapper';

@ApiTags('Business Units')
@Controller('organizations/current/business-units')
@RequiresActivePlan()
export class BusinessUnitController {
  constructor(
    private readonly businessUnits: BusinessUnitService,
    private readonly readModels: OrganizationReadModelMapper,
  ) {}

  @Get()
  @Capabilities('business_units.read')
  async list(@Req() request: IdentityRequest) {
    return (await this.businessUnits.list(this.organizationId(request))).map(
      (unit) => this.readModels.businessUnit(unit),
    );
  }

  @Post()
  @Permissions('business_units.create')
  @Capabilities('business_units.manage')
  async create(
    @Req() request: IdentityRequest,
    @Body() input: CreateBusinessUnitDto,
  ) {
    const identity = request.identity!;
    return this.readModels.businessUnit(
      await this.businessUnits.create(
        this.organizationId(request),
        identity.id,
        identity.businessUnitIds,
        input,
      ),
    );
  }

  @Patch(':id')
  @Permissions('business_units.update')
  @Capabilities('business_units.manage')
  async update(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateBusinessUnitDto,
  ) {
    return this.readModels.businessUnit(
      await this.businessUnits.update(id, this.organizationId(request), input),
    );
  }

  /**
   * A marca que timbra os documentos da unidade.
   *
   * `PUT` e não `PATCH`: o recurso é a imagem inteira, substituída de uma vez.
   * Exige `business_units.manage` — trocar o timbre muda todo documento que a
   * unidade emitir daqui em diante, inclusive os que já foram enviados a
   * clientes e forem reimpressos.
   */
  @Put(':id/logo')
  @Permissions('business_units.update')
  @Capabilities('business_units.manage')
  async setLogo(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateBusinessUnitLogoDto,
  ) {
    return this.businessUnits.setLogo(
      id,
      this.organizationId(request),
      input.image,
    );
  }

  @Delete(':id/logo')
  @Permissions('business_units.update')
  @Capabilities('business_units.manage')
  async removeLogo(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.businessUnits.removeLogo(id, this.organizationId(request));
  }

  @Delete(':id')
  @Permissions('business_units.delete')
  @Capabilities('business_units.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.businessUnits.remove(id, this.organizationId(request));
  }

  private organizationId(request: IdentityRequest): string {
    const organizationId = request.identity?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }
}
