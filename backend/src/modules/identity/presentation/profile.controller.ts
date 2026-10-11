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
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPublicErrors } from '../../../common/public-errors';
import { Surfaces } from '../../../decorators';
import { ForbiddenException } from '../../../exceptions';
import { ParseUUIDv7Pipe } from '../../../pipes';
import { AuthenticationService } from '../application/authentication.service';
import { MfaService } from '../application/mfa.service';
import { AvatarService } from '../application/avatar.service';
import { ProfileService } from '../application/profile.service';
import type { IdentityRequest } from '../infrastructure/jwt-authentication.guard';
import { IdentityReadModelMapper } from '../identity.mapper';
import {
  ActivateAvatarDto,
  ChangePasswordDto,
  EnableMfaDto,
  ReserveAvatarUploadDto,
  UpdateProfileDto,
} from './dto/identity.dto';

@ApiTags('Identity Profile')
@ApiPublicErrors()
@Controller('identity/me')
@Surfaces('WEB', 'MOBILE', 'API')
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly authentication: AuthenticationService,
    private readonly mfa: MfaService,
    private readonly avatars: AvatarService,
    private readonly readModels: IdentityReadModelMapper,
  ) {}

  @Get()
  async get(@Req() request: IdentityRequest) {
    return this.readModels.profile(
      await this.profiles.get(
        request.identity!.id,
        request.identity!.organizationId!,
      ),
    );
  }

  /** Current server-resolved access; no token or credential material. */
  @Get('access')
  access(@Req() request: IdentityRequest) {
    const identity = request.identity!;
    return {
      isOwner: identity.isOrganizationOwner,
      roles: identity.roles,
      permissions: identity.permissions,
      surfaceAccess: identity.allowedSurfaces,
      unitIds: identity.businessUnitIds,
    };
  }

  @Patch()
  async update(
    @Req() request: IdentityRequest,
    @Body() input: UpdateProfileDto,
  ) {
    return this.readModels.profile(
      await this.profiles.update(request.identity!.id, input),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Foto de perfil                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * A foto atual, com endereço temporário.
   *
   * Separada do `GET /identity/me` de propósito: a URL assinada expira, e
   * embuti-la no perfil obrigaria a recarregar o perfil inteiro só para
   * renovar o endereço de uma imagem.
   */
  @Get('avatar')
  avatar(@Req() request: IdentityRequest) {
    return this.avatars.view(this.actor(request));
  }

  @Post('avatar/uploads')
  reserveAvatar(
    @Req() request: IdentityRequest,
    @Body() input: ReserveAvatarUploadDto,
  ) {
    return this.avatars.reserveUpload(this.actor(request), input);
  }

  @Put('avatar')
  activateAvatar(
    @Req() request: IdentityRequest,
    @Body() input: ActivateAvatarDto,
  ) {
    return this.avatars.activate(this.actor(request), input.storageObjectId);
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.OK)
  removeAvatar(@Req() request: IdentityRequest) {
    return this.avatars.remove(this.actor(request));
  }

  /**
   * Quem está pedindo, e por qual organização.
   *
   * A organização importa porque o arquivo é do inquilino: é ela que a RLS
   * exige para que a foto seja alcançável.
   */
  private actor(request: IdentityRequest): {
    id: string;
    organizationId: string;
  } {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Contexto de organização obrigatório');
    return { id: identity.id, organizationId: identity.organizationId };
  }

  /**
   * Troca da própria senha.
   *
   * Revoga as demais sessões e mantém a atual — se a senha mudou, quem estava
   * com a antiga não deve continuar dentro, mas quem acabou de trocá-la não
   * deve ser expulso da tela.
   */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Req() request: IdentityRequest,
    @Body() input: ChangePasswordDto,
  ) {
    return this.profiles.changePassword(
      request.identity!.id,
      input,
      request.identity!.sessionId,
    );
  }

  @Get('sessions')
  async sessions(@Req() request: IdentityRequest) {
    return (await this.authentication.listSessions(request.identity!.id)).map(
      (session) => this.readModels.deviceSession(session),
    );
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) sessionId: string,
  ) {
    return this.authentication.revokeSession(request.identity!.id, sessionId);
  }

  @Post('mfa/enrollment')
  beginMfa(@Req() request: IdentityRequest) {
    return this.profiles
      .email(request.identity!.id)
      .then((email) => this.mfa.beginEnrollment(request.identity!.id, email));
  }

  @Post('mfa/enable')
  enableMfa(@Req() request: IdentityRequest, @Body() input: EnableMfaDto) {
    return this.mfa.enable(request.identity!.id, input.factorId, input.code);
  }

  @Delete('mfa')
  @HttpCode(HttpStatus.NO_CONTENT)
  disableMfa(@Req() request: IdentityRequest) {
    return this.mfa.disable(request.identity!.id);
  }
}
