import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { FieldEvidence } from '@prisma/client';
import {
  BaseException,
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../storage/file-object.service';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES } from '../jobs/background-job.types';
import type { MobileFieldActor } from './mobile-field.service';
import type {
  CreateFieldEvidenceUploadDto,
  FinalizeFieldEvidenceUploadDto,
} from './mobile-evidence.dto';
import {
  evidenceIntentExpiry,
  mobileEvidencePolicy,
} from './mobile-evidence.config';
import { MobileEvidenceRepository } from './mobile-evidence.repository';
import type {
  EvidenceAccessReadModel,
  EvidenceUploadIntentReadModel,
  FieldEvidenceReadModel,
  FieldEvidenceTarget,
} from './mobile-evidence.read-models';

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

type EvidenceWithActor = FieldEvidence & {
  capturedBy: { id: string; displayName: string };
};
type EvidenceTargetRecord = Pick<
  FieldEvidence,
  'operationId' | 'pmocEquipmentExecutionId' | 'rvtExecutionId'
>;

@Injectable()
export class MobileEvidenceService {
  private readonly logger = new Logger(MobileEvidenceService.name);
  constructor(
    private readonly repository: MobileEvidenceRepository,
    private readonly files: FileObjectService,
    private readonly jobs: BackgroundJobQueue,
  ) {}

  async reserve(
    actor: MobileFieldActor,
    input: CreateFieldEvidenceUploadDto,
  ): Promise<EvidenceUploadIntentReadModel> {
    const started = performance.now();
    const filename = this.filename(input.filename);
    const maxSize = this.maxSize(input.declaredMimeType);
    if (input.declaredSize > maxSize) this.tooLarge(maxSize);
    const payloadHash = this.hash({
      target: input.target,
      filename,
      declaredMimeType: input.declaredMimeType,
      declaredSize: input.declaredSize,
      category: input.category ?? 'GENERAL',
      source: input.source ?? 'CAMERA',
      capturedAt: input.capturedAt?.toISOString() ?? null,
      localMediaId: input.localMediaId ?? null,
      expectedSha256: input.expectedSha256?.toLowerCase() ?? null,
    });
    const existing = await this.repository.existingIntent(
      actor.id,
      actor.organizationId,
      input.idempotencyKey,
      input.localMediaId,
    );
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException(
          'A chave de idempotência já foi usada com dados diferentes',
          'IDEMPOTENCY_MISMATCH',
        );
      return this.intent(existing, maxSize);
    }
    const access = await this.repository.authorizeTarget(
      actor,
      input.target.type,
      input.target.id,
    );
    if (!access.context)
      throw new EntityNotFoundException(
        'Destino da evidência',
        input.target.id,
      );
    if (access.denied)
      throw new ForbiddenException(
        'Você não pode adicionar evidências neste atendimento',
      );
    const expiresAt = evidenceIntentExpiry();
    const reserved = await this.files.reserve({
      organizationId: actor.organizationId,
      businessUnitId: access.context.businessUnitId,
      namespace: STORAGE_NAMESPACES.evidence,
      fileName: filename,
      mimeType: input.declaredMimeType,
      sizeBytes: input.declaredSize,
      metadata: {
        purpose: 'FIELD_EVIDENCE',
        targetType: input.target.type,
        uploadExpiresAt: expiresAt.toISOString(),
      },
      createdById: actor.id,
    });
    let upload;
    try {
      upload = await this.repository.createIntent({
        actor,
        target: access.context,
        storageFileId: reserved.file.id,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        localMediaId: input.localMediaId ?? null,
        category: input.category ?? 'GENERAL',
        source: input.source ?? 'CAMERA',
        capturedAt: input.capturedAt ?? null,
        expectedSha256: input.expectedSha256?.toLowerCase() ?? null,
        expiresAt,
      });
    } catch (error) {
      const raced = await this.repository.existingIntent(
        actor.id,
        actor.organizationId,
        input.idempotencyKey,
        input.localMediaId,
      );
      if (!raced || raced.payloadHash !== payloadHash) throw error;
      upload = raced;
    }
    await this.scheduleCleanup(actor);
    this.metric('mobile_evidence_upload_intent_total', started, {
      targetType: input.target.type,
      result: 'CREATED',
    });
    return {
      uploadId: upload.id,
      uploadUrl: reserved.signed.url,
      method: 'PUT',
      requiredHeaders: reserved.signed.requiredHeaders,
      expiresAt: reserved.signed.expiresAt.toISOString(),
      maxSize,
      localMediaId: upload.localMediaId,
      status: upload.status as EvidenceUploadIntentReadModel['status'],
    };
  }

  async finalize(
    actor: MobileFieldActor,
    uploadId: string,
    input: FinalizeFieldEvidenceUploadDto,
  ): Promise<FieldEvidenceReadModel> {
    const started = performance.now();
    const upload = await this.repository.upload(actor, uploadId);
    if (!upload)
      throw new EntityNotFoundException('Upload de evidência', uploadId);
    if (upload.evidence) return this.map(upload.evidence);
    if (upload.status === 'EXPIRED' || upload.expiresAt <= new Date())
      throw new ConflictException(
        'A intenção de upload expirou',
        'UPLOAD_EXPIRED',
      );
    if (
      input.expectedSha256 &&
      upload.expectedSha256 &&
      input.expectedSha256.toLowerCase() !== upload.expectedSha256
    )
      throw new ConflictException(
        'O SHA-256 informado diverge da intenção original',
        'IDEMPOTENCY_MISMATCH',
      );

    try {
      const confirmed = await this.files.confirm(
        upload.storageFileId,
        actor.organizationId,
      );
      const body = await this.files.read(confirmed.bucket, confirmed.objectKey);
      const actualMime = this.sniff(body);
      const actualSha = FileObjectService.hash(body);
      const expected =
        input.expectedSha256?.toLowerCase() ?? upload.expectedSha256;
      if (!actualMime || !ALLOWED_MIMES.includes(actualMime))
        return await this.reject(
          actor,
          uploadId,
          'INVALID_MIME',
          'O arquivo enviado não possui um formato permitido',
        );
      if (actualMime !== upload.storageFile.mimeType)
        return await this.reject(
          actor,
          uploadId,
          'MIME_MISMATCH',
          'O conteúdo real não corresponde ao tipo de arquivo declarado',
        );
      const maxSize = this.maxSize(actualMime);
      if (body.length > maxSize) {
        await this.repository.markFailed(actor, uploadId, 'FILE_TOO_LARGE');
        this.tooLarge(maxSize);
      }
      if (BigInt(body.length) !== upload.storageFile.sizeBytes)
        return await this.reject(
          actor,
          uploadId,
          'SIZE_MISMATCH',
          'O tamanho real não corresponde ao tamanho declarado',
        );
      if (expected && actualSha !== expected)
        return await this.reject(
          actor,
          uploadId,
          'SHA256_MISMATCH',
          'O SHA-256 do arquivo enviado não corresponde ao esperado',
        );
      const result = await this.repository.finalize(actor, uploadId, {
        sizeBytes: BigInt(body.length),
        sha256: actualSha,
        mimeType: actualMime,
      });
      if (result.kind === 'NOT_FOUND')
        throw new EntityNotFoundException('Destino da evidência');
      if (result.kind === 'DENIED')
        throw new ForbiddenException(
          'A autorização para adicionar esta evidência não está mais válida',
        );
      if (result.kind === 'LIMIT')
        throw new ConflictException(
          `O limite de ${result.maximum} evidências foi atingido`,
          'EVIDENCE_LIMIT_REACHED',
        );
      this.metric('mobile_evidence_finalize_total', started, {
        sizeBytes: body.length,
        result: 'FINALIZED',
      });
      return this.map(result.evidence);
    } catch (error) {
      this.metric('mobile_evidence_finalize_failed_total', started, {
        result: 'FAILED',
      });
      throw error;
    }
  }

  async list(
    actor: MobileFieldActor,
    type: FieldEvidenceTarget,
    targetId: string,
    limit: number,
  ) {
    const values = await this.repository.list(actor, type, targetId, limit);
    if (!values)
      throw new EntityNotFoundException('Destino da evidência', targetId);
    return { items: values.map((value) => this.map(value)), limit };
  }

  async access(
    actor: MobileFieldActor,
    evidenceId: string,
    operation: 'preview' | 'download',
  ): Promise<EvidenceAccessReadModel> {
    const evidence = await this.repository.evidence(actor, evidenceId);
    if (!evidence) throw new EntityNotFoundException('Evidência', evidenceId);
    const access = await this.repository.authorizeTarget(
      actor,
      this.targetType(evidence),
      this.targetId(evidence),
    );
    if (!access.context || access.denied)
      throw new EntityNotFoundException('Evidência', evidenceId);
    const signed = await this.files.sign(evidence.storageFile, operation);
    return {
      evidenceId,
      operation,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      requiredHeaders: signed.requiredHeaders,
    };
  }

  private async reject(
    actor: MobileFieldActor,
    uploadId: string,
    code: string,
    message: string,
  ): Promise<never> {
    await this.repository.markFailed(actor, uploadId, code);
    throw new ValidationException(message, { reason: code });
  }

  private async intent(
    upload: {
      id: string;
      status: string;
      expiresAt: Date;
      localMediaId: string | null;
      storageFile: {
        bucket: string;
        objectKey: string;
        fileName: string;
        mimeType: string;
      };
    },
    maxSize: number,
  ): Promise<EvidenceUploadIntentReadModel> {
    if (upload.status === 'FINALIZED')
      return {
        uploadId: upload.id,
        uploadUrl: null,
        method: null,
        requiredHeaders: {},
        expiresAt: upload.expiresAt.toISOString(),
        maxSize,
        localMediaId: upload.localMediaId,
        status: 'FINALIZED',
      };
    const signed = await this.files.sign(upload.storageFile, 'upload');
    return {
      uploadId: upload.id,
      uploadUrl: signed.url,
      method: 'PUT',
      requiredHeaders: signed.requiredHeaders,
      expiresAt: signed.expiresAt.toISOString(),
      maxSize,
      localMediaId: upload.localMediaId,
      status: upload.status as EvidenceUploadIntentReadModel['status'],
    };
  }

  private map(value: EvidenceWithActor): FieldEvidenceReadModel {
    return {
      id: value.id,
      target: { type: this.targetType(value), id: this.targetId(value) },
      category: value.category as FieldEvidenceReadModel['category'],
      filename: value.fileName,
      mimeType: value.mimeType,
      sizeBytes: value.sizeBytes.toString(),
      sha256: value.sha256,
      capturedAt: value.capturedAt?.toISOString() ?? null,
      uploadedAt: value.uploadedAt.toISOString(),
      capturedBy: {
        id: value.capturedBy.id,
        name: value.capturedBy.displayName,
      },
      source: value.source as FieldEvidenceReadModel['source'],
      localMediaId: value.localMediaId,
      previewAvailable: value.mimeType.startsWith('image/'),
      downloadAvailable: true,
    };
  }

  private filename(raw: string): string {
    const value = basename(raw.replaceAll('\\', '/'))
      .normalize('NFC')
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127 && !'<>"\''.includes(character);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (!value || value === '.' || value === '..')
      throw new ValidationException('Nome de arquivo inválido');
    return value;
  }

  private sniff(body: Buffer): (typeof ALLOWED_MIMES)[number] | null {
    if (
      body.length >= 8 &&
      body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return 'image/png';
    if (
      body.length >= 3 &&
      body[0] === 0xff &&
      body[1] === 0xd8 &&
      body[2] === 0xff
    )
      return 'image/jpeg';
    if (
      body.length >= 12 &&
      body.toString('ascii', 0, 4) === 'RIFF' &&
      body.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'image/webp';
    if (body.length >= 5 && body.toString('ascii', 0, 5) === '%PDF-')
      return 'application/pdf';
    return null;
  }

  private maxSize(mime: string): number {
    const policy = mobileEvidencePolicy();
    return mime === 'application/pdf'
      ? policy.documentMaxBytes
      : policy.imageMaxBytes;
  }

  private tooLarge(max: number): never {
    throw new BaseException(
      {
        code: 'PAYLOAD_TOO_LARGE',
        message: `O arquivo excede o limite de ${max} bytes`,
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  private targetType(value: EvidenceTargetRecord): FieldEvidenceTarget {
    return value.operationId
      ? 'OPERATION'
      : value.pmocEquipmentExecutionId
        ? 'PMOC_EQUIPMENT_EXECUTION'
        : 'RVT_EXECUTION';
  }
  private targetId(value: EvidenceTargetRecord): string {
    const id =
      value.operationId ??
      value.pmocEquipmentExecutionId ??
      value.rvtExecutionId;
    if (!id) throw new Error('FieldEvidence sem target íntegro');
    return id;
  }
  private hash(value: unknown): string {
    return createHash('sha256').update(this.canonical(value)).digest('hex');
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
  private async scheduleCleanup(actor: MobileFieldActor): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.jobs.enqueue({
      queue: JOB_QUEUES.mobileEvidenceCleanup,
      jobKey: `mobile-evidence-cleanup:${actor.id}:${day}`,
      organizationId: actor.organizationId,
      scope: 'ORGANIZATION',
      businessUnitIds: actor.businessUnitIds,
      payload: {},
      correlationId: `mobile-evidence-cleanup:${day}`,
      actorUserId: actor.id,
      maxAttempts: 5,
    });
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
