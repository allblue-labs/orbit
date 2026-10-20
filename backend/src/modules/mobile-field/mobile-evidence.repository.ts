import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { MobileFieldActor } from './mobile-field.service';
import type { FieldEvidenceTarget } from './mobile-evidence.read-models';
import { mobileEvidencePolicy } from './mobile-evidence.config';

type TargetContext = {
  type: FieldEvidenceTarget;
  id: string;
  businessUnitId: string;
  operationId: string | null;
  assigned: boolean;
  mutable: boolean;
  /**
   * Quais permissões servem para anexar aqui — **qualquer uma** delas.
   *
   * Lista, e não uma só, porque o mesmo anexo tem duas autoridades legítimas:
   * quem administra o módulo e quem executa em campo. No PMOC isso deixou de ser
   * teórico quando o atendimento chegou ao celular: o portão exigia
   * `pmoc.manage`, o papel de campo não tem, e o técnico atendia sem conseguir
   * anexar a foto — a evidência que o relatório imprime.
   *
   * Não é um afrouxamento: continua valendo tudo o mais do portão — perfil de
   * campo ativo, vínculo com a unidade, `assigned` (ser o responsável daquela
   * execução) e `mutable`.
   */
  permissions: readonly string[];
};

export interface CreateEvidenceIntentData {
  actor: MobileFieldActor;
  target: TargetContext;
  storageFileId: string;
  idempotencyKey: string;
  payloadHash: string;
  localMediaId: string | null;
  category: string;
  source: string;
  capturedAt: Date | null;
  expectedSha256: string | null;
  expiresAt: Date;
}

@Injectable()
export class MobileEvidenceRepository {
  constructor(private readonly rls: RlsTransaction) {}

  existingIntent(
    actorId: string,
    organizationId: string,
    key: string,
    localMediaId?: string,
  ) {
    return this.rls.run((tx) =>
      tx.fieldEvidenceUpload.findFirst({
        where: {
          organizationId,
          capturedByUserId: actorId,
          OR: [
            { idempotencyKey: key },
            ...(localMediaId ? [{ localMediaId }] : []),
          ],
        },
        include: { storageFile: true, evidence: true },
      }),
    );
  }

