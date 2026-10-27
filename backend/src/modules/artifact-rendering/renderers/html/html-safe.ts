import { documentValue } from '../../../../common/document-value';

/**
 * Sanitização — a fronteira entre dado do tenant e HTML.
 *
 * ## A regra
 *
 * **Nenhum valor vindo do template, da resposta ou da configuração é
 * interpolado como marcação.** Tudo passa por `escapeHtml` antes de entrar no
 * documento. O renderer não tem modo "HTML confiável" — não existe caminho pelo
 * qual um título de seção com `<script>` vire um `<script>`.
 *
 * Isso vale para o que parece inofensivo: `label`, `title`, `unit`,
 * `signerName`, chave de template. Um artefato é preenchido em campo por
 * pessoas, e o documento gerado pode ser aberto por qualquer um.
 *
 * ## Por que escapar, e não limpar
 *
 * Um sanitizador de HTML decide o que é permitido — e a lista de permissões é
 * onde os bypasses moram. Escapar não decide nada: `<` vira `&lt;` sempre. O
 * custo é não haver formatação vinda do usuário, e isso é aceitável: a
 * formatação do documento é do layout, não do conteúdo.
 */

/**
 * Conversão explícita para texto.
 *
 * `String(valor)` sobre objeto devolveria `[object Object]` — informação
 * nenhuma dentro de um documento oficial. Objeto e lista viram JSON legível;
 * o resto usa a conversão primitiva.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '';
  return JSON.stringify(value);
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa texto para conteúdo e para valor de atributo entre aspas. */
export function escapeHtml(value: unknown): string {
  return stringify(value).replace(
    /[&<>"']/g,
    (character) => ENTITIES[character] ?? character,
  );
}

/**
 * Cor CSS segura.
 *
 * Só hexadecimal de 3 ou 6 dígitos. Aceitar cor livre abriria a porta para
 * `url(javascript:…)` e `expression(…)` dentro do estilo — o valor cai no
 * padrão quando não casa.
 */
export function safeColor(value: unknown, fallback = '#17213a'): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : fallback;
}

/** Business answers use the same readable presentation in HTML and PDF. */
export function formatAnswer(value: unknown): string {
  return documentValue(value);
}
