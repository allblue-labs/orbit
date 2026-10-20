/**
 * A resposta de um campo, como ela deve sair impressa.
 *
 * `formatAnswer` serve a qualquer renderer e devolve o valor como ele chegou —
 * o que é certo para o HTML e errado para um papel em português. Duas coisas
 * saíam mal e as duas foram vistas numa amostra, não num teste:
 *
 * - **data ISO**: `2026-10-01` num recibo ou num orçamento que o cliente
 *   arquiva é defeito, não tecnicismo;
 * - **decimal com ponto**: "412.5 m²" num laudo técnico é o separador errado
 *   para o idioma do documento inteiro.
 *
 * Mora num módulo só porque os cinco compositores precisam do mesmo
 * comportamento, e cinco cópias divergem — foi o que aconteceu: a data já
 * estava tratada em todos, o decimal em nenhum.
 */
import { formatAnswer } from '../../html/html-safe';
import type { RenderFieldInput } from '../../artifact-renderer';

const TIPOS_NUMERICOS = new Set(['DECIMAL', 'NUMBER', 'CURRENCY']);

export function answerText(campo: RenderFieldInput): string {
  const texto = formatAnswer(campo.value).trim();
  if (texto.length === 0) return texto;

  if (campo.type === 'DATE') {
    const civil = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
    return civil ? `${civil[3]}/${civil[2]}/${civil[1]}` : texto;
  }

  if (TIPOS_NUMERICOS.has(campo.type)) {
    /* Só quando o texto **é** o número: um campo numérico preenchido com
       "a combinar" sai como veio, porque reescrevê-lo seria inventar. */
    const numero = Number(texto);
    if (texto !== '' && Number.isFinite(numero)) {
      return new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: 3,
      }).format(numero);
    }
  }

  return texto;
}
