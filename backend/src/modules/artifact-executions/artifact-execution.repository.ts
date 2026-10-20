import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import { DomainEventEmitter } from '../automations/domain-event.emitter';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type {
  ArtifactExecutionQueryDto,
  CollectArtifactSignatureDto,
  CreateArtifactExecutionDto,
  RegisterArtifactAttachmentDto,
  SaveArtifactResponseDto,
  UpdateArtifactExecutionDto,
} from './dto/artifact-execution.dto';

const details = Prisma.validator<Prisma.ArtifactExecutionInclude>()({
  snapshot: true,
  team: { orderBy: { assignedAt: 'asc' as const } },
  responses: {
    orderBy: [{ sectionId: 'asc' as const }, { fieldId: 'asc' as const }],
  },
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
  },
  signatures: { orderBy: { signedAt: 'asc' as const } },
  insights: { orderBy: { createdAt: 'desc' as const } },
});

/**
 * O último instante do dia informado, quando vem só a data.
 *
 * `2026-03-31` chega como `2026-03-31T00:00:00Z`; usado cru em `lte`, o dia 31
 * inteiro fica de fora. Com hora explícita o valor é respeitado como veio —
 * quem pede um instante quer aquele instante.
 */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

/**
 * O `where` da listagem, separado da transação.
 *
 * A montagem do filtro é a parte que erra — período aberto de um lado, tipo
 * vindo do template em vez do snapshot, um `undefined` que virou `null` e
 * apagou metade da lista. Fora da transação ela se testa sem banco, e a
 * contagem e a página passam a usar exatamente o mesmo objeto.
 */
