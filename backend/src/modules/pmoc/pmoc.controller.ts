/**
 * API do domínio PMOC — `/api/v1/pmoc`.
 *
 * ## Capabilities próprias
 *
 * `pmoc.read` / `pmoc.manage`. Acesso a equipamento **não** dá acesso a PMOC: o
 * plano diz o que a empresa se comprometeu a manter e para quem, e isso é
 * informação contratual — quem cadastra um ar-condicionado não passa a ver os
 * contratos de manutenção da carteira.
 *
 * ## E elas não substituem as dos outros domínios
 *
 * Gerar a ordem de serviço de um ciclo exige também `operations.create`;
 * vincular a evidência exige `artifact_executions.read`. Os guardas de rota
 * conferem o PMOC; o serviço confere o resto — um módulo que integra outros é
 * exatamente onde as autorizações se perdem, se cada uma não for conferida no
 * seu lugar.
 */
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
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  AddPmocCoverageDto,
  AddPmocEquipmentEvidenceDto,
  CompletePmocEquipmentExecutionDto,
  GeneratePmocEquipmentArtifactDto,
  CompletePmocExecutionDto,
  CreatePmocOperationDto,
  CreatePmocPlanDto,
  CreatePmocUnitDto,
  PmocCodeSuggestionQueryDto,
  PreviewPmocPlanDto,
  LinkPmocEvidenceDto,
  PmocAnalyticsQueryDto,
  PmocCoveragePageQueryDto,
  PmocPlanQueryDto,
  PmocTimelineQueryDto,
  PmocUpcomingQueryDto,
  StartPmocEquipmentExecutionDto,
  UpdatePmocPlanDto,
  UpdatePmocUnitDto,
} from './pmoc.dto';
import { PmocService, type PmocActor } from './pmoc.service';

@ApiTags('PMOC')
@Controller('pmoc')
@RequiresActivePlan()
export class PmocController {
  constructor(private readonly pmoc: PmocService) {}

  /* ---------------------------------------------------------------- */
  /* Conformidade — antes de `:id`, senão a rota vira um identificador  */
  /* ---------------------------------------------------------------- */

  @Get('compliance')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Compliance counters, computed by the server' })
  compliance(
    @Req() request: IdentityRequest,
    @Query() query: PmocAnalyticsQueryDto,
  ) {
    return this.pmoc.compliance(this.actor(request), query);
  }

  @Get('upcoming')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Maintenances due within a window' })
  upcoming(
    @Req() request: IdentityRequest,
    @Query() query: PmocUpcomingQueryDto,
  ) {
    return this.pmoc.upcoming(this.actor(request), query);
  }

  /* ---------------------------------------------------------------- */
  /* Planos                                                            */
  /* ---------------------------------------------------------------- */

