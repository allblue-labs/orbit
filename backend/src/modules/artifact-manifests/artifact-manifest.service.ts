/**
 * Orquestração do documento oficial.
 *
 * ## O que este serviço faz e o que não faz
 *
 * Faz: abre revisão, reserva o arquivo, confirma o upload, emite, revoga e
 * assina URLs de acesso.
 *
 * **Não gera conteúdo.** Nenhuma linha aqui sabe o que é um PDF. O futuro
 * Rendering Engine entrega o arquivo e chama `confirmFile`; o manifest cuida
 * de armazenamento, versão, revisão, autorização e distribuição — que é
 * exatamente o que o Engine não deve ter de fazer.
 *
 * ## Hash da fonte
 *
 * Ao abrir uma revisão, calcula-se o SHA-256 do **snapshot + respostas +
 * assinaturas** da execução. É o que permite responder depois se o documento
 * emitido ainda corresponde ao que a execução contém, sem comparar conteúdo
 * nem reprocessar nada.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EntityNotFoundException } from '../../exceptions';
import { ArtifactExecutionRepository } from '../artifact-executions/artifact-execution.repository';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../storage/file-object.service';
import { StorageFileMapper } from '../storage/file-object.mapper';
import type { SignedUrlReadModel } from '../storage/file-object.read-models';
import { ArtifactManifestMapper } from './artifact-manifest.mapper';
import { ArtifactManifestPolicy } from './artifact-manifest.policy';
import { ArtifactManifestRepository } from './artifact-manifest.repository';
import type {
  ArtifactManifestListReadModel,
  ArtifactManifestReadModel,
} from './artifact-manifest.read-models';
import type {
  ConfirmArtifactManifestFileDto,
  OpenArtifactManifestRevisionDto,
  ReserveArtifactManifestFileDto,
  RevokeArtifactManifestDto,
} from './dto/artifact-manifest.dto';

export interface ManifestActor {
  organizationId: string;
  actorId: string;
}

@Injectable()
export class ArtifactManifestService {
  constructor(
    private readonly repository: ArtifactManifestRepository,
    private readonly executions: ArtifactExecutionRepository,
    private readonly files: FileObjectService,
    private readonly mapper: ArtifactManifestMapper,
    private readonly fileMapper: StorageFileMapper,
    private readonly policy: ArtifactManifestPolicy,
  ) {}

  async listByExecution(
    executionId: string,
    organizationId: string,
  ): Promise<ArtifactManifestListReadModel> {
    await this.execution(executionId, organizationId);
    return this.mapper.list(
      await this.repository.listByExecution(executionId, organizationId),
    );
  }

  async get(
    id: string,
    organizationId: string,
  ): Promise<ArtifactManifestReadModel> {
    return this.mapper.details(await this.manifest(id, organizationId));
  }

  async openRevision(
    executionId: string,
    { organizationId, actorId }: ManifestActor,
    input: OpenArtifactManifestRevisionDto,
  ): Promise<ArtifactManifestReadModel> {
    const execution = await this.execution(executionId, organizationId);
    this.policy.assertExecutionCanIssue(execution);

    return this.mapper.details(
      await this.repository.openRevision({
        organizationId,
        businessUnitId: execution.businessUnitId,
        executionId,
        snapshotId: execution.snapshotId,
        templateId: execution.templateId,
        templateVersion: execution.snapshot.templateVersion,
        renderer: input.renderer,
        rendererVersion: input.rendererVersion,
        format: input.format,
        sourceHash: this.sourceHash(execution),
        metadata: input.metadata,
        createdById: actorId,
      }),
    );
  }

  /**
   * Reserva o arquivo da revisão e devolve a URL de upload.
   *
   * O arquivo nasce `PENDING`. Só a confirmação — que lê o objeto gravado —
   * o torna disponível e emite o manifest.
   */
  async reserveFile(
    id: string,
    { organizationId, actorId }: ManifestActor,
    input: ReserveArtifactManifestFileDto,
  ): Promise<{ fileId: string; upload: SignedUrlReadModel }> {
    const manifest = await this.manifest(id, organizationId);
    this.policy.assertCanAttachFile(manifest);

    const { file, signed } = await this.files.reserve({
      organizationId,
      businessUnitId: manifest.businessUnitId,
      namespace: STORAGE_NAMESPACES.manifest,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      metadata: { manifestId: manifest.id, revision: manifest.revision },
      createdById: actorId,
    });

    return { fileId: file.id, upload: this.fileMapper.signedUrl(signed) };
  }

  /**
   * Confirma o upload e emite o documento.
   *
   * O hash gravado é o do conteúdo que **está** no storage, calculado aqui —
   * não o que o cliente afirmaria. É esse valor que uma futura assinatura
   * digital cobrirá.
   */
  async confirmFile(
    id: string,
    { organizationId, actorId }: ManifestActor,
    input: ConfirmArtifactManifestFileDto,
  ): Promise<ArtifactManifestReadModel> {
    const manifest = await this.manifest(id, organizationId);
    this.policy.assertCanAttachFile(manifest);

    const file = await this.files.confirm(input.fileId, organizationId);

    return this.mapper.details(
      await this.repository.issue(
        id,
        organizationId,
        manifest.businessUnitId,
        manifest.executionId,
        {
          fileId: file.id,
          contentHash: file.sha256 as string,
          issuedById: actorId,
        },
      ),
    );
  }

  /**
   * Emite a revisão a partir de bytes já produzidos, no mesmo processo.
   *
   * É o caminho do Rendering Engine (PR-20): ele tem o conteúdo em mãos e não
   * precisa passar por URL assinada para entregá-lo a si mesmo. O que acontece
   * é exatamente o mesmo do caminho externo — o arquivo vai para o Storage, o
   * hash é calculado sobre o conteúdo gravado e a revisão é emitida —, apenas
   * sem o desvio pela rede.
   *
   * Storage e manifest continuam sendo responsabilidade **desta** camada: o
   * renderer entrega bytes e não sabe onde eles param.
   */
  async issueWithContent(
    id: string,
    { organizationId, actorId }: ManifestActor,
    content: {
      bytes: Buffer;
      fileName: string;
      mimeType: string;
      rendererVersion?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ArtifactManifestReadModel> {
    const manifest = await this.manifest(id, organizationId);
    this.policy.assertCanAttachFile(manifest);

    const file = await this.files.store({
      organizationId,
      businessUnitId: manifest.businessUnitId,
      namespace: STORAGE_NAMESPACES.manifest,
      fileName: content.fileName,
      mimeType: content.mimeType,
      body: content.bytes,
      metadata: {
        manifestId: manifest.id,
        revision: manifest.revision,
        ...content.metadata,
      },
      createdById: actorId,
    });

    return this.mapper.details(
      await this.repository.issue(
        id,
        organizationId,
        manifest.businessUnitId,
        manifest.executionId,
        {
          fileId: file.id,
          contentHash: file.sha256 as string,
          rendererVersion: content.rendererVersion,
          issuedById: actorId,
        },
      ),
    );
  }

  async revoke(
    id: string,
    { organizationId, actorId }: ManifestActor,
    input: RevokeArtifactManifestDto,
  ): Promise<ArtifactManifestReadModel> {
    const manifest = await this.manifest(id, organizationId);
    this.policy.assertCanRevoke(manifest);

    return this.mapper.details(
      await this.repository.revoke(
        id,
        organizationId,
        manifest.businessUnitId,
        actorId,
        input.reason,
      ),
    );
  }

  /**
   * URL assinada de acesso ao documento (Stage 8).
   *
   * O caminho inteiro passou por autorização antes de chegar aqui: RLS na
   * leitura, capability e permissão no controller, política no manifest. O
   * acesso é registrado em auditoria — quem assinou o quê, e quando.
   */
  async signDownload(
    id: string,
    { organizationId, actorId }: ManifestActor,
    operation: 'download' | 'preview',
  ): Promise<SignedUrlReadModel> {
    const manifest = await this.manifest(id, organizationId);
    this.policy.assertCanDownload(manifest);

    const file = manifest.file;
    if (!file) {
      throw new EntityNotFoundException('Artifact manifest file', id);
    }

    const signed = await this.files.sign(
      {
        bucket: file.bucket,
        objectKey: file.objectKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
      },
      operation,
    );

    await this.repository.auditDownload(
      organizationId,
      manifest.businessUnitId,
      actorId,
      manifest.id,
      manifest.revision,
      operation,
    );

    return this.fileMapper.signedUrl(signed);
  }

  private async manifest(id: string, organizationId: string) {
    const manifest = await this.repository.find(id, organizationId);
    if (!manifest) {
      throw new EntityNotFoundException('Artifact manifest', id);
    }
    return manifest;
  }

  private async execution(executionId: string, organizationId: string) {
    const execution = await this.executions.find(executionId, organizationId);
    if (!execution) {
      throw new EntityNotFoundException('Artifact execution', executionId);
    }
    return execution;
  }

  /**
   * Hash da fonte.
   *
   * Cobre a estrutura (o `structureHash` do snapshot, já calculado na PR-18) e
   * o conteúdo respondido. A ordenação é explícita: dois carregamentos da mesma
   * execução precisam produzir o mesmo hash.
   */
  private sourceHash(execution: {
    snapshot: { structureHash: string };
    context?: unknown;
    responses: readonly {
      sectionId: string;
      fieldId: string;
      value: unknown;
    }[];
    signatures: readonly { slotId: string; signatureHash: string }[];
  }): string {
    const responses = [...execution.responses]
      .sort((left, right) =>
        `${left.sectionId}.${left.fieldId}`.localeCompare(
          `${right.sectionId}.${right.fieldId}`,
        ),
      )
      .map((response) => ({
        f: `${response.sectionId}.${response.fieldId}`,
        v: response.value,
      }));

    const signatures = [...execution.signatures]
      .sort((left, right) => left.slotId.localeCompare(right.slotId))
      .map((signature) => `${signature.slotId}:${signature.signatureHash}`);

    return createHash('sha256')
      .update(
        JSON.stringify({
          structure: execution.snapshot.structureHash,
          context: execution.context ?? null,
          responses,
          signatures,
        }),
      )
      .digest('hex');
  }
}
