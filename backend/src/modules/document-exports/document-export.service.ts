/**
 * Pedir e acompanhar exportações de documento.
 *
 * ## Pedido
 *
 * A permissão já foi conferida pelo controller (a mesma da rota síncrona) e o
 * domínio já confirmou que o documento existe para quem pede. Aqui, numa
 * transação só: confere a contenção da organização, enfileira o job e grava o
 * registro de acompanhamento. Ou os dois existem, ou nenhum — não há registro
 * esperando um job que nunca foi pedido.
 *
 * ## Contenção (vizinho barulhento, na entrada)
 *
 * No máximo `DOCUMENT_EXPORTS_PENDING_PER_ORG` (padrão 20) exportações em
 * andamento por organização. Acima disso, 429: a fila tem justiça no claim,
 * mas aceitar mil pedidos de uma vez só para fazê-los esperar não ajuda
 * ninguém. A contagem é da organização inteira (função `SECURITY DEFINER`
 * `app_document_exports_in_progress`, presa à organização do contexto), e a
 * trava consultiva por organização a torna exata entre requisições
 * simultâneas.
 *
 * ## Consulta
 *
 * Quem pediu sempre vê a própria exportação; outra pessoa da organização vê
 * se tiver a permissão de leitura do tipo de documento. A URL de download é
 * gerada a cada consulta, valendo 300 s.
 */
import { Injectable } from '@nestjs/common';
import type { DocumentExport, Prisma, StorageFile } from '@prisma/client';
import { AuthorizationService } from '../../common/authorization.service';
import { RequestContextService, type RequestContext } from '../../context';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import {
  EntityNotFoundException,
  ForbiddenException,
  RateLimitException,
} from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES } from '../jobs/background-job.types';
import { envInt } from '../jobs/queue-groups';
import { FileObjectService } from '../storage/file-object.service';
import type {
  DocumentExportAcceptedReadModel,
  DocumentExportKind,
  DocumentExportReadModel,
  DocumentExportStatus,
} from './document-export.read-models';
import {
  DOCUMENT_EXPORT_TTL_MS,
  DOCUMENT_EXPORT_URL_TTL_SECONDS,
  type DocumentExportRequest,
} from './document-export.types';

/** A leitura que libera consultar uma exportação de outra pessoa. */
const READ_PERMISSION: Readonly<Record<DocumentExportKind, string | null>> = {
  QUOTE: 'quotes.read',
  PMOC_PLAN: 'pmoc.read',
  EQUIPMENT_QR: 'assets.read',
  /* Só pelo link público, com o token. */
  QUOTE_ACCEPTED: null,
};

type ExportWithFile = DocumentExport & {
  storageFile: StorageFile | null;
  job: { status: string } | null;
};

@Injectable()
export class DocumentExportService {
  private readonly pendingLimit = envInt(
    'DOCUMENT_EXPORTS_PENDING_PER_ORG',
    20,
    { max: 1_000 },
  );

