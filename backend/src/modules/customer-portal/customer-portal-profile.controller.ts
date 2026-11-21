import {
  Controller,
  Delete,
  Get,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPublicErrors } from '../../common/public-errors';
import { Public } from '../../decorators';
import { UnauthorizedException } from '../../exceptions';
import { imageUploadOptions } from '../storage/image-upload.options';
import { UploadLimitsInterceptor } from '../storage/upload-limits.interceptor';
import { CustomerPortalProfileService } from './customer-portal-profile.service';
import {
  CustomerPortalGuard,
  type CustomerPortalRequest,
} from './customer-portal.guard';

/**
 * Perfil do cliente: foto e assinatura.
 *
 * `@Public()` para os guards internos e `CustomerPortalGuard` para o resto —
 * como todas as rotas do portal. Um token da equipe não passa aqui, e um token
 * de cliente não passa em nenhuma rota interna.
 */
@Public()
@ApiPublicErrors()
@UseGuards(CustomerPortalGuard)
@ApiBearerAuth('customer-portal')
@ApiTags('Customer Portal Profile')
@ApiUnauthorizedResponse({ description: 'Sessão Portal inválida ou expirada' })
@Controller({ path: 'portal/me', version: '1' })
export class CustomerPortalProfileController {
  constructor(private readonly profile: CustomerPortalProfileService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Foto e assinatura do cliente autenticado' })
  @ApiOkResponse()
  view(@Req() request: CustomerPortalRequest) {
    return this.profile.view(this.actor(request));
  }

  @Put('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    UploadLimitsInterceptor,
    FileInterceptor('file', imageUploadOptions),
  )
  @ApiOperation({ summary: 'Troca a foto do cliente' })
  setAvatar(
    @Req() request: CustomerPortalRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.profile.setAvatar(this.actor(request), file);
  }

  @Delete('avatar')
  @ApiOperation({ summary: 'Remove a foto do cliente' })
  removeAvatar(@Req() request: CustomerPortalRequest) {
    return this.profile.remove(this.actor(request), 'AVATAR');
  }

  @Put('signature')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    UploadLimitsInterceptor,
    FileInterceptor('file', imageUploadOptions),
  )
  @ApiOperation({ summary: 'Cadastra a assinatura do cliente' })
  setSignature(
    @Req() request: CustomerPortalRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.profile.setSignature(this.actor(request), file);
  }

  @Delete('signature')
  @ApiOperation({ summary: 'Remove a assinatura do cliente' })
  removeSignature(@Req() request: CustomerPortalRequest) {
    return this.profile.remove(this.actor(request), 'SIGNATURE');
  }

  private actor(request: CustomerPortalRequest) {
    if (!request.portalActor) throw new UnauthorizedException();
    return request.portalActor;
  }
}
