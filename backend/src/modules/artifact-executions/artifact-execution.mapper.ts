import { Injectable } from '@nestjs/common';
import type {
  ArtifactExecutionAttachmentReadModel,
  ArtifactExecutionInsightReadModel,
  ArtifactExecutionListItemReadModel,
  ArtifactExecutionListReadModel,
  ArtifactExecutionReadModel,
  ArtifactExecutionResponseReadModel,
  ArtifactExecutionSignatureReadModel,
  ArtifactSnapshotReadModel,
  ArtifactRenderStatus,
} from './artifact-execution.read-models';
import { ArtifactExecutionProgressCalculator } from './artifact-execution.progress';

type DateValue = Date | string;
interface SnapshotSource {
  id: string;
  templateId: string;
  templateVersion: number;
  templateKey: string;
  templateName: string;
  artifactType: string;
  segment: string | null;
  metadata: unknown;
  sections: unknown;
  signatureSlots: unknown;
  layout: unknown;
  structureHash: string;
  createdAt: DateValue;
}
interface ResponseSource {
  id: string;
  sectionId: string;
  fieldId: string;
  value: unknown;
  valueType: string;
  unit: string | null;
  validations: unknown;
  provenance: string;
  notes: string | null;
  answeredById: string | null;
  answeredAt: DateValue;
  updatedAt: DateValue;
}
interface AttachmentSource {
  id: string;
  responseId: string | null;
  sectionId: string | null;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint | number | string;
  storageKey: string;
  checksum: string | null;
  metadata: unknown;
  uploadedById: string;
  createdAt: DateValue;
}
interface SignatureSource {
  id: string;
  slotId: string;
  signerRole: string;
  signedAs: string | null;
  userId: string | null;
  signerName: string;
  signerDocument: string | null;
  signatureHash: string;
  signatureAssetHash: string | null;
  professionalRole: string | null;
  credentialType: string | null;
  credentialNumber: string | null;
  credentialRegion: string | null;
  capturedAt: DateValue | null;
  consentText: string | null;
  geolocation: unknown;
  signedAt: DateValue;
  revokedAt: DateValue | null;
}
interface InsightSource {
  id: string;
  kind: string;
  severity: string;
  source: string;
  title: string;
  description: string;
  payload: unknown;
  resolvedAt: DateValue | null;
  createdAt: DateValue;
}
interface ExecutionSource {
  renderStatus: string;
  id: string;
  organizationId: string;
  businessUnitId: string;
  operationId: string | null;
  customerId: string | null;
  assetId: string | null;
  templateId: string;
  snapshotId: string;
  responsibleUserId: string | null;
  createdById: string;
  code: string;
  title: string;
  status: string;
  progress: number;
  scheduledStart: DateValue | null;
  scheduledEnd: DateValue | null;
  startedAt: DateValue | null;
  pausedAt: DateValue | null;
  submittedAt: DateValue | null;
  approvedAt: DateValue | null;
  completedAt: DateValue | null;
  archivedAt: DateValue | null;
  notes: string | null;
  context: unknown;
  createdAt: DateValue;
  updatedAt: DateValue;
  snapshot?: SnapshotSource;
  team?: readonly { userId: string; role: string; assignedAt: DateValue }[];
  responses?: readonly ResponseSource[];
  attachments?: readonly AttachmentSource[];
  signatures?: readonly SignatureSource[];
  insights?: readonly InsightSource[];
}

@Injectable()
export class ArtifactExecutionReadModelMapper {
  constructor(private readonly progress: ArtifactExecutionProgressCalculator) {}

  list(source: {
    data: readonly ExecutionSource[];
    meta: ArtifactExecutionListReadModel['meta'];
  }): ArtifactExecutionListReadModel {
    return {
      data: source.data.map((item) => this.listItem(item)),
      meta: { ...source.meta },
    };
  }