  constructor(
    private readonly rls: RlsTransaction,
    private readonly queue: BackgroundJobQueue,
    private readonly contexts: RequestContextService,
    private readonly files: FileObjectService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Pede a exportação na transação do tenant (ou na do chamador). */
  request(
    input: DocumentExportRequest,
    client?: PrismaTransactionClient,
  ): Promise<DocumentExportAcceptedReadModel> {
    const context = this.contexts.get();
    const organizationId = context.organizationId;
    if (!organizationId)
      throw new ForbiddenException('Organização não identificada.');

    const work = async (tx: PrismaTransactionClient) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`document-exports:${organizationId}`}, 0))
      `;
      /* A organização inteira, não só as unidades de quem pede: o RLS de
         `document_exports` recorta por unidade, e o teto é da organização. */
      const [counted] = await tx.$queryRaw<{ total: number }[]>`
        SELECT app_document_exports_in_progress(${organizationId}::uuid) AS total
      `;
      if ((counted?.total ?? 0) >= this.pendingLimit)
        throw new RateLimitException(60);

      const id = generateUuidV7();
      const scope = input.businessUnitId
        ? {
            scope: 'BUSINESS_UNIT' as const,
            businessUnitId: input.businessUnitId,
          }
        : {
            scope: 'ORGANIZATION' as const,
            businessUnitIds: [...context.businessUnitIds],
          };
      const job = await this.queue.enqueue(
        {
          queue: JOB_QUEUES.documentExport,
          jobKey: `document-export:${id}`,
          organizationId,
          ...scope,
          payload: { exportId: id },
          correlationId: context.requestId,
          actorUserId: context.userId ?? null,
        },
        tx,
      );
      await tx.documentExport.create({
        data: {
          id,
          organizationId,
          businessUnitId: input.businessUnitId,
          kind: input.kind,
          entityId: input.entityId,
          params: (input.params ?? {}) as Prisma.InputJsonObject,
          status: 'PENDING',
          jobId: job.id,
          requestedBy: context.userId ?? null,
          acceptanceLinkId: input.acceptanceLinkId ?? null,
          correlationId: context.requestId,
          expiresAt: new Date(Date.now() + DOCUMENT_EXPORT_TTL_MS),
        },
      });
      return { exportId: id, jobId: job.id, status: 'PENDING' as const };
    };

    return client ? work(client) : this.rls.run(work);
  }

  /** Situação de uma exportação, para quem tem direito de vê-la. */
  async status(id: string): Promise<DocumentExportReadModel> {
    const context = this.contexts.get();
    const row = await this.find(id);
    if (!row || !this.canRead(context, row))
      throw new EntityNotFoundException('DocumentExport', id);
    return this.present(row);
  }

  /**
   * Situação de uma exportação do link público do orçamento.
   *
   * Chamado dentro do contexto aberto pelo token (`QuoteAcceptanceService`),
   * com a transação dele: a exportação precisa ser **deste** link.
   */
  async statusForAcceptanceLink(
    id: string,
    acceptanceLinkId: string,
    tx: PrismaTransactionClient,
  ): Promise<DocumentExportReadModel> {
    const row = await tx.documentExport.findFirst({
      where: { id, acceptanceLinkId, kind: 'QUOTE_ACCEPTED' },
      include: { storageFile: true, job: { select: { status: true } } },
    });
    if (!row) throw new EntityNotFoundException('DocumentExport', id);
    return this.present(row);
  }

  private find(id: string): Promise<ExportWithFile | null> {
    return this.rls.run((tx) =>
      tx.documentExport.findFirst({
        where: { id },
        include: { storageFile: true, job: { select: { status: true } } },
      }),
    );
  }

  private canRead(context: RequestContext, row: DocumentExport): boolean {
    if (row.kind === 'QUOTE_ACCEPTED') return false;
    if (row.requestedBy && row.requestedBy === context.userId) return true;
    const permission = READ_PERMISSION[row.kind as DocumentExportKind];
    return (
      permission !== null &&
      this.authorization.hasPermissions(context, [permission])
    );
  }

  private async present(row: ExportWithFile): Promise<DocumentExportReadModel> {
    /* Job enterrado sem o registro fechado (lease expirado na última
       tentativa): para quem consulta, falhou. */
    const status: DocumentExportStatus =
      row.status !== 'COMPLETED' &&
      row.status !== 'FAILED' &&
      row.job?.status === 'DEAD'
        ? 'FAILED'
        : (row.status as DocumentExportStatus);
    const file =
      status === 'COMPLETED' &&
      row.storageFile?.status === 'AVAILABLE' &&
      row.storageFile.organizationId === row.organizationId &&
      row.storageFile.businessUnitId === row.businessUnitId &&
      (row.storageFile.metadata as { documentExportId?: string } | null)
        ?.documentExportId === row.id &&
      !row.storageFile.deletedAt
        ? row.storageFile
        : null;
    const signed = file
      ? await this.files.sign(
          {
            bucket: file.bucket,
            objectKey: file.objectKey,
            fileName: row.fileName ?? file.fileName,
            mimeType: row.contentType ?? file.mimeType,
          },
          'download',
          DOCUMENT_EXPORT_URL_TTL_SECONDS,
        )
      : null;
    return {
      exportId: row.id,
      kind: row.kind as DocumentExportKind,
      status,
      fileName: row.fileName,
      contentType: row.contentType,
      errorCode:
        status === 'FAILED' ? (row.errorCode ?? 'EXPORT_FAILED') : null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      download: signed
        ? { url: signed.url, expiresAt: signed.expiresAt.toISOString() }
        : null,
    };
  }
}
