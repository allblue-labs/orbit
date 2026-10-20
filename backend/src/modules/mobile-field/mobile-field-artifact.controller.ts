import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForbiddenException } from '../../exceptions';
import { Surfaces } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  FieldArtifactAccessQueryDto,
  FieldArtifactSourceQueryDto,
  PrepareFieldArtifactDto,
  RenderFieldArtifactDto,
} from './mobile-field-artifact.dto';
import { MobileFieldArtifactService } from './mobile-field-artifact.service';
import type { MobileFieldActor } from './mobile-field.service';

@ApiTags('Mobile Field Artifacts')
@Controller('mobile/field/artifacts')
@Surfaces('MOBILE')
@RequiresActivePlan()
export class MobileFieldArtifactController {
  constructor(private readonly service: MobileFieldArtifactService) {}

  @Get('sources/:sourceId/preparation')
  @Capabilities('artifact_rendering.render')
  @ApiOperation({ summary: 'Elegibilidade documental sem expor o template' })
  preparation(
    @Req() request: IdentityRequest,
    @Param('sourceId', ParseUUIDv7Pipe) sourceId: string,
    @Query() query: FieldArtifactSourceQueryDto,
  ) {
    return this.service.preparation(
      this.actor(request),
      query.sourceType,
      sourceId,
    );
  }

  @Post('sources/:sourceId/prepare')
  @Capabilities('artifact_rendering.render')
  @ApiOperation({
    summary: 'Congela o snapshot imutável do documento de campo',
  })
  prepare(
    @Req() request: IdentityRequest,
    @Param('sourceId', ParseUUIDv7Pipe) sourceId: string,
    @Body() input: PrepareFieldArtifactDto,
  ) {
    return this.service.freeze(this.actor(request), input.sourceType, sourceId);
  }

  @Get(':artifactId')
  @Capabilities('artifact_rendering.render')
  @ApiOperation({ summary: 'Estado público do documento de campo' })
  get(
    @Req() request: IdentityRequest,
    @Param('artifactId', ParseUUIDv7Pipe) artifactId: string,
  ) {
    return this.service.get(this.actor(request), artifactId);
  }

  @Post(':artifactId/render')
  @Capabilities('artifact_rendering.render')
  @ApiOperation({
    summary: 'Solicita renderização idempotente fora da transação',
  })
  render(
    @Req() request: IdentityRequest,
    @Param('artifactId', ParseUUIDv7Pipe) artifactId: string,
    @Body() input: RenderFieldArtifactDto,
  ) {
    return this.service.render(this.actor(request), artifactId, input);
  }

  @Get(':artifactId/access')
  @Capabilities('artifact_rendering.render')
  @ApiOperation({
    summary: 'URL temporária para preview ou download autorizado',
  })
  access(
    @Req() request: IdentityRequest,
    @Param('artifactId', ParseUUIDv7Pipe) artifactId: string,
    @Query() query: FieldArtifactAccessQueryDto,
  ) {
    return this.service.access(
      this.actor(request),
      artifactId,
      query.operation ?? 'download',
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
