/**
 * Renderer PDF premium.
 *
 * ## O que muda em relação ao `pdf.default`
 *
 * O renderer antigo imprime **qualquer** artefato do mesmo jeito: título,
 * seções, pares rótulo/valor. É honesto e serve a um template que ninguém
 * previu — e produz, para o PMOC, uma lista de frases onde o setor espera um
 * documento com timbre, tabela de equipamentos e roteiro auditável.
 *
 * Este renderer conhece os documentos do catálogo oficial. Quando reconhece o
 * tipo, compõe o documento daquele tipo; quando não reconhece, cai no desenho
 * genérico — um template que a organização inventou continua saindo, e sai
 * dentro da mesma moldura de marca.
 *
 * ## Continua sendo o mesmo contrato
 *
 * `RenderInput` entra, bytes saem. Não lê banco, não escreve arquivo. É o que
 * mantém o preview e o documento final saindo do **mesmo** código: o preview é
 * este renderer sem gravar manifesto.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  ArtifactRenderer,
  RenderInput,
  RenderOutput,
} from '../artifact-renderer';
import { readDocumentContext } from './kit/document-context';
import { METRICS, buildTheme, registerFonts } from './kit/theme';
import { paintFrames, type FrameIdentity } from './kit/page-frame';
import { composePmocExecution } from './documents/pmoc-execution.document';
import { composeRvt } from './documents/rvt.document';
import { composeServiceOrder } from './documents/service-order.document';
import { composeReceipt } from './documents/receipt.document';
import { composeTechnicalReport } from './documents/technical-report.document';
import { composeAirQuality } from './documents/air-quality.document';
import { documentTitleFor } from './documents/labels';
import { composeGeneric } from './documents/generic.document';

const VERSION = '2.0.0';

@Injectable()
export class ArtifactPremiumPdfRenderer implements ArtifactRenderer {
  readonly id = 'pdf.premium';
  readonly version = VERSION;
  readonly format = 'PDF';
  readonly mimeType = 'application/pdf';

  render(input: RenderInput): Promise<RenderOutput> {
    return new Promise((resolve, reject) => {
      const theme = buildTheme(input.branding.primaryColor);
      const context = readDocumentContext(input.metadata);

      const document = new PDFDocument({
        size: 'A4',
        /**
         * As margens reservam a moldura.
         *
         * Cabeçalho e rodapé são pintados **depois**, sobre as páginas já
         * bufferizadas — só assim "Página 3 de 7" sabe o total. Para que o
         * conteúdo não passe por baixo deles, o espaço é retirado do fluxo
         * aqui, antes de qualquer coisa ser escrita.
         */
        margins: {
          top: METRICS.compactHeaderHeight,
          bottom: METRICS.footerHeight + 8,
          left: METRICS.pageMargin,
          right: METRICS.pageMargin,
        },
        bufferPages: true,
        info: {
          Title: input.branding.documentTitle ?? input.execution.title,
          Subject: input.execution.code,
          Creator: 'Orbit',
          Producer: `${this.id}@${this.version}`,
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
      document.on('end', () => {
        resolve({
          bytes: Buffer.concat(chunks),
          mimeType: this.mimeType,
          format: this.format,
          rendererVersion: this.version,
          metadata: {
            documentKind: input.snapshot.artifactType,
            sections: input.sections.length,
            equipment: context.equipment?.length ?? 0,
            evidence: input.evidence?.length ?? 0,
            signatures: input.signatures.length,
            structureHash: input.snapshot.structureHash,
          },
        });
      });

      try {
        switch (input.snapshot.artifactType) {
          case 'PMOC':
            composePmocExecution(document, input, context, theme);
            break;
          /* `RVT` é o tipo do documento congelado que vem do app de campo;
             `RELATORIO_VISITA` é o do template oficial. Os dois desenham o
             mesmo papel — o cliente não distingue por qual caminho ele foi
             preenchido, e não deveria mesmo. */
          case 'RVT':
          case 'RELATORIO_VISITA':
            composeRvt(document, input, context, theme);
            break;
          /* `SERVICE_ORDER` vem do app de campo, `ORDEM_SERVICO` do template
             oficial — mesmo papel, dois caminhos de preenchimento. */
          case 'SERVICE_ORDER':
          case 'ORDEM_SERVICO':
            composeServiceOrder(document, input, context, theme);
            break;
          case 'RECIBO':
            composeReceipt(document, input, context, theme);
            break;
          case 'RELATORIO_TECNICO':
            composeTechnicalReport(document, input, context, theme);
            break;
          case 'QUALIDADE_AR':
            composeAirQuality(document, input, context, theme);
            break;
          default:
            composeGeneric(document, input, theme);
        }

        paintFrames(document, this.identity(input), theme);
        document.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('PDF render failed'));
      }
    });
  }

  private identity(input: RenderInput): FrameIdentity {
    const context = readDocumentContext(input.metadata);
    return {
      documentTitle:
        input.branding.documentTitle ??
        documentTitleFor(input.snapshot.artifactType, input.execution.title),
      documentCode: input.execution.code,
      emitter: context.emitter,
      revisionLabel: `Versão documental ${input.snapshot.templateVersion}`,
      issuedAtLabel: new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Recife',
      }).format(input.generatedAt),
    };
  }
}
