/**
 * API da renderização (Stage 6).
 *
 * ```
 * POST /artifact-executions/:id/render     solicita  → 202 com o estado
 * GET  /artifact-executions/:id/render     consulta  → estado
 * GET  /artifact-executions/:id/preview    rascunho  → o PDF, sem persistir
 * GET  /artifact-rendering/metrics         observa   → contadores do processo
 * ```
 *
 * Listar revisões e obter URL de download já existem na PR-19
 * (`GET /artifact-executions/:id/manifests` e
 * `GET /artifact-manifests/:id/download`); repeti-los aqui criaria dois
 * caminhos para a mesma coisa.
 *
 * **O preview é a exceção que devolve arquivo.** Documento emitido mora no
 * storage e se alcança por URL assinada — é da PR-19. O rascunho não existe em
 * lugar nenhum: ele é desenhado na hora e morre na resposta. Não há objeto
 * para assinar, e persistir um só para poder assiná-lo faria o preview
 * consumir número de documento e aparecer no histórico do cliente como se algo
 * tivesse sido emitido.
 */
import {
  Body,
  Controller,
  Query,
  Res,
  StreamableFile,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  ArtifactRenderService,
  type RenderActor,
} from './artifact-render.service';
import { RequestArtifactRenderDto } from './dto/artifact-render.dto';

@ApiTags('Artifact Rendering')
@ApiBearerAuth()
@Controller()
@RequiresActivePlan()
export class ArtifactRenderController {
  constructor(private readonly rendering: ArtifactRenderService) {}

  /**
   * 202, não 201.
   *
   * Nada foi criado ainda: o trabalho foi aceito. O documento aparece quando o
   * worker termina, e o cliente descobre consultando o estado.
   */
  @Post('artifact-executions/:id/render')
  @HttpCode(HttpStatus.ACCEPTED)
  @Capabilities('artifact_rendering.render')
  @Permissions('artifact_rendering.render')
  @ApiOperation({ summary: 'Queue a rendering; returns immediately' })
  request(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: RequestArtifactRenderDto,
  ) {
    return this.rendering.request(id, this.actor(request), input);
  }

  /**
   * O rascunho, para ver antes de emitir.
   *
   * Devolve os bytes do PDF **inline**: o navegador abre no lugar de baixar, e
   * é isso que faz o preview parecer preview. `Content-Disposition: inline`
   * com nome de arquivo mesmo assim, para quem escolher salvar.
   *
   * `no-store` porque o rascunho muda a cada resposta preenchida — um preview
   * em cache mostraria o formulário de dez minutos atrás e quem olhasse
   * concluiria que a edição não salvou.
   *
   * Exige `artifact_executions.read`, e não `artifact_rendering.render`: ver
   * como está ficando não emite nada.
   */
  @Get('artifact-executions/:id/preview')
  @Capabilities('artifact_executions.read')
  @Permissions('artifact_executions.read')
  @ApiOperation({ summary: 'Draft document for review; nothing is persisted' })
  async preview(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
    @Query('renderer') renderer?: string,
  ): Promise<StreamableFile> {
    const rascunho = await this.rendering.preview(
      id,
      this.actor(request),
      renderer,
    );

    response.set({
      'Content-Type': rascunho.mimeType,
      'Content-Disposition': `inline; filename="${rascunho.fileName}"`,
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(rascunho.bytes);
  }

  /**
   * A amostra de um modelo, com o timbre da organização e dados fictícios.
   *
   * ## Por que não pede `artifact_executions.read`
   *
   * Quem escolhe modelo administra modelos — a capability é
   * `artifact_templates.read`, a mesma da tela que abre esta amostra. Nada de
   * execução é lido: não há execução nenhuma envolvida.
   *
   * `no-store` porque a logo e o timbre mudam quando a organização os troca, e
   * uma amostra em cache mostraria a marca antiga justamente para quem acabou de
   * subir a nova.
   */
  @Get('artifact-rendering/samples/:artifactType')
  @Capabilities('artifact_templates.read')
  @Permissions('artifact_templates.read')
  @ApiOperation({ summary: 'Sample document for a premium model' })
  async sample(
    @Param('artifactType') artifactType: string,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const amostra = await this.rendering.sample(
      artifactType,
      this.actor(request),
    );

    response.set({
      'Content-Type': amostra.mimeType,
      'Content-Disposition': `inline; filename="${amostra.fileName}"`,
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(amostra.bytes);
  }

  @Get('artifact-executions/:id/render')
  @Capabilities('artifact_executions.read')
  @Permissions('artifact_executions.read')
  @ApiOperation({ summary: 'Read the rendering state of an execution' })
  status(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.rendering.status(id, this.actor(request));
  }

  /**
   * Contadores do processo.
   *
   * Exige sessão e plano ativo como qualquer outra rota — número de operação é
   * informação de negócio, não dado público.
   */
  @Get('artifact-rendering/metrics')
  @Capabilities('artifact_executions.read')
  @Permissions('artifact_executions.read')
  @ApiOperation({ summary: 'In-process rendering counters and renderers' })
  metrics(@Req() request: IdentityRequest) {
    this.actor(request);
    return this.rendering.metricsSnapshot();
  }

  private actor(request: IdentityRequest): RenderActor {
    const organizationId = request.identity?.organizationId;
    const actorId = request.identity?.id;
    if (!organizationId || !actorId) {
      throw new ForbiddenException('Organization context is required');
    }
    return { organizationId, actorId };
  }
}