export function executionFilter(
  organizationId: string,
  query: ArtifactExecutionQueryDto,
): Prisma.ArtifactExecutionWhereInput {
  return {
    organizationId,
    deletedAt: null,
    businessUnitId: query.businessUnitId,
    operationId: query.operationId,
    customerId: query.customerId,
    assetId: query.assetId,
    responsibleUserId: query.responsibleUserId,
    status: query.status,
    renderStatus: query.renderStatus,
    /* O tipo é do snapshot, não do template: o documento emitido é do tipo
         que valia quando a execução nasceu, e trocar o template depois não
         reescreve o passado da listagem. */
    ...(query.artifactType
      ? { snapshot: { artifactType: query.artifactType } }
      : {}),
    ...(query.createdFrom || query.createdTo
      ? {
          createdAt: {
            ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
            /* O fim do período é inclusivo: quem filtra "até 31/03" espera o
                 dia 31 inteiro, e uma data sem hora chega como meia-noite —
                 `lte` cru descartaria o dia todo. */
            ...(query.createdTo ? { lte: endOfDay(query.createdTo) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { title: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

@Injectable()
export class ArtifactExecutionRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly events: DomainEventEmitter,
  ) {}

  list(organizationId: string, query: ArtifactExecutionQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where = executionFilter(organizationId, query);
    return this.rls.run(async (tx) => {
      const data = await tx.artifactExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.artifactExecution.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.artifactExecution.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: details,
      }),
    );
  }

  create(
    organizationId: string,
    actorId: string,
    input: CreateArtifactExecutionDto,
  ) {
    return this.rls.run(async (tx) => {
      await this.assertReferences(tx, organizationId, input);
      const template = await tx.artifactTemplate.findFirstOrThrow({
        where: {
          id: input.templateId,
          deletedAt: null,
          status: 'ACTIVE',
          OR: [
            { organizationId },
            { organizationId: null, visibility: 'GLOBAL' },
          ],
        },
      });
      const versionNumber = input.templateVersion ?? template.currentVersion;
      const version = await tx.artifactTemplateVersion.findUniqueOrThrow({
        where: {
          templateId_version: {
            templateId: template.id,
            version: versionNumber,
          },
        },
      });
      const structureHash = createHash('sha256')
        .update(
          JSON.stringify({
            metadata: version.metadata,
            sections: version.sections,
            signatureSlots: version.signatureSlots,
            layout: version.layout,
          }),
        )
        .digest('hex');
      const snapshot = await tx.artifactSnapshot.create({
        data: {
          organizationId,
          templateId: template.id,
          templateVersionId: version.id,
          templateVersion: version.version,
          templateKey: template.key,
          templateName: template.name,
          artifactType: template.artifactType,
          segment: template.segment,
          metadata: this.json(version.metadata),
          sections: this.json(version.sections),
          signatureSlots: this.json(version.signatureSlots),
          layout: this.json(version.layout),
          structureHash,
        },
      });
      const execution = await tx.artifactExecution.create({
        data: {
          organizationId,
          businessUnitId: input.businessUnitId,
          operationId: input.operationId,
          customerId: input.customerId,
          assetId: input.assetId,
          templateId: template.id,
          snapshotId: snapshot.id,
          responsibleUserId: input.responsibleUserId,
          createdById: actorId,
          code: input.code,
          title: input.title,
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          notes: input.notes,
          context: this.json(input.context),
          team: {
            create: input.team.map((member) => ({
              userId: member.userId,
              role: member.role,
            })),
          },
        },
        include: details,
      });
      await this.audit(
        tx,
        organizationId,
        input.businessUnitId,
        actorId,
        'ARTIFACT_EXECUTION_CREATED',
        execution.id,
        null,
        {
          templateId: template.id,
          templateVersion: version.version,
          snapshotId: snapshot.id,
        },
      );
      return execution;
    });
  }

  update(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateArtifactExecutionDto,
  ) {
    return this.rls.run(async (tx) => {
      const before = await tx.artifactExecution.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      if (input.responsibleUserId)
        await this.assertUsers(tx, organizationId, [input.responsibleUserId]);
      if (input.team)
        await this.assertUsers(
          tx,
          organizationId,
          input.team.map((member) => member.userId),
        );
      if (input.team) {
        await tx.artifactExecutionTeam.deleteMany({
          where: { executionId: id },
        });
        await tx.artifactExecutionTeam.createMany({
          data: input.team.map((member) => ({
            executionId: id,
            userId: member.userId,
            role: member.role,
          })),
        });
      }
      const execution = await tx.artifactExecution.update({
        where: { id },
        data: {
          title: input.title,
          responsibleUserId: input.responsibleUserId,
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          notes: input.notes,
          context: input.context ? this.json(input.context) : undefined,
        },
        include: details,
      });
      await this.audit(
        tx,
        organizationId,
        before.businessUnitId,
        actorId,
        'ARTIFACT_EXECUTION_UPDATED',
        id,
        { title: before.title },
        { title: execution.title },
      );
      return execution;
    });
  }

  status(id: string, organizationId: string, actorId: string, status: string) {
    return this.rls.run(async (tx) => {
      const before = await tx.artifactExecution.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      const now = new Date();
      const dates: Prisma.ArtifactExecutionUpdateInput = {
        ...(status === 'IN_PROGRESS' && !before.startedAt
          ? { startedAt: now }
          : {}),
        ...(status === 'PAUSED' ? { pausedAt: now } : {}),
        ...(status === 'UNDER_REVIEW' ? { submittedAt: now } : {}),
        ...(status === 'APPROVED' ? { approvedAt: now } : {}),
        ...(status === 'COMPLETED' ? { completedAt: now } : {}),
        ...(status === 'ARCHIVED' ? { archivedAt: now } : {}),
      };
      const execution = await tx.artifactExecution.update({
        where: { id },
        data: { status, ...dates },
        include: details,
      });
      await this.audit(
        tx,
        organizationId,
        before.businessUnitId,
        actorId,
        'ARTIFACT_EXECUTION_STATUS_CHANGED',
        id,
        { status: before.status },
        { status },
      );

      /**
       * Concluída: o formulário de campo virou fato.
       *
       * Só `COMPLETED` é publicado — as demais transições são passos do
       * preenchimento, e uma automação que disparasse a cada pausa incomodaria
       * mais do que ajudaria.
       */
      if (status === 'COMPLETED') {
        await this.events.emit(tx, {
          type: 'artifact.execution.completed',
          organizationId,
          businessUnitId: before.businessUnitId,
          actorId,
          entityType: 'ARTIFACT_EXECUTION',
          entityId: id,
          payload: {
            artifactType: execution.snapshot?.artifactType,
            templateKey: execution.snapshot?.templateKey,
            businessUnitId: before.businessUnitId,
            customerId: before.customerId,
            operationId: before.operationId,
            createdById: before.createdById,
          },
        });
      }
      return execution;
    });
  }

  saveResponse(
    id: string,
    organizationId: string,
    actorId: string,
    input: SaveArtifactResponseDto,
    field: { type: string; unit?: string; validations: unknown[] },
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.artifactExecution.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      await tx.artifactExecutionResponse.upsert({
        where: {
          executionId_sectionId_fieldId: {
            executionId: id,
            sectionId: input.sectionId,
            fieldId: input.fieldId,
          },
        },
        create: {
          organizationId,
          executionId: id,
          sectionId: input.sectionId,
          fieldId: input.fieldId,
          value: this.json(input.value),
          valueType: field.type,
          unit: input.unit ?? field.unit,
          validations: this.json(field.validations),
          provenance: input.provenance,
          notes: input.notes,
          answeredById: actorId,
        },
        update: {
          value: this.json(input.value),
          valueType: field.type,
          unit: input.unit ?? field.unit,
          validations: this.json(field.validations),
          provenance: input.provenance,
          notes: input.notes,
          answeredById: actorId,
          answeredAt: new Date(),
        },
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'ARTIFACT_RESPONSE_SAVED',
        id,
        null,
        {
          sectionId: input.sectionId,
          fieldId: input.fieldId,
          provenance: input.provenance,
        },
      );
      return tx.artifactExecution.findUniqueOrThrow({
        where: { id },
        include: details,
      });
    });
  }

  registerAttachment(
    id: string,
    organizationId: string,
    actorId: string,
    input: RegisterArtifactAttachmentDto,
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.artifactExecution.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      if (input.responseId)
        await tx.artifactExecutionResponse.findFirstOrThrow({
          where: { id: input.responseId, executionId: id },
        });
      /**
       * Ligação com o Storage (PR-19).
       *
       * Quando `storageKey` é o identificador de um arquivo reservado por
       * `POST /attachments/upload-url`, o anexo passa a apontar para ele. Um
       * valor livre — o contrato sempre permitiu — continua aceito, e o anexo
       * fica sem objeto gerenciado, exatamente como antes desta PR.
       */
      const file = await tx.storageFile.findFirst({
        where: { id: input.storageKey, organizationId, deletedAt: null },
        select: { id: true },
      });

      await tx.artifactExecutionAttachment.create({
        data: {
          organizationId,
          executionId: id,
          responseId: input.responseId,
          sectionId: input.sectionId,
          uploadedById: actorId,
          kind: input.kind,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          storageKey: input.storageKey,
          fileId: file?.id ?? null,
          checksum: input.checksum?.toLowerCase(),
          metadata: this.json(input.metadata),
        },
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'ARTIFACT_ATTACHMENT_REGISTERED',
        id,
        null,
        {
          storageKey: input.storageKey,
          kind: input.kind,
          managed: Boolean(file),
        },
      );
      return tx.artifactExecution.findUniqueOrThrow({
        where: { id },
        include: details,
      });
    });
  }

  collectSignature(
    id: string,
    organizationId: string,
    actorId: string,
    input: CollectArtifactSignatureDto,
    signerRole: string,
    signatureHash: string,
    signatorySnapshot?: {
      signedAs: string;
      signatureAssetId: string;
      signatureAssetHash: string;
      professionalRole: string;
      credentialType?: string;
      credentialNumber?: string;
      credentialRegion?: string;
      capturedAt: Date;
    },
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.artifactExecution.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      await tx.artifactExecutionSignature.create({
        data: {
          organizationId,
          executionId: id,
          slotId: input.slotId,
          signerRole,
          userId: input.userId,
          signerName: input.signerName,
          signerDocument: input.signerDocument,
          signatureData: this.json(input.signatureData),
          signatureHash,
          signedAs: signatorySnapshot?.signedAs ?? input.signedAs,
          signatureAssetId: signatorySnapshot?.signatureAssetId,
          signatureAssetHash: signatorySnapshot?.signatureAssetHash,
          professionalRole: signatorySnapshot?.professionalRole,
          credentialType: signatorySnapshot?.credentialType,
          credentialNumber: signatorySnapshot?.credentialNumber,
          credentialRegion: signatorySnapshot?.credentialRegion,
          capturedAt: signatorySnapshot?.capturedAt,
          consentText: input.consentText,
          geolocation: input.geolocation
            ? this.json(input.geolocation)
            : undefined,
        },
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'ARTIFACT_SIGNATURE_COLLECTED',
        id,
        null,
        {
          slotId: input.slotId,
          signerRole,
          signedAs: signatorySnapshot?.signedAs ?? input.signedAs,
        },
      );
      return tx.artifactExecution.findUniqueOrThrow({
        where: { id },
        include: details,
      });
    });
  }

  updateProgress(id: string, progress: number) {
    return this.rls.run((tx) =>
      tx.artifactExecution.update({
        where: { id },
        data: { progress },
        include: details,
      }),
    );
  }

  private async assertReferences(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: CreateArtifactExecutionDto,
  ) {
    await tx.businessUnit.findFirstOrThrow({
      where: { id: input.businessUnitId, organizationId, deletedAt: null },
    });
    if (input.operationId)
      await tx.operation.findFirstOrThrow({
        where: {
          id: input.operationId,
          organizationId,
          businessUnitId: input.businessUnitId,
          deletedAt: null,
        },
      });
    if (input.customerId)
      await tx.customer.findFirstOrThrow({
        where: { id: input.customerId, organizationId, deletedAt: null },
      });
    if (input.assetId)
      await tx.asset.findFirstOrThrow({
        where: {
          id: input.assetId,
          organizationId,
          businessUnitId: input.businessUnitId,
          deletedAt: null,
        },
      });
    await this.assertUsers(tx, organizationId, [
      ...input.team.map((member) => member.userId),
      ...(input.responsibleUserId ? [input.responsibleUserId] : []),
    ]);
  }

  private async assertUsers(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userIds: string[],
  ) {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const count = await tx.organizationMembership.count({
      where: {
        organizationId,
        userId: { in: unique },
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    if (count !== unique.length)
      throw new Error('Execution users must be active organization members');
  }

  private audit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    action: string,
    entityId: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        businessUnitId,
        userId: actorId,
        action,
        entityType: 'ARTIFACT_EXECUTION',
        entityId,
        before: before ?? undefined,
        after: after ?? undefined,
      },
    });
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
