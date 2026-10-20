/**
 * Renderer HTML — o documento em marcação.
 *
 * É o primeiro renderer de propósito: HTML é inspecionável, versionável em
 * teste e serve de entrada para qualquer motor de PDF que venha depois.
 *
 * ## Composição
 *
 * ```
 * cabeçalho (branding)
 *   └─ seção 1 ─ campo ─ resposta
 *   └─ seção 2 ─ …
 * assinaturas
 * rodapé (código, versão do template, hash da estrutura, correlationId)
 * ```
 *
 * ## Paginação lógica
 *
 * Não há paginação física — HTML não tem página. O que existe é a **quebra
 * lógica**: cada seção é um bloco que não deve ser partido, marcado com
 * `break-inside: avoid` e `page-break-inside: avoid`. Quando o HTML virar PDF
 * por um motor de impressão, a quebra acontece onde o documento diz que pode.
 *
 * ## Segurança
 *
 * Todo valor passa por `escapeHtml`. Não há caminho de HTML confiável, não há
 * `innerHTML`, não há `<script>` na saída, e o `<head>` declara uma CSP
 * restritiva para o caso de o arquivo ser aberto direto no navegador.
 */
import { Injectable } from '@nestjs/common';
import type {
  ArtifactRenderer,
  RenderInput,
  RenderOutput,
  RenderSectionInput,
  RenderSignatureInput,
} from '../artifact-renderer';
import { escapeHtml, formatAnswer, safeColor } from './html-safe';

/** Sobe quando a saída muda de forma — fica gravado no manifest. */
const VERSION = '1.0.0';

@Injectable()
export class ArtifactHtmlRenderer implements ArtifactRenderer {
  readonly id = 'html.default';
  readonly version = VERSION;
  readonly format = 'HTML';
  readonly mimeType = 'text/html; charset=utf-8';

  render(input: RenderInput): Promise<RenderOutput> {
    const html = this.document(input);
    const bytes = Buffer.from(html, 'utf8');

    return Promise.resolve({
      bytes,
      mimeType: this.mimeType,
      format: this.format,
      rendererVersion: this.version,
      metadata: {
        sections: input.sections.length,
        fields: input.sections.reduce(
          (total, section) => total + section.fields.length,
          0,
        ),
        signatures: input.signatures.length,
        structureHash: input.snapshot.structureHash,
      },
    });
  }

  /** HTML completo — usado também pelo renderer de PDF baseado em impressão. */
  document(input: RenderInput): string {
    const color = safeColor(input.branding.primaryColor);
    const title = escapeHtml(
      input.branding.documentTitle ?? input.execution.title,
    );

    return [
      '<!doctype html>',
      '<html lang="pt-BR">',
      '<head>',
      '<meta charset="utf-8">',
      /** Sem script, sem recurso externo — o documento é autocontido. */
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">`,
      `<title>${title}</title>`,
      `<style>${this.styles(color)}</style>`,
      '</head>',
      '<body>',
      this.header(input),
      '<main>',
      ...[...input.sections]
        .sort((left, right) => left.order - right.order)
        .map((section) => this.section(section)),
      this.evidence(input),
      this.signatures(input.signatures),
      '</main>',
      this.footer(input),
      '</body>',
      '</html>',
    ].join('\n');
  }

  private styles(color: string): string {
    return [
      'body{font-family:Helvetica,Arial,sans-serif;color:#1c2333;margin:0;padding:32px;font-size:12px;line-height:1.5}',
      `h1{font-size:20px;margin:0 0 4px;color:${color}}`,
      'h2{font-size:14px;margin:0 0 8px;border-bottom:1px solid #d8dde8;padding-bottom:4px}',
      '.meta{color:#5b6478;font-size:10px;margin:0}',
      /* Quebra lógica: uma seção não é partida entre páginas. */
      'section{margin:20px 0;break-inside:avoid;page-break-inside:avoid}',
      'table{width:100%;border-collapse:collapse}',
      'th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #e6e9f0}',
      'th{width:38%;font-weight:600;color:#3b455c}',
      '.pending{color:#8a94a8;font-style:italic}',
      '.required{color:#b3261e}',
      '.signatures{margin-top:28px;break-inside:avoid;page-break-inside:avoid}',
      '.signature{border-top:1px solid #1c2333;margin-top:36px;padding-top:6px;width:60%}',
      'footer{margin-top:32px;border-top:1px solid #d8dde8;padding-top:8px;color:#5b6478;font-size:9px}',
      '.hash{font-family:monospace;word-break:break-all}',
      '.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.evidence{margin:0;border:1px solid #d8dde8;padding:8px;break-inside:avoid}',
      '.evidence img{display:block;max-width:100%;max-height:360px;margin:0 auto 6px}',
    ].join('');
  }

