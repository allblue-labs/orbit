import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  BusinessException,
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { ArtifactExecutionReadModelMapper } from './artifact-execution.mapper';
import { ArtifactExecutionPolicy } from './artifact-execution.policy';
import { ArtifactExecutionProgressCalculator } from './artifact-execution.progress';
import type {
  ArtifactExecutionListReadModel,
  ArtifactExecutionReadModel,
  ArtifactExecutionProgressReadModel,
} from './artifact-execution.read-models';
import { ArtifactExecutionRepository } from './artifact-execution.repository';
import { ArtifactExecutionStateMachine } from './artifact-execution.state-machine';
import { ArtifactExecutionValidator } from './artifact-execution.validator';
import type {
  ArtifactExecutionQueryDto,
  ChangeArtifactExecutionStatusDto,
  CollectArtifactSignatureDto,
  CreateArtifactExecutionDto,
  RegisterArtifactAttachmentDto,
  SaveArtifactResponseDto,
  UpdateArtifactExecutionDto,
} from './dto/artifact-execution.dto';
import { WorkforceRepository } from '../workforce/workforce.repository';
import {
  ProfessionalSignatoryPolicy,
  type DocumentType,
} from '../workforce/professional-signatory.policy';
import {
  EntitlementService,
  documentUsageResource,
} from '../subscription-plans/entitlements';

@Injectable()
export class ArtifactExecutionService {
  constructor(
    private readonly repository: ArtifactExecutionRepository,
    private readonly mapper: ArtifactExecutionReadModelMapper,
    private readonly validator: ArtifactExecutionValidator,
    private readonly stateMachine: ArtifactExecutionStateMachine,
    private readonly policy: ArtifactExecutionPolicy,
    private readonly progress: ArtifactExecutionProgressCalculator,
    private readonly workforce: WorkforceRepository,
    private readonly signatoryPolicy: ProfessionalSignatoryPolicy,
    private readonly entitlements: EntitlementService,
  ) {}

  async list(
    organizationId: string,
    query: ArtifactExecutionQueryDto,
  ): Promise<ArtifactExecutionListReadModel> {
    return this.mapper.list(await this.repository.list(organizationId, query));
  }

  async get(
    id: string,
    organizationId: string,
  ): Promise<ArtifactExecutionReadModel> {
    return this.mapper.details(await this.source(id, organizationId));
  }

  async create(
    organizationId: string,
    actorId: string,
    input: CreateArtifactExecutionDto,
  ): Promise<ArtifactExecutionReadModel> {
    this.validator.schedule(input.scheduledStart, input.scheduledEnd);
    try {
      return this.mapper.details(
        await this.repository.create(organizationId, actorId, {
          ...input,
          code: input.code.trim().toUpperCase(),
        }),
      );
    } catch (error) {
      this.mapPersistence(error);
    }
  }

  async update(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateArtifactExecutionDto,
  ): Promise<ArtifactExecutionReadModel> {
    const current = await this.source(id, organizationId);
    this.policy.assertEditable(current.status);
    this.validator.schedule(
      input.scheduledStart ?? this.iso(current.scheduledStart),
      input.scheduledEnd ?? this.iso(current.scheduledEnd),
    );
    try {
      return this.mapper.details(
        await this.repository.update(id, organizationId, actorId, input),
      );
    } catch (error) {
      this.mapPersistence(error);
    }
  }