  async authorizeTarget(
    actor: MobileFieldActor,
    type: FieldEvidenceTarget,
    id: string,
  ): Promise<{ context: TargetContext | null; denied: boolean }> {
    return this.rls.run(async (tx) => {
      const permissions = await this.permissions(
        tx,
        actor.organizationId,
        actor.id,
        actor.businessUnitIds,
      );
      const profile = await tx.professionalProfile.findFirst({
        where: {
          organizationId: actor.organizationId,
          userId: actor.id,
          active: true,
          fieldTechnicianEnabled: true,
        },
        select: { id: true },
      });
      const target = await this.target(tx, actor, type, id);
      if (!target) return { context: null, denied: false };
      const membership = await tx.businessUnitMembership.findFirst({
        where: {
          organizationId: actor.organizationId,
          businessUnitId: target.businessUnitId,
          userId: actor.id,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      const permitted =
        permissions.includes('*') ||
        target.permissions.some((permission) =>
          permissions.includes(permission),
        );
      return {
        context: target,
        denied:
          !profile ||
          !membership ||
          !target.assigned ||
          !target.mutable ||
          !permitted,
      };
    });
  }

  createIntent(input: CreateEvidenceIntentData) {
    const target = this.targetColumns(input.target.type, input.target.id);
    return this.rls.run((tx) =>
      tx.fieldEvidenceUpload.create({
        data: {
          id: generateUuidV7(),
          organizationId: input.actor.organizationId,
          businessUnitId: input.target.businessUnitId,
          ...target,
          storageFileId: input.storageFileId,
          capturedByUserId: input.actor.id,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          localMediaId: input.localMediaId,
          category: input.category,
          source: input.source,
          capturedAt: input.capturedAt,
          expectedSha256: input.expectedSha256,
          expiresAt: input.expiresAt,
        },
        include: { storageFile: true, evidence: true },
      }),
    );
  }

  upload(actor: MobileFieldActor, uploadId: string) {
    return this.rls.run((tx) =>
      tx.fieldEvidenceUpload.findFirst({
        where: {
          id: uploadId,
          organizationId: actor.organizationId,
          capturedByUserId: actor.id,
          businessUnitId: { in: [...actor.businessUnitIds] },
        },
        include: {
          storageFile: true,
          evidence: { include: { capturedBy: true } },
        },
      }),
    );
  }

  markFailed(actor: MobileFieldActor, uploadId: string, code: string) {
    return this.rls.run((tx) =>
      tx.fieldEvidenceUpload.updateMany({
        where: {
          id: uploadId,
          organizationId: actor.organizationId,
          capturedByUserId: actor.id,
          status: { not: 'FINALIZED' },
        },
        data: { status: 'FAILED', failureCode: code },
      }),
    );
  }

  finalize(
    actor: MobileFieldActor,
    uploadId: string,
    verified: { sizeBytes: bigint; sha256: string; mimeType: string },
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-evidence:${uploadId}`}))`;
      const upload = await tx.fieldEvidenceUpload.findFirst({
        where: {
          id: uploadId,
          organizationId: actor.organizationId,
          capturedByUserId: actor.id,
        },
        include: {
          storageFile: true,
          evidence: { include: { capturedBy: true } },
        },
      });
      if (!upload) return { kind: 'NOT_FOUND' as const };
      if (upload.evidence)
        return { kind: 'FINALIZED' as const, evidence: upload.evidence };

      const type = this.typeOf(upload);
      const context = await this.target(tx, actor, type, this.idOf(upload));
      if (!context) return { kind: 'NOT_FOUND' as const };
      const permissions = await this.permissions(
        tx,
        actor.organizationId,
        actor.id,
        actor.businessUnitIds,
      );
      const profile = await tx.professionalProfile.findFirst({
        where: {
          organizationId: actor.organizationId,
          userId: actor.id,
          active: true,
          fieldTechnicianEnabled: true,
        },
        select: { id: true },
      });
      const membership = await tx.businessUnitMembership.findFirst({
        where: {
          organizationId: actor.organizationId,
          businessUnitId: context.businessUnitId,
          userId: actor.id,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (
        !profile ||
        !membership ||
        !context.assigned ||
        !context.mutable ||
        (!permissions.includes('*') &&
          !context.permissions.some((permission) =>
            permissions.includes(permission),
          ))
      )
        return { kind: 'DENIED' as const };
      if (upload.businessUnitId !== context.businessUnitId)
        return { kind: 'NOT_FOUND' as const };

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-evidence-target:${type}:${this.idOf(upload)}`}))`;

      const policy = mobileEvidencePolicy();
      const maximum =
        type === 'PMOC_EQUIPMENT_EXECUTION'
          ? policy.pmocMaximumFiles
          : type === 'RVT_EXECUTION'
            ? policy.rvtMaximumFiles
            : policy.operationMaximumFiles;
      const count = await tx.fieldEvidence.count({
        where: this.targetColumns(type, this.idOf(upload)),
      });
      if (count >= maximum) return { kind: 'LIMIT' as const, maximum };

      const now = new Date();

      /**
       * Esta foto foi citada por um pedido de cancelamento em aberto?
       *
       * A pergunta é feita **aqui**, e não quando o pedido foi criado, porque no
       * instante do pedido a foto normalmente ainda não existia: a captura é
       * offline-first e o upload acontece depois. O pedido guardou o `localMediaId`
       * que o aparelho declarou; é agora que ele vira referência de verdade.
       *
       * Só pedido pendente e só do mesmo atendimento: um pedido já resolvido não
       * recebe prova nova, e carimbar entre atendimentos juntaria a foto de um ao
       * relato de outro.
       */
      const citado =
        context.operationId && upload.localMediaId
          ? await tx.operationCancellationRequest.findFirst({
              where: {
                organizationId: actor.organizationId,
                operationId: context.operationId,
                status: 'PENDING',
                citedLocalMediaIds: { has: upload.localMediaId },
              },
              select: { id: true },
            })
          : null;

      const evidence = await tx.fieldEvidence.create({
        data: {
          id: generateUuidV7(),
          organizationId: actor.organizationId,
          businessUnitId: context.businessUnitId,
          uploadId: upload.id,
          ...this.targetColumns(type, this.idOf(upload)),
          storageFileId: upload.storageFileId,
          category: upload.category,
          source: upload.source,
          fileName: upload.storageFile.fileName,
          mimeType: verified.mimeType,
          sizeBytes: verified.sizeBytes,
          sha256: verified.sha256,
          capturedAt: upload.capturedAt,
          uploadedAt: now,
          capturedByUserId: actor.id,
          localMediaId: upload.localMediaId,
          cancellationRequestId: citado?.id ?? null,
        },
        include: { capturedBy: true },
      });
      await tx.fieldEvidenceUpload.update({
        where: { id: upload.id },
        data: {
          status: 'FINALIZED',
          uploadedAt: now,
          finalizedAt: now,
          failureCode: null,
        },
      });
      if (context.operationId)
        await tx.operationHistory.create({
          data: {
            operationId: context.operationId,
            userId: actor.id,
            action: 'FIELD_EVIDENCE_ADDED',
            details: {
              evidenceId: evidence.id,
              targetType: type,
              sha256: verified.sha256,
            },
          },
        });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          businessUnitId: context.businessUnitId,
          userId: actor.id,
          action: 'FIELD_EVIDENCE_FINALIZED',
          entityType: 'FIELD_EVIDENCE',
          entityId: evidence.id,
          metadata: {
            targetType: type,
            targetId: this.idOf(upload),
            storageFileId: upload.storageFileId,
            sha256: verified.sha256,
            sizeBytes: verified.sizeBytes.toString(),
          },
        },
      });
      return { kind: 'FINALIZED' as const, evidence };
    });
  }

  async list(
    actor: MobileFieldActor,
    type: FieldEvidenceTarget,
    id: string,
    limit: number,
  ) {
    const access = await this.authorizeTarget(actor, type, id);
    if (!access.context || access.denied) return null;
    return this.rls.run((tx) =>
      tx.fieldEvidence.findMany({
        where: {
          organizationId: actor.organizationId,
          businessUnitId: access.context!.businessUnitId,
          ...this.targetColumns(type, id),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { capturedBy: { select: { id: true, displayName: true } } },
      }),
    );
  }

  evidence(actor: MobileFieldActor, id: string) {
    return this.rls.run((tx) =>
      tx.fieldEvidence.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
        },
        include: {
          storageFile: true,
          capturedBy: { select: { id: true, displayName: true } },
        },
      }),
    );
  }

  expired(limit: number) {
    return this.rls.run((tx) =>
      tx.$queryRaw<
        Array<{
          id: string;
          storage_file_id: string;
          bucket: string;
          object_key: string;
        }>
      >(Prisma.sql`
        SELECT u.id, u.storage_file_id, s.bucket, s.object_key
          FROM field_evidence_uploads u
          JOIN storage_files s ON s.id = u.storage_file_id
         WHERE u.status IN ('PENDING_UPLOAD','UPLOADED','FAILED')
           AND u.expires_at < now()
           AND NOT EXISTS (SELECT 1 FROM field_evidence e WHERE e.upload_id = u.id)
         ORDER BY u.expires_at ASC
         LIMIT ${limit}
         FOR UPDATE OF u SKIP LOCKED
      `),
    );
  }

  expire(uploadId: string, storageFileId: string) {
    return this.rls.run(async (tx) => {
      const evidence = await tx.fieldEvidence.findUnique({
        where: { uploadId },
        select: { id: true },
      });
      if (evidence) return false;
      await tx.fieldEvidenceUpload.updateMany({
        where: { id: uploadId, status: { not: 'FINALIZED' } },
        data: { status: 'EXPIRED', failureCode: 'ORPHAN_EXPIRED' },
      });
      await tx.storageFile.updateMany({
        where: { id: storageFileId },
        data: { status: 'MISSING', deletedAt: new Date() },
      });
      return true;
    });
  }

  private async permissions(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorId: string,
    businessUnitIds: readonly string[],
  ): Promise<string[]> {
    const organization = await tx.organizationMembership.findFirst({
      where: { organizationId, userId: actorId, status: 'ACTIVE' },
      select: { role: { select: { permissions: true } } },
    });
    const units = await tx.businessUnitMembership.findMany({
      where: {
        organizationId,
        userId: actorId,
        businessUnitId: { in: [...businessUnitIds] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { role: { select: { permissions: true } } },
    });
    return [
      ...(organization?.role.permissions ?? []),
      ...units.flatMap((item) => item.role.permissions),
    ];
  }

  private async target(
    tx: Prisma.TransactionClient,
    actor: MobileFieldActor,
    type: FieldEvidenceTarget,
    id: string,
  ): Promise<TargetContext | null> {
    if (type === 'OPERATION') {
      const value = await tx.operation.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
          deletedAt: null,
        },
        select: {
          id: true,
          businessUnitId: true,
          status: true,
          responsibleFieldTechnicianId: true,
          auxiliaryTechnicians: {
            where: { removedAt: null, userId: actor.id },
            select: { id: true },
          },
        },
      });
      return value
        ? {
            type,
            id,
            businessUnitId: value.businessUnitId,
            operationId: value.id,
            assigned:
              value.responsibleFieldTechnicianId === actor.id ||
              value.auxiliaryTechnicians.length > 0,
            mutable: ['OPEN', 'IN_PROGRESS'].includes(value.status),
            permissions: ['operations.update'],
          }
        : null;
    }
    if (type === 'PMOC_EQUIPMENT_EXECUTION') {
      const value = await tx.pmocEquipmentExecution.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
        },
        select: {
          id: true,
          businessUnitId: true,
          status: true,
          operationId: true,
          responsibleFieldTechnicianId: true,
          operation: {
            select: {
              auxiliaryTechnicians: {
                where: { removedAt: null, userId: actor.id },
                select: { id: true },
              },
            },
          },
        },
      });
      return value
        ? {
            type,
            id,
            businessUnitId: value.businessUnitId,
            operationId: value.operationId,
            assigned:
              value.responsibleFieldTechnicianId === actor.id ||
              Boolean(value.operation?.auxiliaryTechnicians.length),
            mutable: value.status === 'IN_PROGRESS',
            /* Gerenciar o contrato, ou executá-lo em campo. */
            permissions: ['pmoc.manage', 'pmoc.execute'],
          }
        : null;
    }
    const value = await tx.rvtExecution.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        businessUnitId: { in: [...actor.businessUnitIds] },
      },
      select: {
        id: true,
        businessUnitId: true,
        status: true,
        operationId: true,
        responsibleFieldTechnicianId: true,
      },
    });
    const auxiliary = value?.operationId
      ? await tx.operationAuxiliaryTechnician.findFirst({
          where: {
            operationId: value.operationId,
            userId: actor.id,
            removedAt: null,
          },
          select: { id: true },
        })
      : null;
    return value
      ? {
          type,
          id,
          businessUnitId: value.businessUnitId,
          operationId: value.operationId,
          assigned:
            value.responsibleFieldTechnicianId === actor.id ||
            Boolean(auxiliary),
          mutable: value.status === 'IN_PROGRESS',
          permissions: ['rvt.execute'],
        }
      : null;
  }

  private targetColumns(type: FieldEvidenceTarget, id: string) {
    return {
      operationId: type === 'OPERATION' ? id : null,
      pmocEquipmentExecutionId: type === 'PMOC_EQUIPMENT_EXECUTION' ? id : null,
      rvtExecutionId: type === 'RVT_EXECUTION' ? id : null,
    };
  }

  private typeOf(upload: {
    operationId: string | null;
    pmocEquipmentExecutionId: string | null;
  }): FieldEvidenceTarget {
    return upload.operationId
      ? 'OPERATION'
      : upload.pmocEquipmentExecutionId
        ? 'PMOC_EQUIPMENT_EXECUTION'
        : 'RVT_EXECUTION';
  }

  private idOf(upload: {
    operationId: string | null;
    pmocEquipmentExecutionId: string | null;
    rvtExecutionId: string | null;
  }): string {
    return (
      upload.operationId ??
      upload.pmocEquipmentExecutionId ??
      upload.rvtExecutionId!
    );
  }
}
