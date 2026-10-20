import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../storage/file-object.service';
import { STORAGE_CONFIG, type StorageConfig } from '../storage/storage.config';
import { detectImageMime } from '../storage/image-signature';
import type { MobileFieldActor } from './mobile-field.service';
import type {
  CustomerAcknowledgementInputDto,
  MobileSignaturePreviewQueryDto,
  MobileSignatureUploadDto,
  MobileSignatureUploadReservationDto,
} from './mobile-signature.dto';
import type {
  CustomerAcknowledgementPreparationReadModel,
  CustomerAcknowledgementResultReadModel,
  MobileProfessionalRole,
  MobileSignatureStatusReadModel,
  MobileSignatureUploadResultReadModel,
  MobileSignatureUploadReservationReadModel,
} from './mobile-signature.read-models';
import { MobileSignatureRepository } from './mobile-signature.repository';

/**
 * Onde cada cliente busca a prévia da assinatura.
 *
 * ## Por que são dois caminhos, e por que o parâmetro é obrigatório
 *
 * A mesma assinatura é servida por dois controllers: o do aplicativo de campo e
 * o do perfil na Web. A URL assinada tem de apontar para **o caminho de quem
 * perguntou** — a rota do mobile exige contexto de campo, e o proxy da Web
 * encaminha o caminho do perfil.
 *
 * O parâmetro tinha valor padrão (`MOBILE_PREVIEW_PATH`), e só `status` o
 * sobrescrevia. `upload` e `revoke` caíam no padrão em silêncio: logo depois de
 * cadastrar a assinatura pela Web, a resposta trazia o caminho do mobile, a tela
 * atualizava o cache com ele e a imagem não carregava. Recarregar a página
 * consertava, porque aí o `GET` respondia — o que fazia o defeito parecer
 * intermitente.
 *
 * Sem padrão, esquecer virou erro de compilação.
 */
export const MOBILE_PREVIEW_PATH = '/api/v1/mobile/field/me/signature/preview';

/** Onde a tela de perfil busca a mesma prévia. */
export const PROFILE_PREVIEW_PATH = '/api/v1/identity/me/signature/preview';

@Injectable()
export class MobileSignatureService {
  private readonly logger = new Logger(MobileSignatureService.name);
  constructor(
    private readonly repository: MobileSignatureRepository,
    private readonly files: FileObjectService,
    @Inject(STORAGE_CONFIG) private readonly storageConfig: StorageConfig,
  ) {}

  /**
   * `basePath` diz por onde a prévia será buscada.
   *
   * A mesma assinatura é consultada pelo aplicativo de campo e pela tela de
   * perfil, e cada um alcança o servidor por um caminho: o proxy da Web não
   * encaminha `mobile/field`, de propósito. Devolver sempre o caminho do
   * aplicativo fazia a Web receber um endereço que não conseguia abrir — a
   * tela dizia "assinatura cadastrada" e não mostrava imagem nenhuma.
   */
  async status(
    actor: MobileFieldActor,
    basePath: string,
  ): Promise<MobileSignatureStatusReadModel> {
    const context = await this.requireMember(actor);
    const signature = context.signature;
    return {
      signatureAvailable: Boolean(signature),
      version: signature?.version ?? null,
      updatedAt: signature?.updatedAt.toISOString() ?? null,
      roles: this.roles(context.profile),
      preview: signature
        ? this.preview(
            actor,
            signature.storageObject,
            signature.sha256,
            basePath,
          )
        : null,
    };
  }

