/**
 * Emissão do documento do plano de PMOC.
 *
 * ## Por que não passa pelo pipeline de artefatos
 *
 * O pipeline existe para **execuções**: snapshot congelado, respostas de
 * campo, assinaturas coletadas, manifesto com hash e revisão. O documento do
 * plano não tem nada disso — ele descreve a configuração atual, e a
 * configuração muda sem que ninguém "execute" coisa alguma.
 *
 * Forçá-lo no pipeline exigiria inventar uma execução vazia por impressão, e
 * cada reimpressão viraria uma revisão nova de um documento que não mudou.
 *
 * ## Mesma moldura, mesmo kit
 *
 * O que ele compartilha com os demais é a aparência: a mesma faixa de marca, o
 * mesmo rodapé numerado, as mesmas tabelas que paginam. É o kit que garante
 * isso, não a coincidência de dois desenhos parecidos.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { METRICS, buildTheme, registerFonts } from './renderers/pdf/kit/theme';
import { paintFrames } from './renderers/pdf/kit/page-frame';
import type { DocumentEmitter } from './renderers/pdf/kit/document-context';
import {
  composePmocPlan,
  type PmocPlanDocumentInput,
} from './renderers/pdf/documents/pmoc-plan.document';

export interface PmocPlanDocumentRequest {
  readonly plan: PmocPlanDocumentInput;
  readonly emitter?: DocumentEmitter;
  readonly primaryColor?: string;
  readonly generatedAt?: Date;
  readonly timezone?: string;
}

@Injectable()
export class PmocPlanDocumentService {
  render(request: PmocPlanDocumentRequest): Promise<Buffer> {
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
          Title: `PMOC — ${request.plan.plan.name}`,
          Subject: request.plan.plan.code,
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
        composePmocPlan(document, request.plan, theme);
        paintFrames(
          document,
          {
            documentTitle: 'PMOC — Plano',
            documentCode: request.plan.plan.code,
            emitter: request.emitter,
            /**
             * O plano não tem revisão documental: ele é um retrato do que
             * está configurado **agora**. Datar a emissão com destaque é o que
             * impede alguém de arquivar a folha de março e apresentá-la em
             * dezembro como se descrevesse o plano de hoje.
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
          error instanceof Error ? error : new Error('PMOC plan render failed'),
        );
      }
    });
  }
}
