import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { MobileFieldActor } from './mobile-field.service';
import type {
  FieldArtifactDocumentType,
  FieldArtifactSourceType,
} from './mobile-field-artifact.read-models';

export interface FrozenFieldDocument {
  schemaVersion: 1;
  sourceType: FieldArtifactSourceType;
  sourceId: string;
  documentType: FieldArtifactDocumentType;
  locale: 'pt-BR';
  /**
   * Fatos da execução que o documento lê por nome, não por seção.
   *
   * Os compositores premium leem alguns dados de `metadata` — `executionNotes` é o
   * que alimenta "Observações da execução" na OS e "Observações" na RVT. Antes
   * disto, o `metadata` de um documento congelado era só o do **template**, e
   * essas seções nunca imprimiam nada em produção: o técnico escrevia, o texto
   * ficava no histórico, e o documento saía sem ele.
   *
   * Opcional porque nem todo documento tem o que dizer aqui.
   */
  metadata?: Record<string, unknown>;
  sections: readonly {
    id: string;
    title: string;
    order: number;
    fields: readonly {
      id: string;
      label: string;
      order: number;
      value: unknown;
    }[];
  }[];
  signatures: readonly {
    slotId: string;
    label: string;
    signerRole: string;
    signedAs: string;
    userId: string;
    signerName: string;
    signatureHash: string;
    signatureAssetId: string;
    credentialType?: string | null;
    credentialNumber?: string | null;
    credentialRegion?: string | null;
    signedAt: string;
  }[];
  evidence: readonly {
    id: string;
    storageFileId: string;
    sha256: string;
    mimeType: string;
    category: string;
    fileName: string;
    capturedAt: string | null;
  }[];
  customerAcknowledgement: Record<string, unknown> | null;
  frozenAt: string;
}

export interface FreezeFieldArtifactInput {
  actor: MobileFieldActor;
  sourceType: FieldArtifactSourceType;
  sourceId: string;
  documentType: FieldArtifactDocumentType;
  businessUnitId: string;
  operationId: string | null;
  customerId: string | null;
  assetId: string | null;
  responsibleUserId: string | null;
  code: string;
  title: string;
  startedAt: Date | null;
  completedAt: Date | null;
  template: {
    id: string;
    key: string;
    name: string;
    artifactType: string;
    segment: string | null;
    version: {
      id: string;
      version: number;
      metadata: unknown;
      sections: unknown;
      signatureSlots: unknown;
      layout: unknown;
    };
  };
  snapshot: FrozenFieldDocument;
  snapshotHash: string;
  existingArtifactExecutionId?: string | null;
}

const artifactInclude = {
  artifactExecution: {
    include: {
      snapshot: { select: { templateVersion: true } },
      manifests: {
        where: { isActive: true, status: 'ISSUED', deletedAt: null },
        orderBy: { revision: 'desc' as const },
        take: 1,
      },
    },
  },
} satisfies Prisma.FieldArtifactInclude;

@Injectable()
export class MobileFieldArtifactRepository {
  constructor(private readonly rls: RlsTransaction) {}

