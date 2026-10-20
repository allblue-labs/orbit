/**
 * A assinatura profissional, pela Web.
 *
 * ## Por que existe um segundo controller
 *
 * O aggregate, as regras e o serviço são os mesmos da PR-27: `UserSignature`,
 * versionada, com upload conferido byte a byte. O que faltava era **porta**.
 * As rotas existentes moram sob `mobile/field`, e o BFF da Web encaminha por
 * prefixo de controller — pedir ao navegador que chame `mobile/field/me/...`
 * exigiria abrir a superfície inteira do aplicativo de campo para a Web, o que
 * é muito mais do que se quer, e diria a coisa errada sobre a quem a rota
 * pertence.
 *
 * O controller mora ao lado do serviço que ele delega, e não no módulo de
 * identidade: o caminho da URL diz a quem a rota pertence do ponto de vista de
 * quem a usa; a fiação diz de quem é o código. Misturar os dois criaria uma
 * dependência entre módulos para não ganhar nada.
 *
 * Aqui não há regra nova. Nem uma. A assinatura continua exigindo perfil
 * profissional ativo, continua criando versão em vez de sobrescrever, e a
 * recusa continua vindo do mesmo lugar.
 *
 * ## Isto não é assinatura qualificada
 *
 * O que se cadastra é a **representação gráfica** da assinatura da pessoa.
 * Nada aqui é ICP-Brasil, certificado digital ou assinatura qualificada, e
 * nenhum texto do produto deve sugerir que seja.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiPublicErrors } from '../../common/public-errors';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import type { MobileFieldActor } from './mobile-field.service';
import { PROFILE_PREVIEW_PATH } from './mobile-signature.service';
import {
  MobileSignaturePreviewQueryDto,
  MobileSignatureUploadDto,
  MobileSignatureUploadReservationDto,
} from './mobile-signature.dto';
import { MobileSignatureService } from './mobile-signature.service';

@ApiTags('Identity Profile')
@ApiPublicErrors()
@Controller('identity/me/signature')
export class ProfessionalSignatureController {
  constructor(private readonly signatures: MobileSignatureService) {}

  @Get()
  @ApiOperation({ summary: 'Situação da própria assinatura profissional' })
  status(@Req() request: IdentityRequest) {
    /* A prévia tem de apontar para a rota daqui, e não para a do aplicativo
       de campo: é este o caminho que o proxy da Web encaminha. */
    return this.signatures.status(this.actor(request), PROFILE_PREVIEW_PATH);
  }

  /**
   * A prévia da assinatura, pelo caminho do perfil.
   *
   * O `status` já devolve uma URL assinada, mas ela aponta para
   * `/mobile/field/…` — e o proxy do web não encaminha esse prefixo, de
   * propósito: é a superfície do aplicativo de campo. Sem esta rota, a tela de
   * perfil recebia o endereço da prévia e não conseguia alcançá-lo, então
   * mostrava "assinatura cadastrada" e nenhuma imagem.
   *
   * Mesma checagem do outro caminho: a concessão é assinada e expira, e os
   * bytes são conferidos contra o hash antes de sair.
   */
  @Get('preview')
  @ApiOperation({ summary: 'Lê a prévia temporária da própria assinatura' })
  async preview(
    @Req() request: IdentityRequest,
    @Query() query: MobileSignaturePreviewQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const preview = await this.signatures.previewBytes(
      this.actor(request),
      query,
    );
    response.setHeader('Content-Type', preview.mimeType);
    response.setHeader('Content-Length', String(preview.body.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=0, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(preview.body);
  }

  @Post('uploads')
  @ApiOperation({ summary: 'Reserva o envio de uma nova assinatura' })
  reserve(
    @Req() request: IdentityRequest,
    @Body() input: MobileSignatureUploadReservationDto,
  ) {
    return this.signatures.reserveUpload(this.actor(request), input);
  }

  @Post()
  @ApiOperation({ summary: 'Ativa uma nova versão da assinatura' })
  activate(
    @Req() request: IdentityRequest,
    @Body() input: MobileSignatureUploadDto,
  ) {
    /* Mesmo caminho do `status`: a prévia que volta daqui é pedida pelo
       navegador, pelo proxy da Web. */
    return this.signatures.upload(
      this.actor(request),
      input,
      PROFILE_PREVIEW_PATH,
    );
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoga a assinatura ativa' })
  revoke(@Req() request: IdentityRequest) {
    return this.signatures.revoke(this.actor(request));
  }

  private actor(request: IdentityRequest): MobileFieldActor {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Contexto de organização obrigatório');
    return {
      id: identity.id,
      organizationId: identity.organizationId,
      businessUnitIds: identity.businessUnitIds,
      permissions: identity.permissions,
      isOrganizationOwner: identity.isOrganizationOwner,
    };
  }
}
