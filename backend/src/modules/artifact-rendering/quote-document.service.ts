/**
 * Emissão do documento de orçamento.
 *
 * ## Por que não passa pelo pipeline de artefatos
 *
 * Mesma razão do documento do plano de PMOC: o pipeline existe para
 * **execuções** — snapshot congelado, respostas de campo, assinaturas
 * coletadas, manifesto com hash e revisão. Uma proposta comercial não tem nada
 * disso. Ela é editada enquanto é rascunho, enviada, e às vezes revista; forçar
 * o pipeline exigiria inventar uma execução vazia por impressão, e cada
 * reimpressão viraria revisão de um documento que ninguém executou.
 *
 * ## Os valores vêm prontos
 *
 * Subtotal, desconto e total são do domínio de orçamentos, que é quem os
 * calcula e os persiste. Este serviço formata e imprime. Recalcular aqui
 * criaria uma segunda fonte de verdade sobre dinheiro, e no dia em que as duas
 * discordassem a folha impressa contradiria a tela.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { METRICS, buildTheme, registerFonts } from './renderers/pdf/kit/theme';
import { paintFrames } from './renderers/pdf/kit/page-frame';
import type { DocumentEmitter } from './renderers/pdf/kit/document-context';
import {
  composeQuote,
  type QuoteDocumentInput,
} from './renderers/pdf/documents/quote.document';

export interface QuoteDocumentRequest {
  readonly quote: QuoteDocumentInput;
  readonly emitter?: DocumentEmitter;
  readonly primaryColor?: string;
  readonly generatedAt?: Date;
  readonly timezone?: string;
}

@Injectable()
export class QuoteDocumentService {
  render(request: QuoteDocumentRequest): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const theme = buildTheme(request.primaryColor);
      const generatedAt = request.generatedAt ?? new Date();

      const document = new PDFDocument({
        size: 'A4',
        margins: {
          top: METRICS.compactHeaderHeight,
          bottom: METRICS.footerHeight + 8,
          left: METRICS.pageMargin,
          right: METRICS.pageMargin,
        },
        bufferPages: true,
        info: {
          Title: `Orçamento ${request.quote.quote.code}`,
          Subject: request.quote.quote.title,
          Creator: 'Orbit',
          Producer: 'pdf.premium@2.0.0',
        },
      });

      registerFonts(document);
      /* A margem do documento é a do cabeçalho compacto, que vale da segunda
         página em diante. A primeira reserva mais espaço para o timbre, e é
         aqui que o cursor desce até ele. */
      document.y = METRICS.headerHeight;

      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));

      try {
        composeQuote(document, request.quote, request.emitter, theme);
        paintFrames(
          document,
          {
            documentTitle: 'Orçamento',
            documentCode: request.quote.quote.code,
            emitter: request.emitter,
            /**
             * A data de emissão com destaque importa mais aqui que nos
             * demais: uma proposta é uma oferta com prazo, e uma folha sem
             * data de emissão não deixa conferir se o prazo já correu.
             */
            issuedAtLabel: new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: request.timezone ?? 'America/Recife',
            }).format(generatedAt),
          },
          theme,
        );
        document.end();
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error('Quote render failed'),
        );
      }
    });
  }
}
