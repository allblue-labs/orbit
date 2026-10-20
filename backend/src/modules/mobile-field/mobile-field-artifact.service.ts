/* eslint-disable @typescript-eslint/no-base-to-string -- Prisma infere um union discriminado profundo para as três autoridades; o TypeScript valida o contrato, mas o parser type-aware do ESLint não o resolve. */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ForbiddenException,
  ConflictException,
  EntityNotFoundException,
} from '../../exceptions';
import { ArtifactManifestService } from '../artifact-manifests/artifact-manifest.service';
import { ArtifactRenderService } from '../artifact-rendering/artifact-render.service';
import { formatServiceOrderNumber } from '../operations/service-order-number';
import type { MobileFieldActor } from './mobile-field.service';
import type { RenderFieldArtifactDto } from './mobile-field-artifact.dto';
import {
  MobileFieldArtifactRepository,
  type FreezeFieldArtifactInput,
  type FrozenFieldDocument,
} from './mobile-field-artifact.repository';
import type {
  FieldArtifactAllowedAction,
  FieldArtifactBlockedReason,
  FieldArtifactDownloadReadModel,
  FieldArtifactPreparationReadModel,
  FieldArtifactReadModel,
  FieldArtifactSourceType,
} from './mobile-field-artifact.read-models';

type Source = NonNullable<
  Awaited<ReturnType<MobileFieldArtifactRepository['source']>>
>;
type Existing = NonNullable<
  Awaited<ReturnType<MobileFieldArtifactRepository['existing']>>
>;

@Injectable()
export class MobileFieldArtifactService {
  private readonly logger = new Logger(MobileFieldArtifactService.name);

  constructor(
    private readonly repository: MobileFieldArtifactRepository,
    private readonly rendering: ArtifactRenderService,
    private readonly manifests: ArtifactManifestService,
  ) {}

  async preparation(
    actor: MobileFieldActor,
    sourceType: FieldArtifactSourceType,
    sourceId: string,
  ): Promise<FieldArtifactPreparationReadModel> {
    const started = performance.now();
    const [source, existing] = await Promise.all([
      this.repository.source(actor, sourceType, sourceId),
      this.repository.existing(actor, sourceType, sourceId),
    ]);
    if (!source) throw new EntityNotFoundException('Field source', sourceId);
    const result = this.prepare(source, existing);
    this.metric('mobile_artifact_prepare_total', started, {
      sourceType,
      eligible: result.eligibility.eligible,
      evidence: result.evidenceSummary.finalized,
    });
    return result;
  }

