import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPublicErrors } from '../../../common/public-errors';
import { Permissions, Public } from '../../../decorators';
import { ForbiddenException } from '../../../exceptions';
import { InvitationService } from '../application/invitation.service';
import type { IdentityRequest } from '../infrastructure/jwt-authentication.guard';
import { PaginationHelper } from '../../../database/helpers/database.helpers';
import { ParseUUIDv7Pipe } from '../../../pipes';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationQueryDto,
} from './dto/identity.dto';
import { InvitationReadModels } from './invitation.read-models';

@ApiTags('Identity Invitations')
@ApiPublicErrors()
@Controller('identity/invitations')
export class InvitationController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly readModels: InvitationReadModels,
  ) {}

  /**
   * Convites da organização.
   *
   * Leitura do mesmo escopo de `GET /organizations/current`: quem administra a
   * organização precisa ver quem foi convidado, por quem e até quando o convite
   * vale. O **token nunca aparece** — ver `InvitationReadModels`.
   */
  @Get()
  @Permissions('identity.invitations.create')
  async list(
    @Req() request: IdentityRequest,
    @Query() query: InvitationQueryDto,
  ) {
    const { data, total } = await this.invitations.list(
      this.organizationId(request),
      query,
    );
    return PaginationHelper.result(
      data.map((invitation) => this.readModels.item(invitation)),
      total,
      { page: query.page, limit: query.limit },
    );
  }

  @Post()
  @Permissions('identity.invitations.create')
  create(@Body() input: CreateInvitationDto, @Req() request: IdentityRequest) {
    const identity = request.identity!;
    if (!identity.organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return this.invitations.create({
      organizationId: identity.organizationId,
      businessUnitId: input.businessUnitId,
      roleId: input.roleId,
      invitedById: identity.id,
      email: input.email,
      actorPermissions: identity.permissions,
      actorSurfaces: identity.allowedSurfaces,
      actorUnitIds: identity.businessUnitIds,
      isOrganizationOwner: identity.isOrganizationOwner,
    });
  }

  /**
   * Reenvia um convite pendente.
   *
   * Gera token novo: o link anterior deixa de valer.
   */
  @Post(':id/resend')
  @Permissions('identity.invitations.create')
  resend(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.invitations.resend(id, this.organizationId(request));
  }

  /** Cancela um convite pendente. O registro permanece como `REVOKED`. */
  @Delete(':id')
  @Permissions('identity.invitations.create')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.invitations.revoke(id, this.organizationId(request));
  }

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(@Body() input: AcceptInvitationDto) {
    return this.invitations.accept(input);
  }

  private organizationId(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }
}