  source(
    actor: MobileFieldActor,
    sourceType: FieldArtifactSourceType,
    id: string,
  ) {
    return this.rls.run(async (tx) => {
      const permissions = await this.permissions(tx, actor);
      if (sourceType === 'OPERATION') {
        const source = await tx.operation.findFirst({
          where: {
            id,
            organizationId: actor.organizationId,
            businessUnitId: { in: [...actor.businessUnitIds] },
            deletedAt: null,
          },
          include: {
            organization: { select: { id: true, displayName: true } },
            businessUnit: {
              select: {
                id: true,
                tradeName: true,
                legalName: true,
                city: true,
                stateCode: true,
              },
            },
            customer: {
              select: {
                id: true,
                legalName: true,
                tradeName: true,
                documentNumber: true,
              },
            },
            /** Todos os equipamentos do atendimento entram no documento. */
            assets: {
              orderBy: { createdAt: 'asc' as const },
              select: {
                asset: {
                  select: {
                    id: true,
                    name: true,
                    manufacturer: true,
                    model: true,
                    serialNumber: true,
                    identifier: true,
                    location: true,
                  },
                },
              },
            },
            customerAddress: {
              select: {
                label: true,
                street: true,
                number: true,
                complement: true,
                district: true,
                city: true,
                stateCode: true,
                postalCode: true,
              },
            },
            responsibleFieldTechnician: {
              select: { id: true, displayName: true },
            },
            startedBy: { select: { id: true, displayName: true } },
            completedBy: { select: { id: true, displayName: true } },
            auxiliaryTechnicians: {
              where: { removedAt: null },
              include: { user: { select: { id: true, displayName: true } } },
              orderBy: { assignedAt: 'asc' },
            },
            history: {
              orderBy: { createdAt: 'asc' },
              select: { action: true, details: true, createdAt: true },
            },
            checklistExecutions: { orderBy: { createdAt: 'asc' } },
            inventoryMovements: {
              orderBy: { createdAt: 'asc' },
              select: {
                quantity: true,
                catalogItem: {
                  select: { id: true, name: true, unit: true },
                },
              },
            },
            fieldEvidence: {
              where: { status: 'FINALIZED' },
              orderBy: [
                { category: 'asc' },
                { capturedAt: 'asc' },
                { id: 'asc' },
              ],
              include: { storageFile: true },
            },
            fieldEvidenceUploads: {
              where: { status: { in: ['PENDING_UPLOAD', 'UPLOADED'] } },
              select: { id: true },
            },
          },
        });
        if (!source) return null;
        const signatoryId =
          source.completedByUserId ??
          source.startedByUserId ??
          source.responsibleFieldTechnicianId;
        const signature = signatoryId
          ? await this.signature(tx, actor.organizationId, signatoryId)
          : null;
        const acknowledgement = await tx.customerAcknowledgement.findFirst({
          where: {
            organizationId: actor.organizationId,
            businessUnitId: source.businessUnitId,
            executionType: 'OPERATION',
            executionId: source.id,
            invalidatedAt: null,
          },
          orderBy: { acknowledgedAt: 'desc' },
        });
        const template = await this.template(tx, actor.organizationId, [
          'ORDEM_SERVICO',
          'SERVICE_OPERATION',
          'OS',
        ]);
        return {
          kind: 'OPERATION' as const,
          source,
          signatoryId,
          signature,
          acknowledgement,
          template,
          permissions,
        };
      }

      if (sourceType === 'RVT_EXECUTION') {
        const source = await tx.rvtExecution.findFirst({
          where: {
            id,
            organizationId: actor.organizationId,
            businessUnitId: { in: [...actor.businessUnitIds] },
          },
          include: {
            occurrence: { include: { configuration: true } },
            equipment: { orderBy: { createdAt: 'asc' } },
            fieldEvidence: {
              where: { status: 'FINALIZED' },
              orderBy: [
                { category: 'asc' },
                { capturedAt: 'asc' },
                { id: 'asc' },
              ],
              include: { storageFile: true },
            },
            fieldEvidenceUploads: {
              where: { status: { in: ['PENDING_UPLOAD', 'UPLOADED'] } },
              select: { id: true },
            },
          },
        });
        if (!source) return null;
        const template = await this.template(tx, actor.organizationId, [
          'RELATORIO_VISITA',
        ]);
        const acknowledgement = await tx.customerAcknowledgement.findFirst({
          where: {
            organizationId: actor.organizationId,
            businessUnitId: source.businessUnitId,
            executionType: 'RVT_EXECUTION',
            executionId: source.id,
            invalidatedAt: null,
          },
          orderBy: { acknowledgedAt: 'desc' },
        });
        return {
          kind: 'RVT_EXECUTION' as const,
          source,
          acknowledgement,
          template,
          permissions,
        };
      }

      const source = await tx.pmocEquipmentExecution.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
        },
        include: { artifactExecution: true },
      });
      return source
        ? { kind: 'PMOC_EQUIPMENT_EXECUTION' as const, source, permissions }
        : null;
    });
  }

  existing(
    actor: MobileFieldActor,
    sourceType: FieldArtifactSourceType,
    sourceId: string,
  ) {
    return this.rls.run((tx) =>
      tx.fieldArtifact.findFirst({
        where: {
          organizationId: actor.organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
          sourceType,
          sourceId,
        },
        include: artifactInclude,
        orderBy: { snapshotVersion: 'desc' },
      }),
    );
  }

  get(actor: MobileFieldActor, id: string) {
    return this.rls.run((tx) =>
      tx.fieldArtifact.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
        },
        include: artifactInclude,
      }),
    );
  }

  async freeze(input: FreezeFieldArtifactInput) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-artifact:${input.sourceType}:${input.sourceId}:${input.documentType}:1`}))`;
      const current = await tx.fieldArtifact.findFirst({
        where: {
          organizationId: input.actor.organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          documentType: input.documentType,
          snapshotVersion: 1,
        },
        include: artifactInclude,
      });
      if (current) return current;

      let executionId = input.existingArtifactExecutionId ?? null;
      if (executionId) {
        const updated = await tx.artifactExecution.updateMany({
          where: {
            id: executionId,
            organizationId: input.actor.organizationId,
            businessUnitId: input.businessUnitId,
          },
          data: {
            context: this.json({
              source: input.sourceType,
              fieldDocumentSnapshot: input.snapshot,
              fieldSnapshotHash: input.snapshotHash,
            }),
          },
        });
        if (updated.count !== 1) executionId = null;
      }

      if (!executionId) {
        const structure = {
          metadata: input.template.version.metadata,
          sections: input.template.version.sections,
          signatureSlots: input.template.version.signatureSlots,
          layout: input.template.version.layout,
        };
        const snapshot = await tx.artifactSnapshot.create({
          data: {
            organizationId: input.actor.organizationId,
            templateId: input.template.id,
            templateVersionId: input.template.version.id,
            templateVersion: input.template.version.version,
            templateKey: input.template.key,
            templateName: input.template.name,
            artifactType: input.template.artifactType,
            segment: input.template.segment,
            metadata: this.json(input.template.version.metadata),
            sections: this.json(input.template.version.sections),
            signatureSlots: this.json(input.template.version.signatureSlots),
            layout: this.json(input.template.version.layout),
            structureHash: this.hash(structure),
          },
        });
        const execution = await tx.artifactExecution.create({
          data: {
            organizationId: input.actor.organizationId,
            businessUnitId: input.businessUnitId,
            operationId: input.operationId,
            customerId: input.customerId,
            assetId: input.assetId,
            templateId: input.template.id,
            snapshotId: snapshot.id,
            responsibleUserId: input.responsibleUserId,
            createdById: input.actor.id,
            code: input.code,
            title: input.title,
            status: 'COMPLETED',
            progress: 100,
            startedAt: input.startedAt,
            completedAt: input.completedAt,
            context: this.json({
              source: input.sourceType,
              fieldDocumentSnapshot: input.snapshot,
              fieldSnapshotHash: input.snapshotHash,
            }),
          },
        });
        executionId = execution.id;
      }

      await tx.artifactExecutionSignature.createMany({
        data: input.snapshot.signatures.map((signature) => ({
          id: generateUuidV7(),
          organizationId: input.actor.organizationId,
          executionId: executionId,
          slotId: signature.slotId,
          signerRole: signature.signerRole,
          signedAs: signature.signedAs,
          userId: signature.userId,
          signerName: signature.signerName,
          signatureData: this.json({
            frozen: true,
            assetId: signature.signatureAssetId,
          }),
          signatureHash: signature.signatureHash,
          signatureAssetId: signature.signatureAssetId,
          signatureAssetHash: signature.signatureHash,
          professionalRole: signature.signedAs,
          credentialType: signature.credentialType,
          credentialNumber: signature.credentialNumber,
          credentialRegion: signature.credentialRegion,
          capturedAt: new Date(signature.signedAt),
          signedAt: new Date(signature.signedAt),
        })),
        skipDuplicates: true,
      });

      const artifact = await tx.fieldArtifact.create({
        data: {
          id: generateUuidV7(),
          organizationId: input.actor.organizationId,
          businessUnitId: input.businessUnitId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          documentType: input.documentType,
          snapshotVersion: 1,
          snapshot: this.json(input.snapshot),
          snapshotHash: input.snapshotHash,
          artifactExecutionId: executionId,
          createdById: input.actor.id,
        },
        include: artifactInclude,
      });
      if (input.operationId)
        await tx.operationHistory.create({
          data: {
            operationId: input.operationId,
            userId: input.actor.id,
            action: 'FIELD_DOCUMENT_PREPARED',
            details: {
              artifactId: artifact.id,
              snapshotHash: input.snapshotHash,
            },
          },
        });
      await tx.auditLog.create({
        data: {
          organizationId: input.actor.organizationId,
          businessUnitId: input.businessUnitId,
          userId: input.actor.id,
          action: 'FIELD_ARTIFACT_PREPARED',
          entityType: 'FIELD_ARTIFACT',
          entityId: artifact.id,
          after: {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            templateVersionId: input.template.version.id,
            snapshotHash: input.snapshotHash,
          },
        },
      });
      return artifact;
    });
  }

  private async template(
    tx: Prisma.TransactionClient,
    organizationId: string,
    types: string[],
  ) {
    const template = await tx.artifactTemplate.findFirst({
      where: {
        artifactType: { in: types },
        status: 'ACTIVE',
        deletedAt: null,
        OR: [
          { organizationId },
          { organizationId: null, visibility: 'GLOBAL' },
        ],
      },
      orderBy: [{ organizationId: 'desc' }, { createdAt: 'asc' }],
    });
    if (!template) return null;
    const version = await tx.artifactTemplateVersion.findUnique({
      where: {
        templateId_version: {
          templateId: template.id,
          version: template.currentVersion,
        },
      },
    });
    return version ? { ...template, version } : null;
  }

  private signature(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
  ) {
    return tx.userSignature.findFirst({
      where: {
        organizationId,
        userId,
        active: true,
        revokedAt: null,
        storageObject: { status: 'AVAILABLE', deletedAt: null },
      },
      include: { storageObject: true, user: { select: { displayName: true } } },
      orderBy: { version: 'desc' },
    });
  }

  private async permissions(
    tx: Prisma.TransactionClient,
    actor: MobileFieldActor,
  ): Promise<string[]> {
    const organization = await tx.organizationMembership.findFirst({
      where: {
        organizationId: actor.organizationId,
        userId: actor.id,
        status: 'ACTIVE',
      },
      select: { role: { select: { permissions: true } } },
    });
    const units = await tx.businessUnitMembership.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: actor.id,
        businessUnitId: { in: [...actor.businessUnitIds] },
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

  private json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
