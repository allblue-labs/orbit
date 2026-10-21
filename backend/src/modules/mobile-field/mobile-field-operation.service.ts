/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  OperationStatus,
  type OperationStatus as OperationStatusType,
} from '../../contracts';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import { InventoryService } from '../inventory/inventory.service';
import { OperationStateMachine } from '../operations/operation-state-machine';
import type { MobileFieldActor } from './mobile-field.service';
import type {
  FieldOperationChecklistUpdateDto,
  FieldOperationCommandDto,
  FieldOperationMaterialDto,
  FieldOperationNoteDto,
  FieldOperationTimelineQueryDto,
} from './mobile-field-operation.dto';
import { MobileFieldOperationRepository } from './mobile-field-operation.repository';
import type {
  FieldOperationAllowedAction,
  FieldOperationCommandResultReadModel,
  FieldOperationExecutionPreparationReadModel,
  FieldOperationTimelineReadModel,
} from './mobile-field-operation.read-models';
import { MobileEvidenceRepository } from './mobile-evidence.repository';
import { MobileSignatureRepository } from './mobile-signature.repository';
import { formatServiceOrderNumber } from '../operations/service-order-number';

type OperationPreparation = NonNullable<
  Awaited<ReturnType<MobileFieldOperationRepository['preparation']>>
>;

@Injectable()
export class MobileFieldOperationService {
  private readonly logger = new Logger(MobileFieldOperationService.name);
  constructor(
    private readonly repository: MobileFieldOperationRepository,
    private readonly inventory: InventoryService,
    private readonly signatures: MobileSignatureRepository,
    private readonly evidence: MobileEvidenceRepository,
  ) {}

