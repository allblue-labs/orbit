import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../../decorators';
import { ForbiddenException } from '../../../exceptions';
import { ParseUUIDv7Pipe } from '../../../pipes';
import type { IdentityRequest } from '../../identity/infrastructure/jwt-authentication.guard';
import { RequiresActivePlan } from '../../subscription-plans/plan-access';
import { OrganizationReadModelMapper } from '../organization.mapper';
import { CreateTeamMemberDto, UpdateTeamMemberDto } from './team.dto';
import { TeamService, type TeamActor } from './team.service';

/**
 * Cadastro de pessoas da organização.
 *
 * Vive ao lado de `GET /organizations/current/members`, que continua sendo a
 * leitura. O que chega aqui é o que **cria e desfaz** acesso, e por isso exige
 * `organization.members.update` — a mesma autorização de trocar o papel de
 * alguém, que é a decisão de mesma gravidade.
 */
@ApiTags('Organizations')
@Controller('organizations/current/team')
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly readModels: OrganizationReadModelMapper,
  ) {}

  @Post('members')
  @RequiresActivePlan()
  @Permissions('organization.members.update')
  @ApiOperation({
    summary:
      'Cadastra alguém da equipe e devolve a senha temporária — uma única vez',
  })
  async create(
    @Req() request: IdentityRequest,
    @Body() input: CreateTeamMemberDto,
  ) {
    const actor = this.actor(request);
    const { member, temporaryPassword, unitMemberships } =
      await this.team.createMember(actor, input);
    return {
      member: this.readModels.member(
        member,
        '',
        unitMemberships.map((item) => item.businessUnit),
      ),
      /**
       * A senha em texto claro sai **só aqui**.
       *
       * Não há coluna que a guarde e nenhuma outra rota a devolve: quem perder
       * esta resposta gera um link de definição de senha.
       */
      temporaryPassword,
    };
  }

  /**
   * Corrige nome e e-mail de quem foi cadastrado aqui.
   *
   * Fica ao lado de `POST members` por ser o mesmo assunto — o cadastro que a
   * organização digitou — e separada de `PATCH current/members/:userId`, que é
   * papel, situação e permissões. São autorizações de mesmo nome e decisões de
   * gravidade diferente, e um corpo só obrigaria a pedir a maior para fazer a
   * menor.
   */
  @Patch('members/:userId')
  @RequiresActivePlan()
  @Permissions('organization.members.update')
  @ApiOperation({
    summary: 'Corrige nome e e-mail de alguém cadastrado pela organização',
  })
  async update(
    @Req() request: IdentityRequest,
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Body() input: UpdateTeamMemberDto,
  ) {
    const { member, ownerUserId, unitMemberships } =
      await this.team.updateMemberIdentity(this.actor(request), userId, input);
    return this.readModels.member(
      member,
      ownerUserId,
      unitMemberships.map((item) => item.businessUnit),
    );
  }

  @Post('members/:userId/password-link')
  @RequiresActivePlan()
  @Permissions('organization.members.update')
  @ApiOperation({
    summary: 'Gera um link de definição de senha para um membro da equipe',
  })
  async passwordLink(
    @Req() request: IdentityRequest,
    @Param('userId', ParseUUIDv7Pipe) userId: string,
  ) {
    const { link, expiresAt, emailSent, member } =
      await this.team.issuePasswordLink(this.actor(request), userId);
    return {
      link,
      expiresAt: expiresAt.toISOString(),
      /** Diz ao owner se ainda precisa repassar o link por outro canal. */
      emailSent,
      member: this.readModels.member(member, ''),
    };
  }

  @Delete('members/:userId')
  @RequiresActivePlan()
  @Permissions('organization.members.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Desliga alguém: o vínculo sai e a vaga é liberada',
  })
  async remove(
    @Req() request: IdentityRequest,
    @Param('userId', ParseUUIDv7Pipe) userId: string,
  ) {
    await this.team.removeMember(this.actor(request), userId);
  }

  private actor(request: IdentityRequest): TeamActor {
    const organizationId = request.identity?.organizationId;
    const userId = request.identity?.id;
    if (!organizationId || !userId) {
      throw new ForbiddenException('Organization context is required');
    }
    return {
      organizationId,
      userId,
      permissions: request.identity!.permissions,
      allowedSurfaces: request.identity!.allowedSurfaces,
      businessUnitIds: request.identity!.businessUnitIds,
      isOrganizationOwner: request.identity!.isOrganizationOwner,
    };
  }
}