  async freeze(
    actor: MobileFieldActor,
    sourceType: FieldArtifactSourceType,
    sourceId: string,
  ): Promise<FieldArtifactReadModel> {
    const [source, current] = await Promise.all([
      this.repository.source(actor, sourceType, sourceId),
      this.repository.existing(actor, sourceType, sourceId),
    ]);
    if (!source) throw new EntityNotFoundException('Field source', sourceId);

    /**
     * Auxiliar não emite documento.
     *
     * Ele lê o atendimento e baixa o que já existe — `current` acima devolve
     * o documento pronto sem passar por aqui. O que ele não faz é **criar**
     * o snapshot imutável: emitir é ato de quem executou, e o documento sai
     * com a assinatura de quem é responsável.
     *
     * A checagem mora aqui, e não no controller, porque `@Capabilities` e
     * `@Permissions` decidem pelo papel — iguais para todo técnico de campo —
     * e o que separa os dois é a atribuição neste atendimento.
     */
    if (this.isAuxiliaryOnly(source, actor))
      throw new ForbiddenException(
        'Auxiliares acompanham o atendimento e não emitem documentos.',
      );

    if (current) return this.map(current);
    const preparation = this.prepare(source, null);
    if (!preparation.eligibility.eligible)
      throw new ConflictException(
        `Documento indisponível: ${preparation.eligibility.blockedReasons.join(', ')}`,
      );
    if (source.kind === 'PMOC_EQUIPMENT_EXECUTION')
      throw new ConflictException(
        'O documento PMOC deve ser preparado pelo fluxo PMOC existente',
      );

    const snapshot =
      source.kind === 'OPERATION'
        ? this.operationSnapshot(source)
        : this.rvtSnapshot(source);
    const snapshotHash = this.hash(snapshot);
    const input = this.freezeInput(actor, source, snapshot, snapshotHash);
    const artifact = await this.repository.freeze(input);
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_artifact_snapshot_frozen',
        sourceType,
        snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      }),
    );
    return this.map(artifact);
  }

  /**
   * Esta pessoa está neste atendimento **apenas** como auxiliar?
   *
   * Só vale para atendimento: RVT e PMOC têm outros donos e outro fluxo, e
   * dizer "não" para eles preserva o comportamento que já existia.
   */
  private isAuxiliaryOnly(source: Source, actor: MobileFieldActor): boolean {
    if (source.kind !== 'OPERATION') return false;
    const operation = source.source;
    if (operation.responsibleFieldTechnicianId === actor.id) return false;
    return operation.auxiliaryTechnicians.some(
      (item) => item.userId === actor.id,
    );
  }

  async render(
    actor: MobileFieldActor,
    artifactId: string,
    input: RenderFieldArtifactDto,
  ): Promise<FieldArtifactReadModel> {
    const artifact = await this.artifact(actor, artifactId);
    if (
      ['READY', 'PENDING', 'RENDERING'].includes(
        artifact.artifactExecution.renderStatus,
      )
    )
      return this.map(artifact);
    await this.rendering.request(
      artifact.artifactExecutionId,
      { organizationId: actor.organizationId, actorId: actor.id },
      {
        renderer: input.renderer ?? 'pdf.default',
        metadata: {
          source: 'MOBILE_FIELD',
          fieldArtifactId: artifact.id,
          snapshotHash: artifact.snapshotHash,
        },
      },
    );
    return this.map(await this.artifact(actor, artifactId));
  }

  async get(
    actor: MobileFieldActor,
    artifactId: string,
  ): Promise<FieldArtifactReadModel> {
    return this.map(await this.artifact(actor, artifactId));
  }

  async access(
    actor: MobileFieldActor,
    artifactId: string,
    operation: 'preview' | 'download',
  ): Promise<FieldArtifactDownloadReadModel> {
    const artifact = await this.artifact(actor, artifactId);
    const manifest = artifact.artifactExecution.manifests[0];
    if (!manifest)
      throw new ConflictException(
        'O documento final ainda não está disponível',
      );
    const signed = await this.manifests.signDownload(
      manifest.id,
      { organizationId: actor.organizationId, actorId: actor.id },
      operation,
    );
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_artifact_download_total',
        operation,
      }),
    );
    return {
      artifactId,
      operation,
      url: signed.url,
      expiresAt: signed.expiresAt,
      requiredHeaders: signed.requiredHeaders,
    };
  }

  private prepare(
    source: Source,
    existing: Existing | null,
  ): FieldArtifactPreparationReadModel {
    const reasons: FieldArtifactBlockedReason[] = [];
    const permission =
      source.permissions.includes('*') ||
      source.permissions.includes('artifact_rendering.render');
    if (!permission) reasons.push('NOT_AUTHORIZED');

    if (source.kind === 'PMOC_EQUIPMENT_EXECUTION') {
      if (source.source.status !== 'COMPLETED')
        reasons.push('SOURCE_NOT_COMPLETED');
      if (!source.source.artifactExecutionId)
        reasons.push('TEMPLATE_NOT_AVAILABLE');
      return {
        sourceType: source.kind,
        sourceId: source.source.id,
        documentType: 'PMOC',
        eligibility: {
          eligible: reasons.length === 0,
          blockedReasons: reasons,
        },
        templateVersion: null,
        professionalSignatures: {
          fieldTechnician: true,
          technicalResponsibleRequired: true,
          technicalResponsible: true,
        },
        customerAcknowledgement: {
          required: false,
          available: false,
          valid: true,
        },
        evidenceSummary: { finalized: 0, pending: 0 },
        snapshotVersion: 1,
        existingArtifact: existing ? this.map(existing) : null,
        allowedActions: existing ? this.actions(existing) : [],
      };
    }

    const completed = source.source.status === 'COMPLETED';
    if (!completed) reasons.push('SOURCE_NOT_COMPLETED');
    if (!source.template) reasons.push('TEMPLATE_NOT_AVAILABLE');

    let fieldSignature = false;
    let rtRequired = false;
    let rtSignature = false;
    let acknowledgementRequired = false;
    let acknowledgementAvailable = false;
    let pending = 0;
    let finalized = 0;

    if (source.kind === 'OPERATION') {
      fieldSignature = Boolean(source.signature);
      if (!fieldSignature) reasons.push('FIELD_TECHNICIAN_SIGNATURE_MISSING');
      acknowledgementRequired = this.flag(
        source.source.data,
        'customerAcknowledgementRequired',
      );
      acknowledgementAvailable = Boolean(source.acknowledgement);
      pending = source.source.fieldEvidenceUploads.length;
      finalized = source.source.fieldEvidence.length;
    } else {
      fieldSignature = Boolean(
        this.record(source.source.fieldTechnicianSignature).hash,
      );
      if (!fieldSignature) reasons.push('FIELD_TECHNICIAN_SIGNATURE_MISSING');
      rtRequired =
        source.source.occurrence.configuration.requiresTechnicalResponsible;
      rtSignature = Boolean(
        this.record(source.source.technicalResponsibleSignature).hash,
      );
      if (rtRequired && !source.source.technicalResponsibleUserId)
        reasons.push('TECHNICAL_RESPONSIBLE_MISSING');
      else if (rtRequired && !rtSignature) reasons.push('RT_SIGNATURE_MISSING');
      acknowledgementAvailable = Boolean(
        source.source.customerAcknowledgement ?? source.acknowledgement,
      );
      pending = source.source.fieldEvidenceUploads.length;
      finalized = source.source.fieldEvidence.length;
    }
    if (acknowledgementRequired && !acknowledgementAvailable)
      reasons.push('ACKNOWLEDGEMENT_REQUIRED');
    if (pending > 0) reasons.push('EVIDENCE_PENDING');

    const allowed: FieldArtifactAllowedAction[] = existing
      ? this.actions(existing)
      : reasons.length === 0
        ? ['PREPARE_DOCUMENT']
        : [];
    return {
      sourceType: source.kind,
      sourceId: source.source.id,
      documentType: source.kind === 'OPERATION' ? 'SERVICE_ORDER' : 'RVT',
      eligibility: {
        eligible: reasons.length === 0,
        blockedReasons: [...new Set(reasons)],
      },
      templateVersion: source.template?.version.version ?? null,
      professionalSignatures: {
        fieldTechnician: fieldSignature,
        technicalResponsibleRequired: rtRequired,
        technicalResponsible: rtSignature,
      },
      customerAcknowledgement: {
        required: acknowledgementRequired,
        available: acknowledgementAvailable,
        valid: acknowledgementAvailable || !acknowledgementRequired,
      },
      evidenceSummary: { finalized, pending },
      snapshotVersion: 1,
      existingArtifact: existing ? this.map(existing) : null,
      allowedActions: allowed,
    };
  }

  private operationSnapshot(
    source: Extract<Source, { kind: 'OPERATION' }>,
  ): FrozenFieldDocument {
    const operation = source.source;
    const signature = source.signature!;
    const signatory =
      operation.completedBy ??
      operation.startedBy ??
      operation.responsibleFieldTechnician!;
    return {
      schemaVersion: 1,
      sourceType: 'OPERATION',
      sourceId: operation.id,
      documentType: 'SERVICE_ORDER',
      locale: 'pt-BR',
      sections: [
        this.section('atendimento', 'Atendimento', 1, {
          Número: operation.code,
          Título: operation.title,
          Solicitação: operation.description,
          Status: 'Concluída',
          Início: this.date(operation.startedAt),
          Conclusão: this.date(operation.completedAt),
          Local: operation.location,
          /** O endereço do atendimento, quando declarado. */
          Endereço: operation.customerAddress
            ? [
                operation.customerAddress.label,
                [
                  operation.customerAddress.street,
                  operation.customerAddress.number,
                ]
                  .filter(Boolean)
                  .join(', '),
                operation.customerAddress.district,
                [
                  operation.customerAddress.city,
                  operation.customerAddress.stateCode,
                ]
                  .filter(Boolean)
                  .join('/'),
              ]
                .filter(Boolean)
                .join(' — ')
            : undefined,
          Setor: operation.sector ?? undefined,
        }),
        this.section('cliente', 'Cliente e unidade', 2, {
          Cliente:
            operation.customer?.tradeName ?? operation.customer?.legalName,
          Documento: operation.customer?.documentNumber,
          Unidade:
            operation.businessUnit.tradeName ??
            operation.businessUnit.legalName,
          'Município/UF': [
            operation.businessUnit.city,
            operation.businessUnit.stateCode,
          ]
            .filter(Boolean)
            .join(' / '),
        }),
        this.section('equipe', 'Equipe técnica', 3, {
          'Técnico em Campo': signatory.displayName,
          'Responsável atual':
            operation.responsibleFieldTechnician?.displayName,
          'Auxiliares técnico': operation.auxiliaryTechnicians.map(
            (item) => item.user.displayName,
          ),
        }),
        /**
         * Uma seção com todos os equipamentos.
         *
         * Era um só. O documento agora lista o que foi atendido no endereço —
         * e quem lê precisa ver os três aparelhos, não o primeiro deles.
         */
        this.section(
          'equipamento',
          operation.assets.length > 1 ? 'Equipamentos' : 'Equipamento',
          4,
          {
            Equipamentos: operation.assets.map((link) => ({
              nome: link.asset.name,
              fabricante: link.asset.manufacturer,
              modelo: link.asset.model,
              serie: link.asset.serialNumber,
              identificador: link.asset.identifier,
              local: link.asset.location,
            })),
          },
        ),
        this.section('materiais', 'Materiais utilizados', 5, {
          Materiais: operation.inventoryMovements.map((item) => ({
            produto: item.catalogItem.name,
            quantidade: item.quantity.toString(),
            unidade: item.catalogItem.unit,
          })),
        }),
      ],
      signatures: [
        {
          slotId: 'field_technician',
          label: 'Técnico em Campo',
          signerRole: 'Técnico em Campo',
          signedAs: 'FIELD_TECHNICIAN',
          userId: signatory.id,
          signerName: signatory.displayName,
          signatureHash: signature.sha256,
          signatureAssetId: signature.storageObjectId,
          signedAt: (operation.completedAt ?? new Date()).toISOString(),
        },
      ],
      evidence: operation.fieldEvidence.map((item) => this.evidence(item)),
      customerAcknowledgement: source.acknowledgement
        ? this.acknowledgement(source.acknowledgement)
        : null,
      metadata: {
        executionNotes: this.customerVisibleNotes(operation.history),
      },
      frozenAt: new Date().toISOString(),
    };
  }

  /**
   * O que o técnico escreveu **para o cliente**, na ordem em que escreveu.
   *
   * ## Por que só as visíveis
   *
   * Uma observação de campo nasce com visibilidade: `INTERNAL` é conversa da
   * equipe — "cliente resistente a trocar a peça", "voltar com outro técnico" — e
   * `CUSTOMER_VISIBLE` é o que se diz a ele. A OS é entregue e **assinada** pelo
   * cliente. Imprimir a interna nela vazaria o que a equipe disse entre si, num
   * papel que ele arquiva.
   *
   * ## Por que do histórico
   *
   * É onde a observação de campo é gravada (`FIELD_NOTE_ADDED`). A operação não tem
   * coluna de observação: cada nota é um fato com autor e hora, e achatá-las numa
   * coluna perderia quem escreveu o quê.
   *
   * `null` quando não há nenhuma — e aí a seção do documento simplesmente não
   * existe, em vez de aparecer vazia dizendo que nada foi observado.
   */
  private customerVisibleNotes(
    history: readonly { action: string; details: unknown }[],
  ): string | null {
    const notas = history
      .filter((entry) => entry.action === 'FIELD_NOTE_ADDED')
      .map((entry) => this.record(entry.details))
      .filter((details) => details.visibility === 'CUSTOMER_VISIBLE')
      .map((details) =>
        typeof details.note === 'string' ? details.note.trim() : '',
      )
      .filter((note) => note.length > 0);

    /* Linha em branco entre as notas: são momentos diferentes do atendimento, e
       emendadas viram um parágrafo que ninguém escreveu. */
    return notas.length > 0 ? notas.join('\n\n') : null;
  }

  private rvtSnapshot(
    source: Extract<Source, { kind: 'RVT_EXECUTION' }>,
  ): FrozenFieldDocument {
    const execution = source.source;
    const field = this.record(execution.fieldTechnicianSignature);
    const technical = this.record(execution.technicalResponsibleSignature);
    const signatures: FrozenFieldDocument['signatures'][number][] = [
      this.snapshotSignature(
        'field_technician',
        'Técnico em Campo',
        'FIELD_TECHNICIAN',
        field,
        execution.completedAt,
      ),
    ];
    if (execution.occurrence.configuration.requiresTechnicalResponsible)
      signatures.push(
        this.snapshotSignature(
          'technical_responsible',
          'Responsável Técnico',
          'TECHNICAL_RESPONSIBLE',
          technical,
          execution.completedAt,
        ),
      );
    return {
      schemaVersion: 1,
      sourceType: 'RVT_EXECUTION',
      sourceId: execution.id,
      documentType: 'RVT',
      locale: 'pt-BR',
      sections: [
        this.section('visita', 'Relatório de Visita Técnica', 1, {
          Configuração: execution.occurrence.configuration.name,
          Código: execution.occurrence.configuration.code,
          Ocorrência: execution.occurrence.sequenceNumber,
          'Realizada em': this.date(execution.performedAt),
          Local: execution.occurrence.configuration.serviceLocation,
        }),
        this.section('equipamentos', 'Equipamentos', 2, {
          Equipamentos: execution.equipment.map((item) => item.assetSnapshot),
        }),
        this.section('procedimento', 'Procedimento e constatações', 3, {
          Procedimento: execution.procedureSnapshot,
          Observações: execution.observations,
          Recomendações: execution.recommendations,
          'Recomendação complementar': execution.freeTextRecommendation,
        }),
      ],
      signatures,
      evidence: execution.fieldEvidence.map((item) => this.evidence(item)),
      customerAcknowledgement:
        this.recordOrNull(execution.customerAcknowledgement) ??
        (source.acknowledgement
          ? this.acknowledgement(source.acknowledgement)
          : null),
      frozenAt: new Date().toISOString(),
    };
  }

  private freezeInput(
    actor: MobileFieldActor,
    source: Extract<Source, { kind: 'OPERATION' | 'RVT_EXECUTION' }>,
    snapshot: FrozenFieldDocument,
    snapshotHash: string,
  ): FreezeFieldArtifactInput {
    if (!source.template)
      throw new ConflictException('Template documental indisponível');
    if (source.kind === 'OPERATION') {
      const value = source.source;
      return {
        actor,
        sourceType: source.kind,
        sourceId: value.id,
        documentType: 'SERVICE_ORDER',
        businessUnitId: value.businessUnitId,
        operationId: value.id,
        customerId: value.customerId,
        /**
         * A execução de artefato ainda aponta para **um** equipamento.
         *
         * O primeiro vinculado é o que vai: é o que o documento usa como
         * âncora, e a seção de equipamentos lista todos.
         */
        assetId: value.assets[0]?.asset.id ?? null,
        responsibleUserId: source.signatoryId,
        /*
         * O "Número" que o documento imprime é o da **ordem de serviço**, não o
         * código digitado na operação.
         *
         * Antes era `OS-<code>`, e `code` é texto livre: o número do documento
         * legal dependia da convenção de quem criou a operação, e não havia
         * contagem de ordens. A reserva acontece no nascimento da ordem, então
         * aqui só se lê.
         *
         * A volta para o código existe para as operações anteriores à numeração e
         * para as que não são ordem de serviço — uma operação de PMOC cujo
         * documento de OS alguém emita. Sair sem número seria pior: um documento
         * que ninguém consegue citar.
         */
        code:
          formatServiceOrderNumber(value.serviceOrderNumber) ??
          `OS-${value.code}`,
        title: `Ordem de Serviço — ${
          formatServiceOrderNumber(value.serviceOrderNumber) ?? value.code
        }`,
        startedAt: value.startedAt,
        completedAt: value.completedAt,
        template: source.template,
        snapshot,
        snapshotHash,
      };
    }
    const value = source.source;
    return {
      actor,
      sourceType: source.kind,
      sourceId: value.id,
      documentType: 'RVT',
      businessUnitId: value.businessUnitId,
      operationId: value.operationId,
      customerId: value.occurrence.configuration.customerId,
      assetId: null,
      responsibleUserId: value.responsibleFieldTechnicianId,
      code: `RVT-${value.occurrence.configuration.code}-${String(value.occurrence.sequenceNumber).padStart(3, '0')}`,
      title: `${value.occurrence.configuration.name} — Relatório de Visita Técnica`,
      startedAt: value.startedAt,
      completedAt: value.completedAt,
      template: source.template,
      snapshot,
      snapshotHash,
      existingArtifactExecutionId: value.artifactExecutionId,
    };
  }

  private map(value: Existing): FieldArtifactReadModel {
    const rawStatus = value.artifactExecution.renderStatus;
    const status: FieldArtifactReadModel['status'] =
      rawStatus === 'NOT_RENDERED'
        ? 'PREPARED'
        : (rawStatus as FieldArtifactReadModel['status']);
    const ready =
      status === 'READY' && value.artifactExecution.manifests.length > 0;
    return {
      id: value.id,
      artifactExecutionId: value.artifactExecutionId,
      sourceType: value.sourceType as FieldArtifactSourceType,
      sourceId: value.sourceId,
      documentType:
        value.documentType as FieldArtifactReadModel['documentType'],
      status,
      snapshotVersion: value.snapshotVersion,
      snapshotHash: value.snapshotHash,
      templateVersion: value.artifactExecution.snapshot.templateVersion,
      generatedAt:
        value.artifactExecution.manifests[0]?.issuedAt?.toISOString() ?? null,
      previewAvailable: ready,
      downloadAvailable: ready,
      allowedActions: this.actions(value),
    };
  }

  private actions(value: Existing): FieldArtifactAllowedAction[] {
    const status = value.artifactExecution.renderStatus;
    if (status === 'READY' && value.artifactExecution.manifests.length)
      return ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'];
    if (status === 'PENDING' || status === 'RENDERING') return [];
    return ['GENERATE_DOCUMENT'];
  }

  private async artifact(
    actor: MobileFieldActor,
    id: string,
  ): Promise<Existing> {
    const artifact = await this.repository.get(actor, id);
    if (!artifact) throw new EntityNotFoundException('Field artifact', id);
    return artifact;
  }

  private section(
    id: string,
    title: string,
    order: number,
    values: Record<string, unknown>,
  ): FrozenFieldDocument['sections'][number] {
    return {
      id,
      title,
      order,
      fields: Object.entries(values).map(([label, value], index) => ({
        id: `${id}_${index + 1}`,
        label,
        order: index + 1,
        value: value ?? null,
      })),
    };
  }

  private evidence(item: {
    id: string;
    storageFileId: string;
    sha256: string;
    mimeType: string;
    category: string;
    fileName: string;
    capturedAt: Date | null;
  }) {
    return {
      id: item.id,
      storageFileId: item.storageFileId,
      sha256: item.sha256,
      mimeType: item.mimeType,
      category: item.category,
      fileName: item.fileName,
      capturedAt: item.capturedAt?.toISOString() ?? null,
    };
  }

  private snapshotSignature(
    slotId: string,
    label: string,
    signedAs: string,
    value: Record<string, unknown>,
    completedAt: Date | null,
  ): FrozenFieldDocument['signatures'][number] {
    const credential = this.record(value.credential);
    return {
      slotId,
      label,
      signerRole: label,
      signedAs,
      userId: String(value.userId),
      signerName: String(value.name ?? ''),
      signatureHash: String(value.hash),
      signatureAssetId: String(value.signatureAssetId),
      credentialType:
        typeof credential.type === 'string' ? credential.type : null,
      credentialNumber:
        typeof credential.registrationNumber === 'string'
          ? credential.registrationNumber
          : null,
      credentialRegion:
        typeof credential.region === 'string' ? credential.region : null,
      signedAt: (completedAt ?? new Date()).toISOString(),
    };
  }

  private acknowledgement(value: {
    signerName: string;
    acknowledgedAt: Date;
    contentVersion: string;
    contentHash: string;
    signatureStorageFileId: string | null;
    signatureSha256: string | null;
    capturedByUserId: string;
  }): Record<string, unknown> {
    return {
      signerName: value.signerName,
      acknowledgedAt: value.acknowledgedAt.toISOString(),
      contentVersion: value.contentVersion,
      contentHash: value.contentHash,
      signatureStorageFileId: value.signatureStorageFileId,
      signatureSha256: value.signatureSha256,
      capturedBy: value.capturedByUserId,
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private recordOrNull(value: unknown): Record<string, unknown> | null {
    const result = this.record(value);
    return Object.keys(result).length ? result : null;
  }

  private flag(value: unknown, key: string): boolean {
    const root = this.record(value);
    return this.record(root.documentPolicy)[key] === true || root[key] === true;
  }

  private date(value: Date | null): string | null {
    return value
      ? new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/Recife',
        }).format(value)
      : null;
  }

  private canonical(value: unknown): string {
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${this.canonical(item)}`)
      .join(',')}}`;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(this.canonical(value)).digest('hex');
  }

  private metric(
    metric: string,
    started: number,
    data: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        metric,
        ...data,
        durationMs: Number((performance.now() - started).toFixed(2)),
      }),
    );
  }
}