  async changeStatus(
    id: string,
    organizationId: string,
    actorId: string,
    input: ChangeArtifactExecutionStatusDto,
  ): Promise<ArtifactExecutionReadModel> {
    const current = await this.source(id, organizationId);
    this.stateMachine.assertTransition(current.status, input.status);
    const progress = this.calculate(current);
    if (
      (input.status === 'UNDER_REVIEW' || input.status === 'COMPLETED') &&
      !progress.canComplete
    ) {
      throw new BusinessException(
        'Required fields and signatures must be completed first',
        'ARTIFACT_EXECUTION_INCOMPLETE',
      );
    }
    if (input.status !== 'COMPLETED') {
      return this.mapper.details(
        await this.repository.status(id, organizationId, actorId, input.status),
      );
    }

    /**
     * Concluir é emitir — e é aqui, uma única vez, que o documento custa cota.
     *
     * A identidade é a própria execução: renderizar de novo, tentar de novo
     * depois de uma falha, ou baixar o PDF outra vez não passam por aqui, e o
     * índice único do razão recusa a segunda contagem mesmo que passassem. A
     * concessão e a transição estão na mesma transação: cota estourada não
     * deixa documento concluído para trás.
     *
     * O documento da ordem de serviço é a exceção declarada: a ordem já foi
     * cobrada ao ser criada, e cobrar o papel dela de novo seria contar o
     * mesmo atendimento duas vezes.
     */
    const cota = documentUsageResource(current.snapshot.artifactType);
    if (cota === null) {
      return this.mapper.details(
        await this.repository.status(id, organizationId, actorId, input.status),
      );
    }

    return this.mapper.details(
      await this.entitlements.guardUsage(
        organizationId,
        cota,
        (concluida: { id: string }) => ({
          type: 'ARTIFACT_EXECUTION',
          id: concluida.id,
        }),
        () => this.repository.status(id, organizationId, actorId, input.status),
      ),
    );
  }

  async saveResponse(
    id: string,
    organizationId: string,
    actorId: string,
    input: SaveArtifactResponseDto,
  ): Promise<ArtifactExecutionReadModel> {
    const current = await this.source(id, organizationId);
    this.policy.assertEditable(current.status);
    const field = this.validator.field(
      current.snapshot.sections,
      input.sectionId,
      input.fieldId,
    );
    const updated = await this.repository.saveResponse(
      id,
      organizationId,
      actorId,
      input,
      field,
    );
    return this.mapper.details(
      await this.repository.updateProgress(
        id,
        this.calculate(updated).percentage,
      ),
    );
  }

  async registerAttachment(
    id: string,
    organizationId: string,
    actorId: string,
    input: RegisterArtifactAttachmentDto,
  ): Promise<ArtifactExecutionReadModel> {
    const current = await this.source(id, organizationId);
    this.policy.assertEditable(current.status);
    if (!input.responseId && !input.sectionId) {
      // no target means execution-level attachment, which is valid
    } else if (input.sectionId) {
      const sections = Array.isArray(current.snapshot.sections)
        ? (current.snapshot.sections as { id?: string }[])
        : [];
      if (!sections.some((section) => section.id === input.sectionId))
        throw new ValidationException(
          'Attachment section does not exist in the snapshot',
        );
    }
    try {
      return this.mapper.details(
        await this.repository.registerAttachment(
          id,
          organizationId,
          actorId,
          input,
        ),
      );
    } catch (error) {
      this.mapPersistence(error);
    }
  }

