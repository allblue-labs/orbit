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
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ForbiddenException } from '../../exceptions';
import { Surfaces } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { RequiresActivePlan } from '../subscription-plans/plan-access';
import type { MobileFieldActor } from './mobile-field.service';
import {
  CustomerAcknowledgementInputDto,
  MobileSignaturePreviewQueryDto,
  MobileSignatureUploadDto,
  MobileSignatureUploadReservationDto,
} from './mobile-signature.dto';
import {
  MOBILE_PREVIEW_PATH,
  MobileSignatureService,
} from './mobile-signature.service';

@ApiTags('Mobile Field Signatures')
@Controller('mobile/field')
@Surfaces('MOBILE')
@RequiresActivePlan()
export class MobileSignatureController {
  constructor(private readonly service: MobileSignatureService) {}

  @Get('me/signature')
  @ApiOperation({
    summary: 'Consulta a disponibilidade da própria assinatura profissional',
  })
  status(@Req() request: IdentityRequest) {
    /* Caminho do aplicativo de campo: e ele que serve esta prévia. */
    return this.service.status(this.actor(request), MOBILE_PREVIEW_PATH);
  }

  @Get('me/signature/preview')
  @ApiOperation({ summary: 'Lê a prévia temporária da própria assinatura' })
  async preview(
    @Req() request: IdentityRequest,
    @Query() query: MobileSignaturePreviewQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const preview = await this.service.previewBytes(this.actor(request), query);
    response.setHeader('Content-Type', preview.mimeType);
    response.setHeader('Content-Length', String(preview.body.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=0, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(preview.body);
  }

  @Post('me/signature')
  @ApiOperation({
    summary: 'Ativa uma nova versão da própria assinatura profissional',
  })
  upload(
    @Req() request: IdentityRequest,
    @Body() input: MobileSignatureUploadDto,
  ) {
    return this.service.upload(this.actor(request), input, MOBILE_PREVIEW_PATH);
  }

  @Post('me/signature/uploads')
  @ApiOperation({
    summary: 'Reserva uma URL assinada para upload da própria assinatura',
  })
  reserveUpload(
    @Req() request: IdentityRequest,
    @Body() input: MobileSignatureUploadReservationDto,
  ) {
    return this.service.reserveUpload(this.actor(request), input);
  }

  @Delete('me/signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoga a própria assinatura profissional ativa' })
  revoke(@Req() request: IdentityRequest) {
    return this.service.revoke(this.actor(request));
  }

  @Get('operations/:operationId/customer-acknowledgement/preparation')
  @ApiOperation({
    summary: 'Congela o resumo que será reconhecido pelo cliente',
  })
  preparation(
    @Req() request: IdentityRequest,
    @Param('operationId', ParseUUIDv7Pipe) id: string,
  ) {
    return this.service.acknowledgementPreparation(this.actor(request), id);
  }

  @Post('operations/:operationId/customer-acknowledgement')
  @ApiOperation({
    summary: 'Registra aceite opcional e idempotente do cliente',
  })
  acknowledge(
    @Req() request: IdentityRequest,
    @Param('operationId', ParseUUIDv7Pipe) id: string,
    @Body() input: CustomerAcknowledgementInputDto,
  ) {
    return this.service.acknowledge(this.actor(request), id, input);
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