  @Get('plans')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'PMOC plans, ordered by next due date' })
  list(@Req() request: IdentityRequest, @Query() query: PmocPlanQueryDto) {
    return this.pmoc.list(this.actor(request), query);
  }

  @Post('plans')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Create a plan; it starts as DRAFT' })
  create(@Req() request: IdentityRequest, @Body() input: CreatePmocPlanDto) {
    return this.pmoc.create(this.actor(request), input);
  }

  /**
   * Nomes sugeridos para um plano.
   *
   * Catálogo da plataforma, igual para todo inquilino — por isso exige só
   * leitura de PMOC, e não `pmoc.manage`: quem consulta a lista ainda não
   * está criando nada.
   */
  /* ---------------------------------------------------------------- */
  /* Unidades                                                          */
  /* ---------------------------------------------------------------- */

  @Get('units')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Unidades do sistema, com o roteiro de cada uma' })
  units(
    @Req() request: IdentityRequest,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.pmoc.listUnits(this.actor(request), includeInactive !== 'true');
  }

  @Post('units')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Cadastra uma unidade' })
  createUnit(
    @Req() request: IdentityRequest,
    @Body() input: CreatePmocUnitDto,
  ) {
    return this.pmoc.createUnit(this.actor(request), input);
  }

  @Patch('units/:id')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Edita uma unidade' })
  updateUnit(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: UpdatePmocUnitDto,
  ) {
    return this.pmoc.updateUnit(this.actor(request), id, input);
  }

  @Delete('units/:id')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma unidade (remoção lógica)' })
  removeUnit(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.pmoc.removeUnit(this.actor(request), id);
  }

  @Get('plan-name-options')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Nomes sugeridos para um plano de PMOC' })
  planNameOptions() {
    return this.pmoc.planNameOptions();
  }

  @Get('code-suggestion')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Next PMOC code for a customer; suggestion only, nothing reserved',
  })
  codeSuggestion(
    @Req() request: IdentityRequest,
    @Query() query: PmocCodeSuggestionQueryDto,
  ) {
    return this.pmoc.codeSuggestion(this.actor(request), query.customerId);
  }

  /**
   * `POST` porque a entrada é um corpo — a lista de equipamentos não cabe numa
   * query string. **Não cria nada**: valida a configuração e devolve a matriz
   * projetada.
   */
  @Post('plans/preview')
  @HttpCode(HttpStatus.OK)
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary:
      'Project cycles and the equipment matrix without creating anything',
  })
  preview(@Req() request: IdentityRequest, @Body() input: PreviewPmocPlanDto) {
    return this.pmoc.preview(this.actor(request), input);
  }

  /**
   * O documento do plano, desenhado na hora.
   *
   * Vem antes de `plans/:id` de propósito: o Nest resolve na ordem de
   * declaração, e uma rota mais específica registrada depois nunca é alcançada.
   *
   * `pmoc.read` e não `pmoc.manage`: imprimir a configuração é leitura dela.
   * `no-store` porque o plano muda sem emitir nada — um PDF em cache mostraria
   * a cobertura de antes da última alteração, e quem arquivasse esse papel
   * arquivaria uma declaração falsa.
   */
  @Get('plans/:id/document')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'PMOC plan document (PDF) for filing and audit' })
  async document(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const documento = await this.pmoc.document(id, this.actor(request));

    response.set({
      'Content-Type': documento.mimeType,
      'Content-Disposition': `inline; filename="${documento.fileName}"`,
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(documento.bytes);
  }

  @Get('plans/:id')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Plan with coverage, compliance and cycles' })
  detail(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.get(id, this.actor(request));
  }

  @Patch('plans/:id')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Edit a plan; unit, customer and code never change',
  })
  update(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdatePmocPlanDto,
  ) {
    return this.pmoc.update(id, this.actor(request), input);
  }

  /* ---------------------------------------------------------------- */
  /* Transições                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Cada transição tem rota própria.
   *
   * Um `PATCH /plans/:id { status }` genérico permitiria escrever `EXPIRED` à
   * mão — e vencimento não é decisão de ninguém, é constatação do calendário.
   */
  /**
   * Gera o link de assinatura do contrato para o contratante.
   *
   * `pmoc.manage` porque é ato de administrar o contrato — e porque o segredo devolvido
   * abre o contrato para quem o tiver.
   *
   * Declarada antes de rotas com `:id` que possam colidir não é necessário aqui, mas o
   * `POST` tem corpo vazio de propósito: o que define o link é o plano, e dar opções ao
   * chamador (validade, destinatário) seria contrato que o produto ainda não tem.
   */
  @Post('plans/:id/signature-link')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Gera um link temporário para o contratante assinar o contrato',
  })
  createSignatureLink(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.createSignatureLink(id, this.actor(request));
  }

  @Post('plans/:id/activate')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Activate: sets the first due date and schedules it',
  })
  activate(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.activate(id, this.actor(request));
  }

  @Post('plans/:id/suspend')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Suspend: stops compliance evaluation' })
  suspend(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.suspend(id, this.actor(request));
  }

  @Post('plans/:id/cancel')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Cancel: terminal; executed cycles remain on record',
  })
  cancel(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.cancel(id, this.actor(request));
  }

  /* ---------------------------------------------------------------- */
  /* Cobertura                                                         */
  /* ---------------------------------------------------------------- */

  @Get('plans/:id/equipment')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Equipment covered by the plan' })
  coverages(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.coverages(id, this.actor(request));
  }

  @Get('plans/:id/equipment-page')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({
    summary: 'Server-side cursor page of equipment covered by the plan',
  })
  coveragesPage(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Query() query: PmocCoveragePageQueryDto,
  ) {
    return this.pmoc.coveragesPage(id, this.actor(request), query);
  }

  @Get('plans/:id/timeline')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Public PMOC V2 business timeline' })
  timeline(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Query() query: PmocTimelineQueryDto,
  ) {
    return this.pmoc.timeline(id, this.actor(request), query);
  }

  @Post('plans/:id/equipment')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Cover an equipment; duplicates are refused' })
  addCoverage(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: AddPmocCoverageDto,
  ) {
    return this.pmoc.addCoverage(id, this.actor(request), input);
  }

  @Delete('plans/:id/equipment/:coverageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Remove coverage; history of cycles remains' })
  async removeCoverage(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('coverageId', ParseUUIDv7Pipe) coverageId: string,
    @Req() request: IdentityRequest,
  ): Promise<void> {
    await this.pmoc.removeCoverage(id, coverageId, this.actor(request));
  }

  /* ---------------------------------------------------------------- */
  /* Ciclos                                                            */
  /* ---------------------------------------------------------------- */

  @Get('plans/:id/executions')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({ summary: 'Cycle history, newest first' })
  executions(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.executions(id, this.actor(request));
  }

  @Get('plans/:id/cycles/:cycleId/equipment-executions')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({
    summary: 'Equipment execution status for every covered asset in a cycle',
  })
  equipmentExecutions(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('cycleId', ParseUUIDv7Pipe) cycleId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.equipmentExecutions(id, cycleId, this.actor(request));
  }

  @Get('plans/:id/cycles/:cycleId/equipment/:assetId/execution-preparation')
  @Capabilities('pmoc.read')
  @Permissions('pmoc.read')
  @ApiOperation({
    summary: 'Authoritative PMOC execution preparation for Web and Mobile',
  })
  equipmentExecutionPreparation(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('cycleId', ParseUUIDv7Pipe) cycleId: string,
    @Param('assetId', ParseUUIDv7Pipe) assetId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.equipmentExecutionPreparation(
      id,
      cycleId,
      assetId,
      this.actor(request),
    );
  }

  @Post('plans/:id/cycles/:cycleId/equipment/:assetId/executions')
  @Capabilities('pmoc.manage', 'operations.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Start one physical execution and its 1:1 operation',
  })
  startEquipmentExecution(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('cycleId', ParseUUIDv7Pipe) cycleId: string,
    @Param('assetId', ParseUUIDv7Pipe) assetId: string,
    @Req() request: IdentityRequest,
    @Body() input: StartPmocEquipmentExecutionDto,
  ) {
    return this.pmoc.startEquipmentExecution(
      id,
      cycleId,
      assetId,
      this.actor(request),
      input,
    );
  }

  /**
   * O técnico abre **o atendimento dele**, do celular.
   *
   * Porta separada da de cima porque a autoridade é outra: aqui basta
   * `pmoc.execute`, a permissão de quem vai a campo — e o serviço exige que o
   * plano esteja atribuído ao ator e abre a execução para ele mesmo.
   *
   * A rota de gerenciar exige `pmoc.manage`, que o papel de campo não tem e não
   * deve ter: gerenciar contrato não é trabalho de quem vai à casa de máquinas.
   * Sem esta porta, o técnico não conseguia atender um PMOC nem quando o plano
   * era dele.
   */
  @Post('plans/:id/cycles/:cycleId/equipment/:assetId/executions/mine')
  @Capabilities('pmoc.manage', 'operations.manage')
  @Permissions('pmoc.execute')
  @ApiOperation({
    summary: 'Start my own physical execution (field technician)',
  })
  startMyEquipmentExecution(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('cycleId', ParseUUIDv7Pipe) cycleId: string,
    @Param('assetId', ParseUUIDv7Pipe) assetId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.pmoc.startMyEquipmentExecution(
      id,
      cycleId,
      assetId,
      this.actor(request),
    );
  }

  @Post('plans/:id/cycles/:cycleId/equipment-executions/:executionId/complete')
  @Capabilities('pmoc.manage', 'operations.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Complete one equipment; closes cycle only after all are resolved',
  })
  completeEquipmentExecution(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('cycleId', ParseUUIDv7Pipe) cycleId: string,
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: CompletePmocEquipmentExecutionDto,
  ) {
    return this.pmoc.completeEquipmentExecution(
      id,
      cycleId,
      executionId,
      this.actor(request),
      input,
    );
  }

  /**
   * O técnico conclui **a execução dele**, do celular.
   *
   * Mesma escrita da porta acima, outra autoridade: aqui basta `pmoc.execute`.
   * A restrição não mudou de lugar — continua viajando dentro do `where` do
   * claim, no repositório, e recusa quem não é o escalado mesmo que chegue por
   * esta porta. O que esta rota resolve é o portão: com `pmoc.manage`, o técnico
   * de campo **abria** o atendimento pelo celular e não conseguia concluí-lo.
   */
  @Post(
    'plans/:id/cycles/:cycleId/equipment-executions/:executionId/complete/mine',
  )
  @Capabilities('pmoc.manage', 'operations.manage')
  @Permissions('pmoc.execute')
  @ApiOperation({
    summary: 'Complete my own physical execution (field technician)',
  })
  completeMyEquipmentExecution(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('cycleId', ParseUUIDv7Pipe) cycleId: string,
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: CompletePmocEquipmentExecutionDto,
  ) {
    /*
     * Delega ao mesmo método, e isso é proposital: a regra de quem pode concluir
     * é uma só, e duplicá-la aqui criaria a segunda — a que diverge na primeira
     * mudança. O dono passa pelas duas portas, porque a permissão dele é curto-
     * circuito.
     */
    return this.pmoc.completeEquipmentExecution(
      id,
      cycleId,
      executionId,
      this.actor(request),
      input,
    );
  }

  @Post('equipment-executions/:executionId/evidence')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Attach tenant-scoped evidence to one equipment execution (max 6)',
  })
  addEquipmentEvidence(
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: AddPmocEquipmentEvidenceDto,
  ) {
    return this.pmoc.addEquipmentEvidence(
      executionId,
      this.actor(request),
      input,
    );
  }

  @Post('equipment-executions/:executionId/artifact')
  @Capabilities('pmoc.manage', 'artifact_executions.read')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Link the real PMOC artifact to one physical equipment execution',
  })
  linkEquipmentArtifact(
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: LinkPmocEvidenceDto,
  ) {
    return this.pmoc.linkEquipmentArtifact(
      executionId,
      this.actor(request),
      input,
    );
  }

  @Post('equipment-executions/:executionId/artifact/generate')
  @Capabilities('pmoc.manage', 'artifact_rendering.render')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Idempotently create and render the PMOC V2 document',
  })
  generateEquipmentArtifact(
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: GeneratePmocEquipmentArtifactDto,
  ) {
    return this.pmoc.generateEquipmentArtifact(
      executionId,
      this.actor(request),
      input,
    );
  }

  /**
   * O técnico emite o relatório **da execução dele**, do celular.
   *
   * O documento é a razão do atendimento existir: sem ele o trabalho aconteceu e
   * a prova de conformidade não. Com `pmoc.manage` nesta rota, o técnico
   * concluía a manutenção e ficava sem poder emitir — dependendo de alguém no
   * escritório para fechar o que ele acabou de fazer.
   *
   * A atribuição é conferida no serviço, contra o técnico escalado **daquela
   * execução**, e não contra o plano: o documento sai com o nome de quem assina.
   */
  @Post('equipment-executions/:executionId/artifact/generate/mine')
  @Capabilities('pmoc.manage', 'artifact_rendering.render')
  @Permissions('pmoc.execute')
  @ApiOperation({
    summary: 'Render the PMOC document of my own execution (field technician)',
  })
  generateMyEquipmentArtifact(
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: GeneratePmocEquipmentArtifactDto,
  ) {
    return this.pmoc.generateMyEquipmentArtifact(
      executionId,
      this.actor(request),
      input,
    );
  }

  @Post('plans/:id/executions/:executionId/complete')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({
    summary: 'Complete a cycle; the periodicity rolls from the performed date',
  })
  complete(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: CompletePmocExecutionDto,
  ) {
    return this.pmoc.completeExecution(
      id,
      executionId,
      this.actor(request),
      input,
    );
  }

  /** Exige também `operations.create` — conferido no serviço. */
  @Post('plans/:id/executions/:executionId/operation')
  @Capabilities('pmoc.manage', 'operations.manage')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Generate the work order for a cycle; idempotent' })
  createOperation(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: CreatePmocOperationDto,
  ) {
    return this.pmoc.createOperation(
      id,
      executionId,
      this.actor(request),
      input,
    );
  }

  /** Exige também `artifact_executions.read` — conferido no serviço. */
  @Post('plans/:id/executions/:executionId/evidence')
  @Capabilities('pmoc.manage', 'artifact_executions.read')
  @Permissions('pmoc.manage')
  @ApiOperation({ summary: 'Link a real PMOC artifact execution as evidence' })
  linkEvidence(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @Req() request: IdentityRequest,
    @Body() input: LinkPmocEvidenceDto,
  ) {
    return this.pmoc.linkEvidence(id, executionId, this.actor(request), input);
  }

  private actor(request: IdentityRequest): PmocActor {
    const organizationId = request.identity?.organizationId;
    const actorId = request.identity?.id;
    if (!organizationId || !actorId) {
      throw new ForbiddenException('Organization context is required');
    }
    return {
      organizationId,
      actorId,
      permissions: request.identity?.permissions ?? [],
      businessUnitIds: request.identity?.businessUnitIds ?? [],
      isOrganizationOwner: request.identity?.isOrganizationOwner ?? false,
    };
  }
}