  async collectSignature(
    id: string,
    organizationId: string,
    actorId: string,
    input: CollectArtifactSignatureDto,
  ): Promise<ArtifactExecutionReadModel> {
    const current = await this.source(id, organizationId);
    this.policy.assertEditable(current.status);
    const slot = this.validator.signatureSlot(
      current.snapshot.signatureSlots,
      input.slotId,
    );
    const signedAs = input.signedAs ?? this.signedAsFor(slot.signerRole);
    const documentType = this.documentType(current.snapshot.artifactType);
    let signatorySnapshot:
      | Parameters<ArtifactExecutionRepository['collectSignature']>[6]
      | undefined;
    let normalizedInput = input;
    if (signedAs === 'CUSTOMER') {
      normalizedInput = { ...input, signedAs };
    } else {
      if (!input.userId)
        throw new ValidationException('Professional signer userId is required');
      const profile = await this.workforce.findProfessionalProfile(
        organizationId,
        input.userId,
      );
      const signature = await this.workforce.activeSignature(
        organizationId,
        input.userId,
      );
      const roleEnabled =
        signedAs === 'FIELD_TECHNICIAN'
          ? profile?.fieldTechnicianEnabled
          : profile?.technicalResponsibleEnabled;
      const inScope = (
        await this.workforce.listProfessionals(
          organizationId,
          signedAs,
          current.businessUnitId,
        )
      ).some((item) => item.userId === input.userId);
      if (!profile?.active || !roleEnabled || !inScope)
        throw new ValidationException(
          'Signer is not eligible for this professional role and scope',
        );
      if (!documentType || !this.signatoryPolicy.allows(documentType, signedAs))
        throw new ValidationException(
          'Professional role is not allowed by the document policy',
        );
      if (!signature)
        throw new BusinessException(
          'Professional signature is required',
          'SIGNATURE_MISSING',
        );
      const credential = profile.credentials[0];
      signatorySnapshot = {
        signedAs,
        signatureAssetId: signature.storageObjectId,
        signatureAssetHash: signature.sha256,
        professionalRole: signedAs,
        credentialType: credential?.type,
        credentialNumber: credential?.registrationNumber,
        credentialRegion: credential?.region ?? undefined,
        capturedAt: new Date(),
      };
      normalizedInput = {
        ...input,
        signedAs,
        signerName: profile.user.displayName,
        signatureData: {
          storageObjectId: signature.storageObjectId,
          sha256: signature.sha256,
          version: signature.version,
        },
      };
    }
    const signatureHash = createHash('sha256')
      .update(JSON.stringify(normalizedInput.signatureData))
      .digest('hex');
    try {
      const updated = await this.repository.collectSignature(
        id,
        organizationId,
        actorId,
        normalizedInput,
        slot.signerRole,
        signatureHash,
        signatorySnapshot,
      );
      return this.mapper.details(
        await this.repository.updateProgress(
          id,
          this.calculate(updated).percentage,
        ),
      );
    } catch (error) {
      this.mapPersistence(error);
    }
  }

  private signedAsFor(
    signerRole: string,
  ): 'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE' | 'CUSTOMER' {
    if (signerRole === 'CUSTOMER') return 'CUSTOMER';
    if (['TECHNICAL_MANAGER', 'TECHNICAL_RESPONSIBLE'].includes(signerRole))
      return 'TECHNICAL_RESPONSIBLE';
    return 'FIELD_TECHNICIAN';
  }

  private documentType(artifactType: string): DocumentType | null {
    const mapping: Record<string, DocumentType> = {
      ORDEM_SERVICO: 'SERVICE_ORDER',
      RELATORIO_VISITA: 'RVT',
      PMOC: 'PMOC',
      RELATORIO_TECNICO: 'TECHNICAL_REPORT',
      QUALIDADE_AR: 'TECHNICAL_REPORT',
      RECIBO: 'RECEIPT',
    };
    return mapping[artifactType] ?? null;
  }

  async progressOf(
    id: string,
    organizationId: string,
  ): Promise<ArtifactExecutionProgressReadModel> {
    const current = await this.source(id, organizationId);
    const progress = this.calculate(current);
    if (progress.percentage !== current.progress)
      await this.repository.updateProgress(id, progress.percentage);
    return progress;
  }

  private calculate(
    source: Awaited<ReturnType<ArtifactExecutionRepository['find']>>,
  ) {
    if (!source) throw new EntityNotFoundException('Artifact execution');
    return this.progress.calculate(
      source.snapshot.sections,
      source.snapshot.signatureSlots,
      source.responses,
      source.signatures,
    );
  }
  private async source(id: string, organizationId: string) {
    const execution = await this.repository.find(id, organizationId);
    if (!execution) throw new EntityNotFoundException('Artifact execution', id);
    return execution;
  }
  private iso(value: Date | null): string | undefined {
    return value?.toISOString();
  }
  private mapPersistence(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        throw new ConflictException(
          'Execution code, response, signature or storage key already exists',
        );
      if (error.code === 'P2025')
        throw new ValidationException(
          'A related tenant resource was not found or is inaccessible',
        );
    }
    if (
      error instanceof Error &&
      error.message.includes('active organization members')
    )
      throw new ValidationException(error.message);
    throw error;
  }
}
