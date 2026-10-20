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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions, Surfaces } from '../../decorators';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { RequiresActivePlan } from '../subscription-plans/plan-access';
import {
  CreateOrganizationDto,
  CreateRoleDto,
  MemberQueryDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
  UpdateOrganizationLogoDto,
  UpdateRoleDto,
} from './dto/organization.dto';
import { OrganizationService } from './organization.service';
import { OrganizationReadModelMapper } from './organization.mapper';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly readModels: OrganizationReadModelMapper,
  ) {}

  @Post()
  async create(
    @Req() request: IdentityRequest,
    @Body() input: CreateOrganizationDto,
  ) {
    return this.readModels.context(
      await this.organizations.create(request.identity!.id, input),
    );
  }

  @Get('current')
  @Surfaces('WEB', 'MOBILE', 'API')
  @RequiresActivePlan()
  async getCurrent(@Req() request: IdentityRequest) {
    return this.readModels.context(
      await this.organizations.getCurrent(this.organizationId(request)),
    );
  }

  /**
   * Membros da organização.
   *
   * Existe porque atribuir e reatribuir trabalho exige conhecer as pessoas:
   * `POST /operations/:id/assignments` recebe um `userId` que, até aqui,
   * nenhuma rota publicava. É leitura pura, do mesmo escopo de
   * `GET /organizations/current`, e por isso segue a mesma autorização.
   */
  @Get('current/members')
  @RequiresActivePlan()
  async members(
    @Req() request: IdentityRequest,
    @Query() query: MemberQueryDto,
  ) {
    const { members, unitMemberships, total, ownerUserId } =
      await this.organizations.listMembers(this.organizationId(request), {
        page: query.page,
        limit: query.limit,
      });
    return PaginationHelper.result(
      this.readModels.members(members, ownerUserId, unitMemberships),
      total,
      { page: query.page, limit: query.limit },
    );
  }

  /**
   * Um membro.
   *
   * A página de detalhe precisa de uma pessoa, e não da lista. Antes a tela
   * recebia o objeto da listagem — o que só funciona num painel aberto a partir
   * dela: endereço guardado, recarregar ou abrir em outra aba não tinham de onde
   * buscar.
   *
   * Mesma autorização e mesmo Read Model da listagem: é a mesma leitura, de uma
   * linha só.
   */
  @Get('current/members/:userId')
  @RequiresActivePlan()
  async member(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
  ) {
    const { member, unitMemberships, ownerUserId } =
      await this.organizations.getMember(this.organizationId(request), userId);

    const [readModel] = this.readModels.members(
      [member],
      ownerUserId,
      unitMemberships,
    );
    return readModel;
  }

  /**
   * Altera papel e situação de um membro.
   *
   * Só isso: nome, e-mail e avatar são do **perfil**, que cada pessoa
   * administra em `identity/me`. Um gestor não edita a identidade de outro.
   */
  @Patch('current/members/:userId')
  @RequiresActivePlan()
  @Permissions('organization.members.update')
  async updateMember(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateMemberDto,
  ) {
    const { member, ownerUserId, unitMemberships } =
      await this.organizations.updateMember(
        this.organizationId(request),
        userId,
        input,
        request.identity!,
      );
    return this.readModels.member(
      member,
      ownerUserId,
      unitMemberships.map((item) => item.businessUnit),
    );
  }

  /**
   * Papéis disponíveis para a organização.
   *
   * Publica o que cada papel **concede** (`permissions`), para que a interface
   * possa mostrar por que alguém pode ou não fazer algo. É leitura do mesmo
   * escopo de `GET /organizations/current`: nenhum papel é criado ou alterado
   * por aqui — o modelo tem `isSystem`, e edição de papel não existe em
   * contrato nenhum.
   */
  @Get('current/roles')
  @RequiresActivePlan()
  async roles(@Req() request: IdentityRequest) {
    return this.readModels.roles(
      await this.organizations.listRoles(this.organizationId(request)),
    );
  }

  @Get('current/access-catalog')
  @RequiresActivePlan()
  @Permissions('organization.members.update')
  accessCatalog() {
    return this.organizations.accessCatalog();
  }

  @Post('current/roles')
  @RequiresActivePlan()
  @Permissions('organization.roles.manage')
  async createRole(
    @Req() request: IdentityRequest,
    @Body() input: CreateRoleDto,
  ) {
    return this.readModels.role(
      await this.organizations.createRole(
        this.organizationId(request),
        input,
        request.identity!,
      ),
    );
  }

  @Patch('current/roles/:id')
  @RequiresActivePlan()
  @Permissions('organization.roles.manage')
  async updateRole(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateRoleDto,
  ) {
    return this.readModels.role(
      await this.organizations.updateRole(
        id,
        this.organizationId(request),
        input,
        request.identity!,
      ),
    );
  }

  @Delete('current/roles/:id')
  @RequiresActivePlan()
  @Permissions('organization.roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRole(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.organizations.removeRole(id, this.organizationId(request));
  }

  @Patch('current')
  @RequiresActivePlan()
  @Permissions('organization.update')
  async updateCurrent(
    @Req() request: IdentityRequest,
    @Body() input: UpdateOrganizationDto,
  ) {
    return this.readModels.context(
      await this.organizations.update(this.organizationId(request), input),
    );
  }

  /**
   * A marca que timbra os documentos da empresa.
   *
   * ## Recurso separado de `current`
   *
   * `GET current` é pedido em toda navegação e publica só `hasLogo`. A imagem
   * chega a meio megabyte e se pede aqui, por quem vai desenhá-la — na prática,
   * o painel de configurações.
   *
   * Leitura com a mesma autorização de `GET current`: é a marca da própria
   * empresa, visível a quem já vê o nome dela. Escrita exige
   * `organization.update`, porque trocar o timbre muda todo documento emitido
   * daqui em diante, inclusive os que forem reimpressos.
   */
  @Get('current/logo')
  @Surfaces('WEB', 'MOBILE', 'API')
  @RequiresActivePlan()
  async getLogo(@Req() request: IdentityRequest) {
    return this.organizations.getLogo(this.organizationId(request));
  }

  /** `PUT` e não `PATCH`: o recurso é a imagem inteira, substituída de uma vez. */
  @Put('current/logo')
  @RequiresActivePlan()
  @Permissions('organization.update')
  async setLogo(
    @Req() request: IdentityRequest,
    @Body() input: UpdateOrganizationLogoDto,
  ) {
    return this.organizations.setLogo(
      this.organizationId(request),
      input.image,
    );
  }

  @Delete('current/logo')
  @RequiresActivePlan()
  @Permissions('organization.update')
  async removeLogo(@Req() request: IdentityRequest) {
    return this.organizations.removeLogo(this.organizationId(request));
  }

  private organizationId(request: IdentityRequest): string {
    const organizationId = request.identity?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }
}