  async preparation(
    actor: MobileFieldActor,
    operationId: string,
  ): Promise<FieldOperationExecutionPreparationReadModel> {
    const started = performance.now();
    const source = await this.requireVisible(actor, operationId);
    /**
     * Quem decide se dá para anexar é a autoridade de evidências — a mesma que
     * o upload consulta.
     *
     * Antes `ADD_EVIDENCE` simplesmente **não existia** nesta lista: a etapa
     * Evidências do roteiro lia `allowedActions` para decidir se mostrava a
     * captura, e a resposta era sempre não. O passo abria sem nenhuma forma de
     * registrar foto — e, com a lista recusada por 404, só com a frase "este
     * registro não está disponível".
     *
     * Deduzir aqui com status e permissão produziria um botão que o upload
     * recusaria depois, em outra tela, depois de a pessoa ter tirado a foto.
     */
    const evidenceAuthority = await this.evidence.authorizeTarget(
      actor,
      'OPERATION',
      operationId,
    );
    const canAttachEvidence = Boolean(
      evidenceAuthority.context && !evidenceAuthority.denied,
    );
    const allowedActions = this.actions(source, actor, canAttachEvidence);
    const blockers = this.blockers(source, actor);

    /*
     * Dois caminhos para material, duas autoridades.
     *
     * Catálogo move saldo e exige `inventory.manage`; avulso não move nada e
     * exige `operations.update`. A política publicava só o primeiro, e por isso
     * respondia "não prevê registro de materiais" ao técnico que só executa.
     */
    const emAndamento = source.status === OperationStatus.IN_PROGRESS;
    const podeCatalogo = emAndamento && this.has(actor, 'inventory.manage');
    const podeAvulso = emAndamento && this.has(actor, 'operations.update');
    const materiais = await this.repository.operationMaterials(
      actor.organizationId,
      operationId,
    );
    const signatureContext = await this.signatures.context(
      actor.organizationId,
      actor.id,
    );
    const professionalSignature = {
      required: true,
      available: Boolean(signatureContext.signature),
      role: 'FIELD_TECHNICIAN' as const,
      eligible: Boolean(signatureContext.signature),
      blockedReason: signatureContext.signature
        ? null
        : ('FIELD_TECHNICIAN_SIGNATURE_MISSING' as const),
      message: signatureContext.signature
        ? null
        : 'Cadastre sua assinatura para continuar.',
    };
    const result: FieldOperationExecutionPreparationReadModel = {
      operation: {
        id: source.id,
        code: source.code,
        serviceOrderCode: formatServiceOrderNumber(source.serviceOrderNumber),
        title: source.title,
        description: source.description,
        status: source.status,
        priority: source.priority,
        scheduledFor: source.scheduledStart?.toISOString() ?? null,
        startedAt: source.startedAt?.toISOString() ?? null,
        completedAt: source.completedAt?.toISOString() ?? null,
        startedBy: source.startedBy ? this.party(source.startedBy) : null,
        completedBy: source.completedBy ? this.party(source.completedBy) : null,
      },
      customer: source.customer
        ? {
            id: source.customer.id,
            name: source.customer.tradeName ?? source.customer.legalName,
            address: source.customer.address ?? null,
            contact:
              this.has(actor, 'customers.read') && source.customer.contacts[0]
                ? { ...source.customer.contacts[0] }
                : null,
          }
        : null,
      serviceLocation: source.location ?? source.customer?.address ?? null,
      /**
       * Todos os equipamentos do atendimento.
       *
       * O campo já era uma lista e só nunca tinha mais de um item, porque a
       * ordem carregava um equipamento. O técnico em campo precisa ver os três
       * aparelhos do endereço, não o primeiro deles.
       */
      equipment: (source.assets ?? []).map((link: any) =>
        this.equipment(link.asset),
      ),
      responsibleFieldTechnician: source.responsibleFieldTechnician
        ? this.party(source.responsibleFieldTechnician)
        : null,
      auxiliaryTechnicians: source.auxiliaryTechnicians.map((item: any) =>
        this.party(item.user),
      ),
      checklist: source.checklistExecutions.map((item: any) =>
        this.checklist(item),
      ),
      materialPolicy: {
        enabled: podeCatalogo || podeAvulso,
        allowedActions: allowedActions.includes('REGISTER_MATERIAL')
          ? ['REGISTER_MATERIAL']
          : [],
        requiresAvailableStock: true,
        idempotencyRequired: true,
        catalogEnabled: podeCatalogo,
        freeFormEnabled: podeAvulso,
      },
      materials: materiais.map((item) => ({
        id: item.id,
        origin: item.origin as 'PLANNED' | 'APPLIED',
        description: item.description,
        unit: item.unit,
        quantity: item.quantity.toString(),
        notes: item.notes,
        catalogItemId: item.catalogItemId,
        registeredBy: item.createdBy
          ? { id: item.createdBy.id, name: item.createdBy.displayName }
          : null,
        registeredAt: item.createdAt.toISOString(),
      })),
      evidencePolicy: {
        /* O mesmo booleano da ação: a política e o botão não podem divergir. */
        uploadEnabled: canAttachEvidence,
        acceptedKinds: ['PHOTO', 'VIDEO', 'DOCUMENT'],
        base64Accepted: false,
      },
      artifactPolicy: {
        eligibleAfterCompletion: true,
        synchronousGeneration: false,
        artifacts: source.artifactExecutions.map((item: any) => ({
          id: item.id,
          type: item.snapshot.artifactType,
          status: item.status,
          previewAvailable: item.renderStatus === 'COMPLETED',
          downloadAvailable: item.renderStatus === 'COMPLETED',
        })),
      },
      professionalSignature,
      allowedTransitions: OperationStateMachine.allowedTransitions(
        source.status,
      ),
      allowedActions,
      primaryAction: this.primary(allowedActions),
      version: source.updatedAt.toISOString(),
      executionEligibility: { eligible: blockers.length === 0, blockers },
    };
    this.metric('preparation', started);
    return result;
  }