  private evidence(input: RenderInput): string {
    if (!input.evidence?.length) return '';
    const items = input.evidence.map((item) => {
      const image =
        item.bytes && /^image\/(png|jpeg|jpg|webp)$/i.test(item.mimeType)
          ? `<img alt="${escapeHtml(item.caption ?? item.fileName)}" src="data:${escapeHtml(item.mimeType)};base64,${item.bytes.toString('base64')}">`
          : '<p class="pending">Arquivo anexado</p>';
      return [
        '<figure class="evidence">',
        image,
        `<figcaption>${escapeHtml(item.caption ?? item.fileName)}</figcaption>`,
        `<p class="meta">${escapeHtml(item.fileName)} · ${escapeHtml(item.kind)}</p>`,
        item.sha256
          ? `<p class="meta hash">${escapeHtml(item.sha256)}</p>`
          : '',
        '</figure>',
      ].join('');
    });
    return `<section><h2>Evidências</h2><div class="evidence-grid">${items.join('')}</div></section>`;
  }

  private header(input: RenderInput): string {
    const organization = input.branding.organizationName
      ? `<p class="meta">${escapeHtml(input.branding.organizationName)}</p>`
      : '';
    const custom = input.branding.headerText
      ? `<p class="meta">${escapeHtml(input.branding.headerText)}</p>`
      : '';

    return [
      '<header>',
      organization,
      `<h1>${escapeHtml(input.branding.documentTitle ?? input.execution.title)}</h1>`,
      `<p class="meta">${escapeHtml(input.execution.code)} · ${escapeHtml(input.snapshot.templateName)} v${input.snapshot.templateVersion}</p>`,
      custom,
      '</header>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private section(section: RenderSectionInput): string {
    const description = section.description
      ? `<p class="meta">${escapeHtml(section.description)}</p>`
      : '';

    const rows = [...section.fields]
      .filter((field) => !field.hidden)
      .sort((left, right) => left.order - right.order)
      .map((field) => {
        const answered = field.value !== undefined && field.value !== null;
        const unit = field.unit ? ` ${escapeHtml(field.unit)}` : '';
        const value = answered
          ? `${escapeHtml(formatAnswer(field.value))}${unit}`
          : '<span class="pending">não respondido</span>';
        const required =
          field.required && !answered ? ' <span class="required">*</span>' : '';

        return `<tr><th>${escapeHtml(field.label)}${required}</th><td>${value}</td></tr>`;
      });

    /** Seção sem campo visível ainda aparece: sua ausência é informação. */
    const body = rows.length
      ? `<table><tbody>${rows.join('')}</tbody></table>`
      : '<p class="pending">Sem campos preenchidos nesta seção.</p>';

    return [
      '<section>',
      `<h2>${escapeHtml(section.title)}</h2>`,
      description,
      body,
      '</section>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private signatures(signatures: readonly RenderSignatureInput[]): string {
    if (signatures.length === 0) return '';

    const blocks = [...signatures]
      .sort((left, right) => left.order - right.order)
      .map((signature) => {
        const signed = Boolean(signature.signedAt);
        const name = signed
          ? escapeHtml(signature.signerName ?? '')
          : '<span class="pending">aguardando assinatura</span>';
        const document = signature.signerDocument
          ? `<p class="meta">${escapeHtml(signature.signerDocument)}</p>`
          : '';
        const credential = signature.professionalCredential
          ? `<p class="meta">${escapeHtml(signature.professionalCredential)}</p>`
          : '';
        const when = signature.signedAt
          ? `<p class="meta">Assinado em ${escapeHtml(signature.signedAt)}</p>`
          : '';
        /**
         * O hash da assinatura entra no documento.
         *
         * É o que permite conferir depois que aquela assinatura é a que consta
         * no registro — sem ele o bloco seria só um nome impresso.
         */
        const hash = signature.signatureHash
          ? `<p class="meta hash">${escapeHtml(signature.signatureHash)}</p>`
          : '';
        const image =
          signature.signatureImage &&
          /^image\/(png|jpeg|jpg|webp)$/i.test(
            signature.signatureImageMimeType ?? '',
          )
            ? `<img alt="Assinatura de ${escapeHtml(signature.signerName ?? '')}" src="data:${escapeHtml(signature.signatureImageMimeType ?? 'image/png')};base64,${signature.signatureImage.toString('base64')}" style="max-width:240px;max-height:90px">`
            : '';

        return [
          '<div class="signature">',
          image,
          `<p><strong>${escapeHtml(signature.label)}</strong> · ${escapeHtml(signature.signerRole)}</p>`,
          `<p>${name}</p>`,
          document,
          credential,
          when,
          hash,
          '</div>',
        ]
          .filter(Boolean)
          .join('\n');
      });

    return `<div class="signatures"><h2>Assinaturas</h2>${blocks.join('')}</div>`;
  }

  private footer(input: RenderInput): string {
    const custom = input.branding.footerText
      ? `<p>${escapeHtml(input.branding.footerText)}</p>`
      : '';

    return [
      '<footer>',
      custom,
      `<p>Documento gerado pelo Orbit em ${escapeHtml(input.generatedAt.toISOString())}</p>`,
      `<p>Execução ${escapeHtml(input.execution.code)} · template ${escapeHtml(input.snapshot.templateKey)} v${input.snapshot.templateVersion}</p>`,
      `<p class="hash">estrutura ${escapeHtml(input.snapshot.structureHash)}</p>`,
      `<p class="hash">correlação ${escapeHtml(input.correlationId)}</p>`,
      '</footer>',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