  listItem(source: ExecutionSource): ArtifactExecutionListItemReadModel {
    return {
      id: source.id,
      organizationId: source.organizationId,
      businessUnitId: source.businessUnitId,
      operationId: source.operationId,
      customerId: source.customerId,
      assetId: source.assetId,
      templateId: source.templateId,
      snapshotId: source.snapshotId,
      responsibleUserId: source.responsibleUserId,
      code: source.code,
      title: source.title,
      status: source.status,
      /**
       * Estado real desde a PR-20.
       *
       * Até então o campo era uma constante — não havia motor de renderização,
       * e o contrato existia para os clientes já tratarem o ciclo. Agora a
       * coluna é persistida e este é o valor que o backend decidiu.
       */
      renderStatus: source.renderStatus as ArtifactRenderStatus,
      progress: source.progress,
      scheduledStart: this.nullableDate(source.scheduledStart),
      scheduledEnd: this.nullableDate(source.scheduledEnd),
      startedAt: this.nullableDate(source.startedAt),
      completedAt: this.nullableDate(source.completedAt),
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }

  details(source: ExecutionSource): ArtifactExecutionReadModel {
    if (!source.snapshot)
      throw new Error('Artifact execution snapshot is missing');
    const responses = (source.responses ?? []).map((item) =>
      this.response(item),
    );
    const signatures = (source.signatures ?? []).map((item) =>
      this.signature(item),
    );
    return {
      ...this.listItem(source),
      createdById: source.createdById,
      pausedAt: this.nullableDate(source.pausedAt),
      submittedAt: this.nullableDate(source.submittedAt),
      approvedAt: this.nullableDate(source.approvedAt),
      archivedAt: this.nullableDate(source.archivedAt),
      notes: source.notes,
      context: this.object(source.context),
      team: (source.team ?? []).map((member) => ({
        userId: member.userId,
        role: member.role,
        assignedAt: this.date(member.assignedAt),
      })),
      snapshot: this.snapshot(source.snapshot),
      responses,
      attachments: (source.attachments ?? []).map((item) =>
        this.attachment(item),
      ),
      signatures,
      insights: (source.insights ?? []).map((item) => this.insight(item)),
      progressDetails: this.progress.calculate(
        source.snapshot.sections,
        source.snapshot.signatureSlots,
        responses,
        signatures,
      ),
    };
  }

  snapshot(source: SnapshotSource): ArtifactSnapshotReadModel {
    const layout = this.object(source.layout);
    return {
      id: source.id,
      templateId: source.templateId,
      templateVersion: source.templateVersion,
      templateKey: source.templateKey,
      templateName: source.templateName,
      artifactType: source.artifactType,
      segment: source.segment,
      metadata: this.object(source.metadata),
      sections: this.array(
        source.sections,
      ) as ArtifactSnapshotReadModel['sections'],
      signatureSlots: this.array(
        source.signatureSlots,
      ) as ArtifactSnapshotReadModel['signatureSlots'],
      layout: {
        ...layout,
        reusableBlocks: this.array(layout.reusableBlocks),
      } as ArtifactSnapshotReadModel['layout'],
      structureHash: source.structureHash,
      createdAt: this.date(source.createdAt),
    };
  }

  private response(source: ResponseSource): ArtifactExecutionResponseReadModel {
    return {
      ...source,
      validations: this.array(source.validations) as Record<string, unknown>[],
      answeredAt: this.date(source.answeredAt),
      updatedAt: this.date(source.updatedAt),
    };
  }
  private attachment(
    source: AttachmentSource,
  ): ArtifactExecutionAttachmentReadModel {
    return {
      ...source,
      sizeBytes: String(source.sizeBytes),
      metadata: this.object(source.metadata),
      createdAt: this.date(source.createdAt),
    };
  }
  private signature(
    source: SignatureSource,
  ): ArtifactExecutionSignatureReadModel {
    return {
      id: source.id,
      slotId: source.slotId,
      signerRole: source.signerRole,
      signedAs:
        source.signedAs as ArtifactExecutionSignatureReadModel['signedAs'],
      userId: source.userId,
      signerName: source.signerName,
      signerDocument: source.signerDocument,
      signatureHash: source.signatureHash,
      signatureAssetHash: source.signatureAssetHash,
      professionalRole: source.professionalRole,
      professionalCredential:
        source.credentialType && source.credentialNumber
          ? {
              type: source.credentialType,
              registrationNumber: source.credentialNumber,
              region: source.credentialRegion,
            }
          : null,
      capturedAt: this.nullableDate(source.capturedAt),
      consentText: source.consentText,
      geolocation: source.geolocation ? this.object(source.geolocation) : null,
      signedAt: this.date(source.signedAt),
      revokedAt: this.nullableDate(source.revokedAt),
    };
  }
  private insight(source: InsightSource): ArtifactExecutionInsightReadModel {
    return {
      ...source,
      payload: this.object(source.payload),
      resolvedAt: this.nullableDate(source.resolvedAt),
      createdAt: this.date(source.createdAt),
    };
  }
  private object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
  private array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
  private date(value: DateValue): string {
    return value instanceof Date ? value.toISOString() : value;
  }
  private nullableDate(value: DateValue | null): string | null {
    return value ? this.date(value) : null;
  }
}