  async start(
    actor: MobileFieldActor,
    operationId: string,
    input: FieldOperationCommandDto,
  ): Promise<FieldOperationCommandResultReadModel> {
    this.requirePermission(actor, 'operations.status.update');
    const result = await this.repository.transition({
      operationId,
      organizationId: actor.organizationId,
      actorId: actor.id,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: this.hash(input),
      target: 'IN_PROGRESS',
    });
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_field_operation_start_total',
        idempotentReplay: result.idempotentReplay,
      }),
    );
    return this.commandResult(result.operation, actor, result.idempotentReplay);
  }

  async complete(
    actor: MobileFieldActor,
    operationId: string,
    input: FieldOperationCommandDto,
  ): Promise<FieldOperationCommandResultReadModel> {
    this.requirePermission(actor, 'operations.status.update');
    const result = await this.repository.transition({
      operationId,
      organizationId: actor.organizationId,
      actorId: actor.id,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: this.hash(input),
      target: 'COMPLETED',
    });
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_field_operation_complete_total',
        idempotentReplay: result.idempotentReplay,
      }),
    );
    return this.commandResult(result.operation, actor, result.idempotentReplay);
  }

  async addNote(
    actor: MobileFieldActor,
    operationId: string,
    input: FieldOperationNoteDto,
  ) {
    this.requirePermission(actor, 'operations.update');
    return this.repository.addNote({
      operationId,
      organizationId: actor.organizationId,
      actorId: actor.id,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: this.hash(input),
      note: input.note,
      visibility: input.visibility ?? 'INTERNAL',
      kind: input.kind ?? 'OBSERVATION',
    });
  }

  async updateChecklist(
    actor: MobileFieldActor,
    operationId: string,
    checklistId: string,
    input: FieldOperationChecklistUpdateDto,
  ) {
    this.requirePermission(actor, 'operations.update');
    const result = await this.repository.updateChecklist({
      operationId,
      checklistId,
      organizationId: actor.organizationId,
      actorId: actor.id,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: this.hash(input),
      answers: input.answers,
      notes: input.notes,
      complete: input.complete ?? false,
    });
    return {
      id: result.execution.id,
      status: result.execution.status,
      progress: result.execution.progress,
      version: result.execution.updatedAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
    };
  }

  /**
   * Registra um material aplicado no atendimento.
   *
   * ## Dois materiais, duas autoridades
   *
   * Com produto de catálogo o registro **move saldo**, e por isso exige
   * `inventory.manage`: é operação de almoxarifado. Sem produto é material
   * avulso — a abraçadeira, o metro de fita comprado na esquina —, que não tem
   * saldo a mover e exige `operations.update`, a autoridade de registrar o que
   * aconteceu no atendimento.
   *
   * Antes só o primeiro caso existia, e `catalogItemId` era obrigatório. O
   * técnico com permissão de executar e sem permissão de estoque não conseguia
   * registrar material nenhum — e a etapa do roteiro dizia que "este
   * atendimento não prevê registro de materiais", que era verdade sobre a
   * permissão e mentira sobre o atendimento.
   *
   * ## A linha é o que o relatório imprime
   *
   * O movimento de estoque continua existindo quando há produto, e fica
   * referenciado pela linha. Separados porque um avulso tem linha e não tem
   * movimento — e porque um movimento estornado não deve apagar do relatório o
   * que de fato foi aplicado.
   */
  async registerMaterial(
    actor: MobileFieldActor,
    operationId: string,
    input: FieldOperationMaterialDto,
  ) {
    const descricao = input.description?.trim() ?? '';
    if (!input.catalogItemId && !descricao)
      throw new ValidationException(
        'Informe o produto do catálogo ou a descrição do material',
      );
    this.requirePermission(
      actor,
      input.catalogItemId ? 'inventory.manage' : 'operations.update',
    );
    const operation = await this.requireVisible(actor, operationId);
    if (operation.status !== OperationStatus.IN_PROGRESS)
      throw new ForbiddenException(
        'Materiais só podem ser registrados durante o atendimento',
      );
    if (operation.updatedAt.toISOString() !== input.expectedVersion)
      throw new ConflictException(
        'Versão desatualizada; recarregue o atendimento',
      );

    /* O reenvio do mesmo comando encontra a linha e devolve a que existe: sem
       isto, a volta da rede somava o material duas vezes no relatório. */
    const registrada = await this.repository.operationMaterialByCommand(
      actor.organizationId,
      input.commandId,
    );
    if (registrada) {
      if (
        registrada.operationId !== operationId ||
        registrada.catalogItemId !== (input.catalogItemId ?? null) ||
        Number(registrada.quantity.toString()) !== input.quantity
      )
        throw new ConflictException(
          'Idempotency key reused with a different material payload',
        );
      return this.materialResult(registrada, operationId, true);
    }

    if (!input.catalogItemId) {
      const linha = await this.repository.createOperationMaterial({
        organizationId: actor.organizationId,
        businessUnitId: operation.businessUnitId,
        operationId,
        actorId: actor.id,
        commandId: input.commandId,
        catalogItemId: null,
        inventoryMovementId: null,
        description: descricao,
        unit: input.unit?.trim() || 'UN',
        quantity: input.quantity,
        notes: input.notes?.trim() || null,
      });
      return this.materialResult(linha, operationId, false);
    }

    const existing = await this.repository.materialByCommand(
      actor.organizationId,
      input.commandId,
    );
    if (
      existing &&
      (existing.operationId !== operationId ||
        existing.catalogItemId !== input.catalogItemId ||
        Number(existing.quantity.toString()) !== input.quantity ||
        existing.reason !== (input.reason ?? null) ||
        existing.notes !== (input.notes ?? null) ||
        existing.createdById !== actor.id)
    ) {
      throw new ConflictException(
        'Idempotency key reused with a different material payload',
      );
    }
    const movement =
      existing ??
      (await this.inventory.consumption(
        actor.organizationId,
        operation.businessUnitId,
        actor.id,
        {
          catalogItemId: input.catalogItemId,
          businessUnitId: operation.businessUnitId,
          quantity: input.quantity,
          operationId,
          reason: input.reason,
          notes: input.notes,
          sourceEntityId: input.commandId,
        },
      ));
    const resolved =
      movement ??
      (await this.repository.materialByCommand(
        actor.organizationId,
        input.commandId,
      ));
    if (!resolved) throw new EntityNotFoundException('InventoryMovement');

    /* A linha do relatório, com o nome copiado do produto: o documento é
       congelado, e renomear o produto depois não reescreve uma OS assinada. */
    const linha = await this.repository.createOperationMaterial({
      organizationId: actor.organizationId,
      businessUnitId: operation.businessUnitId,
      operationId,
      actorId: actor.id,
      commandId: input.commandId,
      catalogItemId: input.catalogItemId,
      inventoryMovementId: resolved.id,
      /* A descrição vem do aplicativo, que já mostrou o nome do produto na
         escolha. Sem ela, um rótulo honesto em vez de uma segunda consulta ao
         catálogo só para copiar um nome. */
      description: descricao || 'Material do catálogo',
      unit: input.unit?.trim() || 'UN',
      quantity: input.quantity,
      notes: input.notes?.trim() || null,
    });

    return {
      ...this.materialResult(linha, operationId, Boolean(existing)),
      movementId: resolved.id,
      balanceAfter: resolved.balanceAfter.toString(),
    };
  }

  private materialResult(
    linha: {
      id: string;
      catalogItemId: string | null;
      inventoryMovementId: string | null;
      description: string;
      unit: string;
      quantity: { toString(): string };
    },
    operationId: string,
    idempotentReplay: boolean,
  ) {
    return {
      id: linha.id,
      operationId,
      movementId: linha.inventoryMovementId,
      catalogItemId: linha.catalogItemId,
      description: linha.description,
      unit: linha.unit,
      quantity: linha.quantity.toString(),
      balanceAfter: null as string | null,
      idempotentReplay,
    };
  }

  async timeline(
    actor: MobileFieldActor,
    operationId: string,
    query: FieldOperationTimelineQueryDto,
  ): Promise<FieldOperationTimelineReadModel> {
    await this.requireVisible(actor, operationId);
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.timeline(
      operationId,
      actor.organizationId,
      limit,
      cursor,
    );
    const hasNextPage = rows.length > limit;
    const dataRows = rows.slice(0, limit);
    const last = dataRows.at(-1);
    return {
      data: dataRows.map((item: any) => ({
        id: item.id,
        type: item.action,
        message: this.message(item.action),
        actor: item.user ? this.party(item.user) : null,
        occurredAt: item.createdAt.toISOString(),
        data: this.publicDetails(item.details),
      })),
      meta: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? this.encodeCursor(last.createdAt, last.id)
            : null,
      },
    };
  }

  private async requireVisible(
    actor: MobileFieldActor,
    operationId: string,
  ): Promise<OperationPreparation> {
    const source = await this.repository.preparation(
      operationId,
      actor.organizationId,
    );
    if (!source) throw new EntityNotFoundException('Operation', operationId);
    const assigned =
      source.responsibleFieldTechnicianId === actor.id ||
      source.auxiliaryTechnicians.some(
        (item: any) => item.user.id === actor.id,
      );
    const fieldActor = await this.repository.isFieldActor(
      actor.organizationId,
      source.businessUnitId,
      actor.id,
    );
    if (!assigned || !fieldActor || !this.has(actor, 'operations.read'))
      throw new EntityNotFoundException('Operation', operationId);
    return source;
  }

  /**
   * Esta pessoa **executa** este atendimento, ou apenas acompanha?
   *
   * Auxiliar acompanha. Ele lê o atendimento e os documentos já emitidos, e
   * não inicia, não responde checklist, não registra material, não conclui e
   * não emite nada.
   *
   * ## Por que não bastava a permissão do papel
   *
   * `actions()` decidia só por `operations.status.update` e
   * `operations.update` — permissões do **papel**, iguais para todo técnico
   * de campo. Um auxiliar com o papel padrão recebia `START` e `COMPLETE` e
   * podia concluir no aplicativo um atendimento que não é dele. A permissão
   * diz o que a pessoa sabe fazer; a atribuição diz em qual atendimento.
   *
   * O responsável não atribuído a nada continua sem ações: `requireVisible`
   * já recusa quem não está em nenhuma das duas listas.
   */
  private isAuxiliaryOnly(
    source: OperationPreparation,
    actor: MobileFieldActor,
  ): boolean {
    if (source.responsibleFieldTechnicianId === actor.id) return false;
    return source.auxiliaryTechnicians.some(
      (item) => item.user.id === actor.id,
    );
  }

  private actions(
    source: any,
    actor: MobileFieldActor,
    canAttachEvidence = false,
  ): FieldOperationAllowedAction[] {
    const actions: FieldOperationAllowedAction[] = ['VIEW'];
    if (source.location || source.customer?.address) actions.push('OPEN_ROUTE');

    /**
     * Anexar vem antes do corte do auxiliar, e de propósito.
     *
     * A autoridade de evidências aceita o auxiliar — `assigned` conta
     * responsável **e** auxiliar, porque a foto é prova do que aquela pessoa
     * viu. Colocar isto depois do corte o excluiria de registrar o que ele
     * mesmo presenciou.
     */
    if (canAttachEvidence) actions.push('ADD_EVIDENCE');

    /**
     * O auxiliar para por aqui — mais o que for leitura, logo abaixo.
     *
     * Ir embora antes das leituras tiraria dele a rota e o documento já
     * emitido, que é justamente o que ele precisa em campo.
     */
    const auxiliary = this.isAuxiliaryOnly(source, actor);

    if (!auxiliary && source.status === OperationStatus.IN_PROGRESS) {
      if (this.has(actor, 'operations.status.update'))
        actions.push('RESUME', 'COMPLETE');
      if (this.has(actor, 'operations.update'))
        /* `REGISTER_MATERIAL` entrou aqui: material avulso não move saldo, e
           exigir `inventory.manage` para descrever uma abraçadeira deixava o
           técnico que só executa sem nenhuma forma de registrar o que aplicou. */
        actions.push('UPDATE_CHECKLIST', 'ADD_NOTE', 'REGISTER_MATERIAL');
      else if (this.has(actor, 'inventory.manage'))
        actions.push('REGISTER_MATERIAL');
    } else if (
      !auxiliary &&
      OperationStateMachine.allows(
        source.status,
        OperationStatus.IN_PROGRESS,
      ) &&
      this.has(actor, 'operations.status.update')
    )
      actions.push('START');

    /// Ler a etiqueta é consulta: identifica o equipamento, não muda nada.
    if (source.assets?.length && this.has(actor, 'assets.read'))
      actions.push('SCAN_EQUIPMENT');
    if (
      source.artifactExecutions.length &&
      this.has(actor, 'artifact_executions.read')
    )
      actions.push('VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT');
    return actions;
  }

  private blockers(source: any, actor: MobileFieldActor): string[] {
    const values: string[] = [];

    /// Para o auxiliar o motivo é o papel no atendimento, não a permissão —
    /// dizer "falta permissão" o mandaria pedir um acesso que ele já tem.
    if (this.isAuxiliaryOnly(source, actor))
      values.push('AUXILIARY_TECHNICIAN_READ_ONLY');
    else if (!this.has(actor, 'operations.status.update'))
      values.push('EXECUTION_PERMISSION_REQUIRED');
    if (
      !source.responsibleFieldTechnicianId &&
      !source.auxiliaryTechnicians.length
    )
      values.push('FIELD_ASSIGNMENT_REQUIRED');
    return values;
  }

  private checklist(source: any) {
    const snapshot = source.templateSnapshot as { items?: any[] };
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const answers = source.answers as Record<string, unknown>;
    return {
      id: source.id,
      name: source.template.name,
      status: source.status,
      progress: source.progress,
      version: source.updatedAt.toISOString(),
      notes: source.notes,
      items: items.map((item) => ({
        id: item.key,
        label: item.label,
        type: item.type,
        required: item.required ?? false,
        options: item.options ?? [],
        answer: answers[item.key] ?? null,
      })),
    };
  }

  private equipment(source: any) {
    return {
      id: source.id,
      code: source.identifier,
      name: source.name,
      type: source.category,
      brand: source.manufacturer,
      model: source.model,
      sector: source.location,
      status: source.status,
      qrAvailable: source.qrIdentities.length > 0,
    };
  }
  private party(source: any) {
    return {
      id: source.id,
      name: source.displayName ?? source.tradeName ?? source.legalName,
    };
  }
  private commandResult(
    source: any,
    actor: MobileFieldActor,
    replay: boolean,
  ): FieldOperationCommandResultReadModel {
    return {
      operationId: source.id,
      status: source.status as OperationStatusType,
      version: source.updatedAt.toISOString(),
      startedBy: source.startedBy ? this.party(source.startedBy) : null,
      startedAt: source.startedAt?.toISOString() ?? null,
      completedBy: source.completedBy ? this.party(source.completedBy) : null,
      completedAt: source.completedAt?.toISOString() ?? null,
      allowedActions: this.commandActions(source.status, actor),
      idempotentReplay: replay,
    };
  }
  private commandActions(
    status: OperationStatusType,
    actor: MobileFieldActor,
  ): FieldOperationAllowedAction[] {
    const actions: FieldOperationAllowedAction[] = ['VIEW'];
    if (status === OperationStatus.IN_PROGRESS) {
      if (this.has(actor, 'operations.status.update'))
        actions.push('RESUME', 'COMPLETE');
      if (this.has(actor, 'operations.update'))
        actions.push('UPDATE_CHECKLIST', 'ADD_NOTE', 'REGISTER_MATERIAL');
      else if (this.has(actor, 'inventory.manage'))
        actions.push('REGISTER_MATERIAL');
    }
    return actions;
  }
  private primary(
    actions: readonly FieldOperationAllowedAction[],
  ): FieldOperationAllowedAction | null {
    return (
      (['RESUME', 'START', 'UPDATE_CHECKLIST', 'VIEW'].find((item) =>
        actions.includes(item as FieldOperationAllowedAction),
      ) as FieldOperationAllowedAction | undefined) ?? null
    );
  }
  private has(actor: MobileFieldActor, permission: string): boolean {
    return (
      actor.permissions.includes('*') || actor.permissions.includes(permission)
    );
  }
  private requirePermission(actor: MobileFieldActor, permission: string): void {
    if (!this.has(actor, permission))
      throw new ForbiddenException(
        'Permissão insuficiente para executar esta ação',
      );
  }
  private hash(value: unknown): string {
    return createHash('sha256').update(this.canonical(value)).digest('hex');
  }
  private canonical(value: unknown): string {
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonical(object[key])}`)
      .join(',')}}`;
  }
  private encodeCursor(at: Date, id: string): string {
    return Buffer.from(
      JSON.stringify({ v: 1, at: at.toISOString(), id }),
    ).toString('base64url');
  }
  private decodeCursor(value: string): { at: Date; id: string } {
    try {
      const data = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
        v?: unknown;
        at?: unknown;
        id?: unknown;
      };
      if (
        data.v !== 1 ||
        typeof data.at !== 'string' ||
        typeof data.id !== 'string' ||
        Number.isNaN(Date.parse(data.at))
      )
        throw new Error();
      return { at: new Date(data.at), id: data.id };
    } catch {
      throw new ForbiddenException('Cursor de timeline inválido');
    }
  }
  private message(action: string): string {
    return (
      (
        {
          FIELD_OPERATION_STARTED: 'Atendimento iniciado',
          FIELD_OPERATION_COMPLETED: 'Atendimento concluído',
          FIELD_CHECKLIST_UPDATED: 'Checklist atualizado',
          FIELD_NOTE_ADDED: 'Observação registrada',
          FIELD_MATERIAL_REGISTERED: 'Material utilizado registrado',
        } as Record<string, string>
      )[action] ?? 'Atendimento atualizado'
    );
  }
  private publicDetails(value: unknown): Record<string, unknown> {
    const source =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const allowed = [
      'checklistExecutionId',
      'progress',
      'completed',
      'movementId',
      'catalogItemId',
      'quantity',
      'balanceAfter',
      'visibility',
    ];
    return Object.fromEntries(
      allowed.filter((key) => key in source).map((key) => [key, source[key]]),
    );
  }
  private metric(kind: string, started: number): void {
    this.logger.log(
      JSON.stringify({
        metric: `mobile_field_operation_${kind}_total`,
        durationMs: Number((performance.now() - started).toFixed(2)),
      }),
    );
  }
}
