/**
 * Marcado, não marcado, ou sem resposta.
 *
 * ## Três estados, e o terceiro é o que importa
 *
 * `undefined`, `null` e string vazia querem dizer **ninguém respondeu** — e
 * isso não é a mesma coisa que respondeu "não". Tratar o não preenchido como
 * recusa imprime "não executado" sobre um item que o técnico apenas não chegou
 * a marcar; num documento que vai assinado ao cliente, é uma acusação que o
 * registro não sustenta.
 *
 * ## Por que aceita texto
 *
 * A resposta chega de `RenderInput.value`, que é `unknown` por contrato: o
 * mesmo campo BOOLEAN vem como `true` do app, como `"true"` de um import CSV
 * e como `"Sim"` de um template que a organização escreveu à mão. Normalizar
 * aqui é mais honesto que exigir que todo produtor converta antes.
 *
 * Mora em arquivo próprio porque é **regra de leitura**, não desenho — e
 * porque é a parte do checklist que dá para testar sem inspecionar vetores de
 * PDF.
 */
const VERDADEIROS = new Set(['true', 'sim', 's', 'yes', 'y', '1', 'ok', 'x']);
const FALSOS = new Set(['false', 'nao', 'não', 'n', 'no', '0', '-']);

export function checkState(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  /* `NaN` é ausência, não recusa: `Number.isFinite(NaN) && …` devolveria
     `false`, que imprime "não executado" sobre um número que não chegou. */
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value !== 0 : null;
  }
  if (typeof value !== 'string') return null;

  const normalizado = value.trim().toLowerCase();
  if (normalizado === '') return null;
  if (VERDADEIROS.has(normalizado)) return true;
  if (FALSOS.has(normalizado)) return false;
  return null;
}
