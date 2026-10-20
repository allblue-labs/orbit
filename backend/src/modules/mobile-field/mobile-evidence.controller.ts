import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForbiddenException } from '../../exceptions';
import { Surfaces } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { RequiresActivePlan } from '../subscription-plans/plan-access';
import type { MobileFieldActor } from './mobile-field.service';
import {
  CreateFieldEvidenceUploadDto,
  FinalizeFieldEvidenceUploadDto,
  ListFieldEvidenceDto,
} from './mobile-evidence.dto';
import { MobileEvidenceService } from './mobile-evidence.service';

@ApiTags('Mobile Field Evidence')
@Controller('mobile/field/evidence')
@Surfaces('MOBILE')
@RequiresActivePlan()
export class MobileEvidenceController {
  constructor(private readonly service: MobileEvidenceService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Cria intenção tenant-scoped de upload direto' })
  reserve(
    @Req() request: IdentityRequest,
    @Body() input: CreateFieldEvidenceUploadDto,
  ) {
    return this.service.reserve(this.actor(request), input);
  }

  @Post('uploads/:uploadId/finalize')
  @ApiOperation({ summary: 'Verifica o objeto real e finaliza a evidência' })
  finalize(
    @Req() request: IdentityRequest,
    @Param('uploadId', ParseUUIDv7Pipe) uploadId: string,
    @Body() input: FinalizeFieldEvidenceUploadDto,
  ) {
    return this.service.finalize(this.actor(request), uploadId, input);
  }

  @Get()
  @ApiOperation({ summary: 'Lista evidências finalizadas de um target' })
  list(@Req() request: IdentityRequest, @Query() input: ListFieldEvidenceDto) {
    return this.service.list(
      this.actor(request),
      input.targetType,
      input.targetId,
      input.limit,
    );
  }

  @Get(':evidenceId/access')
  @ApiOperation({ summary: 'Emite acesso temporário autorizado à evidência' })
  access(
    @Req() request: IdentityRequest,
    @Param('evidenceId', ParseUUIDv7Pipe) evidenceId: string,
    @Query('operation') operation?: string,
  ) {
    return this.service.access(
      this.actor(request),
      evidenceId,
      operation === 'download' ? 'download' : 'preview',
    );
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
    };
  }
}