  async upload(
    actor: MobileFieldActor,
    input: MobileSignatureUploadDto,
    basePath: string,
  ): Promise<MobileSignatureUploadResultReadModel> {
    const context = await this.requireMember(actor);
    const reserved = await this.repository.signatureUploadFile(
      actor.organizationId,
      input.storageObjectId,
    );
    if (!reserved || reserved.createdById !== actor.id)
      throw new EntityNotFoundException('StorageFile', input.storageObjectId);
    await this.files.confirm(input.storageObjectId, actor.organizationId);
    const file = await this.repository.storageFile(
      actor.organizationId,
      input.storageObjectId,
    );
    if (!file || file.createdById !== actor.id || !file.sha256)
      throw new ValidationException(
        'O arquivo de assinatura deve pertencer ao usuário autenticado e estar disponível',
      );
    if (file.sizeBytes > 2_000_000n)
      throw new ValidationException(
        'A assinatura deve ter no máximo 2 MB',
        undefined,
        'FILE_TOO_LARGE',
      );
    const body = await this.files.read(file.bucket, file.objectKey);
    const detected = detectImageMime(body);
    if (!detected || detected !== file.mimeType)
      throw new ValidationException(
        'O conteúdo da assinatura deve ser PNG, JPEG ou WEBP válido',
        undefined,
        'FILE_INVALID',
      );
    if (body.length > 2_000_000 || this.sha(body) !== file.sha256)
      throw new ValidationException(
        'O conteúdo da assinatura não corresponde ao arquivo confirmado',
      );
    const replaced = await this.repository.replace(
      actor.organizationId,
      actor.id,
      file.id,
      file.sha256,
    );
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_signature_upload_total',
      }),
    );
    return {
      signatureAvailable: true,
      version: replaced.signature.version,
      updatedAt: replaced.signature.updatedAt.toISOString(),
      roles: this.roles(context.profile),
      preview: this.preview(actor, file, file.sha256, basePath),
      replacedVersion: replaced.replacedVersion,
    };
  }

  async reserveUpload(
    actor: MobileFieldActor,
    input: MobileSignatureUploadReservationDto,
  ): Promise<MobileSignatureUploadReservationReadModel> {
    await this.requireMember(actor);
    const { file, signed } = await this.files.reserve({
      organizationId: actor.organizationId,
      businessUnitId: null,
      namespace: STORAGE_NAMESPACES.signature,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      metadata: {
        purpose: input.purpose ?? 'PROFESSIONAL_SIGNATURE',
        ownerUserId: actor.id,
      },
      createdById: actor.id,
    });
    return {
      fileId: file.id,
      upload: {
        url: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
        method: 'PUT',
        requiredHeaders: signed.requiredHeaders,
      },
    };
  }

  async revoke(
    actor: MobileFieldActor,
  ): Promise<MobileSignatureStatusReadModel> {
    const context = await this.requireMember(actor);
    await this.repository.revoke(actor.organizationId, actor.id);
    return {
      signatureAvailable: false,
      version: null,
      updatedAt: null,
      roles: this.roles(context.profile),
      preview: null,
    };
  }

  /**
   * Entrega os bytes da assinatura ativa, nunca de um StorageFile indicado
   * pelo cliente. O grant é vinculado ao ator autenticado e não carrega
   * bucket, object key ou ID interno.
   */
  async previewBytes(
    actor: MobileFieldActor,
    query: MobileSignaturePreviewQueryDto,
  ): Promise<{ body: Buffer; mimeType: string }> {
    const context = await this.requireMember(actor);
    const signature = context.signature;
    if (
      !signature ||
      !this.previewable(signature.storageObject, signature.sha256) ||
      !this.validPreviewGrant(
        actor,
        query.expires,
        query.signature,
        signature.sha256,
      )
    ) {
      throw new ForbiddenException(
        'A prévia da assinatura expirou ou não é válida',
        'SIGNATURE_PREVIEW_INVALID',
      );
    }
    const file = signature.storageObject;
    const body = await this.files.read(file.bucket, file.objectKey);
    if (
      body.length !== Number(file.sizeBytes) ||
      this.sha(body) !== signature.sha256 ||
      detectImageMime(body) !== file.mimeType
    ) {
      throw new EntityNotFoundException('UserSignature', actor.id);
    }
    return { body, mimeType: file.mimeType };
  }

  async acknowledgementPreparation(
    actor: MobileFieldActor,
    operationId: string,
  ): Promise<CustomerAcknowledgementPreparationReadModel> {
    const operation = await this.visibleOperation(actor, operationId);
    const summary = this.summary(operation);
    const existing = await this.repository.acknowledgement(
      actor.organizationId,
      operationId,
    );
    return {
      ...summary,
      existingAcknowledgement: existing
        ? {
            signerName: existing.signerName,
            acknowledgedAt: existing.acknowledgedAt.toISOString(),
            hasSignature: Boolean(existing.signatureStorageFileId),
          }
        : null,
      contentVersion: operation.updatedAt.toISOString(),
      contentHash: this.hash(summary),
    };
  }

  async acknowledge(
    actor: MobileFieldActor,
    operationId: string,
    input: CustomerAcknowledgementInputDto,
  ): Promise<CustomerAcknowledgementResultReadModel> {
    const operation = await this.visibleOperation(actor, operationId);
    const summary = this.summary(operation);
    const currentHash = this.hash(summary);
    if (
      input.expectedVersion !== operation.updatedAt.toISOString() ||
      input.contentHash !== currentHash
    ) {
      this.conflictMetric();
      throw new ConflictException(
        'O atendimento foi alterado. Revise os dados antes de coletar uma nova assinatura.',
      );
    }
    let signatureSha256: string | undefined;
    if (input.signatureStorageFileId) {
      const reserved = await this.repository.signatureUploadFile(
        actor.organizationId,
        input.signatureStorageFileId,
      );
      if (!reserved || reserved.createdById !== actor.id)
        throw new EntityNotFoundException(
          'StorageFile',
          input.signatureStorageFileId,
        );
      await this.files.confirm(
        input.signatureStorageFileId,
        actor.organizationId,
      );
      const file = await this.repository.storageFile(
        actor.organizationId,
        input.signatureStorageFileId,
      );
      if (!file || file.createdById !== actor.id || !file.sha256)
        throw new ValidationException(
          'A assinatura do cliente deve usar um upload válido deste atendimento',
        );
      const body = await this.files.read(file.bucket, file.objectKey);
      if (
        detectImageMime(body) !== file.mimeType ||
        body.length > 2_000_000 ||
        this.sha(body) !== file.sha256
      )
        throw new ValidationException(
          'A assinatura do cliente deve ser PNG, JPEG ou WEBP válido e ter no máximo 2 MB',
          undefined,
          'FILE_INVALID',
        );
      signatureSha256 = file.sha256;
    }
    const payloadHash = this.hash({
      executionId: operationId,
      signerName: input.signerName,
      signatureSha256: signatureSha256 ?? null,
      contentHash: input.contentHash,
      contactId: input.contactId ?? null,
    });
    const result = await this.repository.capture({
      organizationId: actor.organizationId,
      businessUnitId: operation.businessUnitId,
      executionId: operation.id,
      customerId: operation.customerId,
      contactId: input.contactId,
      signerName: input.signerName,
      signatureStorageFileId: input.signatureStorageFileId,
      signatureSha256,
      contentVersion: input.expectedVersion,
      contentHash: input.contentHash,
      summary: summary,
      commandId: input.commandId,
      payloadHash,
      actorId: actor.id,
      occurredAt: input.occurredAt,
    });
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_customer_acknowledgement_total',
        idempotentReplay: result.idempotentReplay,
      }),
    );
    const value = result.acknowledgement;
    return {
      id: value.id,
      executionType: 'OPERATION',
      executionId: value.executionId,
      signerName: value.signerName,
      hasSignature: Boolean(value.signatureStorageFileId),
      acknowledgedAt: value.acknowledgedAt.toISOString(),
      contentVersion: value.contentVersion,
      contentHash: value.contentHash,
      idempotentReplay: result.idempotentReplay,
    };
  }

  /**
   * Quem pode cadastrar a **própria** assinatura.
   *
   * ## O portão que estava errado
   *
   * Exigia perfil profissional ativo com ao menos um papel — Técnico Operacional ou
   * Responsável Técnico — para quem não fosse o dono. O efeito era um membro com
   * acesso ao aplicativo recebendo "não tem permissão" na tela da própria assinatura,
   * sem nada que ele pudesse fazer a respeito: o perfil profissional é cadastrado por
   * outra pessoa, no painel web, numa tela que ele não abre.
   *
   * ## Por que a conta já estava feita
   *
   * "Ter acesso ao aplicativo de campo" é uma decisão que o sistema já toma, e toma
   * noutro lugar: `@Surfaces('MOBILE')` no controller, resolvido por
   * `allowsSurface` a partir das superfícies do papel. Quem chega até aqui já passou
   * por ela. O perfil profissional era um segundo portão, mais estrito, perguntando
   * outra coisa — e respondendo a pergunta errada.
   *
   * ## O perfil continua decidindo o que importa
   *
   * Ele não deixou de valer; deixou de valer **aqui**. Quem pode ser escolhido como
   * Responsável Técnico de um PMOC, e portanto de quem a assinatura sai impressa no
   * contrato, continua sendo filtrado por `technicalResponsibleEnabled`. A assinatura
   * é a imagem da rubrica de alguém; onde ela aparece é outra decisão, tomada por
   * quem monta o documento. Trancar o cadastro era trancar a porta errada.
   *
   * O que permanece obrigatório é a associação ativa: sem ela a pessoa não é da
   * organização, e `UserSignature` é por organização.
   */
  private async requireMember(actor: MobileFieldActor) {
    const context = await this.repository.context(
      actor.organizationId,
      actor.id,
    );
    if (!context.membership)
      throw new ForbiddenException(
        'Associação ativa à organização é obrigatória para cadastrar assinatura',
      );
    return context;
  }

  private async visibleOperation(actor: MobileFieldActor, id: string) {
    if (
      !actor.permissions.includes('*') &&
      !actor.permissions.includes('operations.read')
    )
      throw new ForbiddenException('Permissão de operações obrigatória');
    const operation = await this.repository.operation(actor.organizationId, id);
    if (!operation || !actor.businessUnitIds.includes(operation.businessUnitId))
      throw new ForbiddenException('Atendimento fora do contexto permitido');
    const actual =
      operation.completedByUserId ??
      operation.startedByUserId ??
      operation.responsibleFieldTechnicianId;
    if (actual !== actor.id)
      throw new ForbiddenException(
        'Somente o Técnico em Campo efetivo pode coletar o reconhecimento',
      );
    return operation;
  }

  private summary(
    operation: Awaited<
      ReturnType<MobileSignatureRepository['operation']>
    > extends infer T
      ? NonNullable<T>
      : never,
  ) {
    return {
      executionType: 'OPERATION' as const,
      executionId: operation.id,
      customer: operation.customer
        ? {
            id: operation.customer.id,
            name: operation.customer.tradeName ?? operation.customer.legalName,
          }
        : null,
      /**
       * Todos os equipamentos, e não o primeiro.
       *
       * O campo já era uma lista — só nunca tinha mais de um item porque a
       * ordem carregava um equipamento. Quem assina precisa ver o que foi
       * atendido, e assinar por baixo é o que invalida o termo.
       */
      equipment: operation.assets.map((link) => ({
        id: link.asset.id,
        code: link.asset.identifier ?? link.asset.id,
        name: link.asset.name,
      })),
      serviceSummary: operation.description?.trim() || operation.title,
      performedAt:
        operation.completedAt?.toISOString() ??
        operation.startedAt?.toISOString() ??
        null,
      signerPolicy: {
        acknowledgementAllowed: true as const,
        signatureRequired: false as const,
        signatureOptional: true as const,
      },
    };
  }

  private roles(
    profile:
      | {
          fieldTechnicianEnabled: boolean;
          technicalResponsibleEnabled: boolean;
        }
      | null
      | undefined,
  ): MobileProfessionalRole[] {
    const roles: MobileProfessionalRole[] = [];
    if (!profile) return roles;
    if (profile.fieldTechnicianEnabled) roles.push('FIELD_TECHNICIAN');
    if (profile.technicalResponsibleEnabled)
      roles.push('TECHNICAL_RESPONSIBLE');
    return roles;
  }
  private preview(
    actor: MobileFieldActor,
    file: {
      bucket: string;
      objectKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: bigint;
      sha256: string | null;
      status: string;
    },
    signatureHash: string,
    basePath: string,
  ) {
    if (!this.previewable(file, signatureHash)) return null;
    const expires =
      Math.floor(Date.now() / 1000) + this.storageConfig.signedUrlTtlSeconds;
    const signature = this.signPreviewGrant(actor, expires, signatureHash);
    return {
      url: `${basePath}?expires=${expires}&signature=${signature}`,
      expiresAt: new Date(expires * 1000).toISOString(),
      requiredHeaders: {},
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      sha256: file.sha256,
    };
  }

  private previewable(
    file: {
      mimeType: string;
      sizeBytes: bigint;
      sha256: string | null;
      status: string;
    },
    signatureHash: string,
  ): file is typeof file & { sha256: string } {
    return (
      file.status === 'AVAILABLE' &&
      Boolean(file.sha256) &&
      file.sha256 === signatureHash &&
      file.sizeBytes > 0n &&
      file.sizeBytes <= 2_000_000n &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)
    );
  }

  private signPreviewGrant(
    actor: MobileFieldActor,
    expires: number,
    signatureHash: string,
  ): string {
    return createHmac('sha256', this.previewGrantSecret())
      .update(this.previewGrantPayload(actor, expires, signatureHash), 'utf8')
      .digest('hex');
  }

  private validPreviewGrant(
    actor: MobileFieldActor,
    expires: number,
    supplied: string,
    signatureHash: string,
  ): boolean {
    if (expires <= Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(
      this.signPreviewGrant(actor, expires, signatureHash),
      'hex',
    );
    const actual = Buffer.from(supplied, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private previewGrantPayload(
    actor: MobileFieldActor,
    expires: number,
    signatureHash: string,
  ): string {
    return `orbit/mobile-signature-preview/v1\n${actor.organizationId}\n${actor.id}\n${signatureHash}\n${expires}`;
  }

  private previewGrantSecret(): Buffer {
    return createHmac('sha256', this.storageConfig.localSigningSecret)
      .update('orbit/mobile-signature-preview/grant-key/v1', 'utf8')
      .digest();
  }
  private hash(value: unknown): string {
    return this.sha(Buffer.from(JSON.stringify(value)));
  }
  private sha(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }

  private conflictMetric() {
    this.logger.warn(
      JSON.stringify({
        metric: 'mobile_customer_acknowledgement_conflict_total',
      }),
    );
  }
}
