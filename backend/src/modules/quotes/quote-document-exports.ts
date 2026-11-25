/**
 * Exportação assíncrona dos documentos de orçamento.
 *
 * - **Pedido:** confere que o orçamento existe para quem pede (web: escopo da
 *   organização e unidades; app: a mesma regra de leitura da rota síncrona
 *   do app) e pede a exportação. A permissão já passou pelo controller.
 * - **Geração (worker):** o mesmo `QuoteService.document` e o mesmo
 *   `QuoteAcceptanceService.documentForLink` das rotas síncronas — o arquivo
 *   exportado é idêntico ao baixado pela rota antiga.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { EntityNotFoundException } from '../../exceptions';
import type { AuthenticatedIdentity } from '../identity/domain/identity.types';
import { DocumentExportGeneratorRegistry } from '../document-exports/document-export.registry';
import { DocumentExportService } from '../document-exports/document-export.service';
import type {
  DocumentExportGenerator,
  GeneratedDocument,
} from '../document-exports/document-export.types';
import { MobileQuoteService } from './mobile-quote.service';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import { QuoteService } from './quote.service';

@Injectable()
export class QuoteDocumentExports
  implements DocumentExportGenerator, OnModuleInit
{
  readonly kinds = ['QUOTE', 'QUOTE_ACCEPTED'] as const;

  constructor(
    private readonly generators: DocumentExportGeneratorRegistry,
    private readonly exports: DocumentExportService,
    private readonly rls: RlsTransaction,
    private readonly quotes: QuoteService,
    private readonly mobile: MobileQuoteService,
    private readonly acceptance: QuoteAcceptanceService,
  ) {}

  onModuleInit(): void {
    this.generators.register(this);
  }

  /** `POST /quotes/:id/document/exports`. */
  async request(id: string, organizationId: string) {
    const quote = await this.rls.run((tx) =>
      tx.quote.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, businessUnitId: true },
      }),
    );
    if (!quote) throw new EntityNotFoundException('Quote', id);
    return this.exports.request({
      kind: 'QUOTE',
      entityId: quote.id,
      businessUnitId: quote.businessUnitId,
    });
  }

  /** `POST /mobile/field/quotes/:id/document/exports` — regra de leitura do app. */
  async requestFromMobile(actor: AuthenticatedIdentity, id: string) {
    const organizationId = await this.mobile.assertDocumentRead(actor, id);
    return this.request(id, organizationId);
  }

  /** `POST /quote-acceptance/:token/document/exports` (público). */
  requestAccepted(token: string) {
    return this.acceptance.requestDocumentExport(token, this.exports);
  }

  /** `GET /quote-acceptance/:token/document/exports/:exportId` (público). */
  acceptedStatus(token: string, exportId: string) {
    return this.acceptance.documentExportStatus(token, exportId, this.exports);
  }

  async generate({
    export: row,
  }: Parameters<
    DocumentExportGenerator['generate']
  >[0]): Promise<GeneratedDocument> {
    if (row.kind === 'QUOTE_ACCEPTED') {
      if (!row.acceptanceLinkId)
        throw new EntityNotFoundException('Proposta', row.entityId);
      const document = await this.acceptance.documentForLink(
        row.acceptanceLinkId,
      );
      return {
        bytes: Buffer.from(document.bytes),
        fileName: document.fileName,
        contentType: 'application/pdf',
      };
    }
    const document = await this.quotes.document(
      row.entityId,
      row.organizationId,
    );
    return {
      bytes: Buffer.from(document.bytes),
      fileName: document.fileName,
      contentType: document.mimeType,
    };
  }
}
