/**
 * Onde cada faixa de um grupo de ocorrências sobrepostas é desenhada.
 *
 * A grade de horas divide a coluna do dia pelo número de ocorrências
 * simultâneas. Isso funciona até três ou quatro. Com oito — e a semana dá
 * 123px por dia em 1440 — cada bloco ficava com 14px para um conteúdo de
 * 39px, e o `overflow-hidden` do bloco engolia o horário sem reticências: o
 * texto desaparecia sem sinal nenhum.
 *
 * A partir do ponto em que a divisão deixa de caber, as faixas passam a
 * sobrepor-se em escada, como em qualquer calendário: cada bloco mantém a
 * largura mínima, mostra a sua aresta esquerda e vem à frente quando recebe o
 * ponteiro ou o foco do teclado.
 *
 * O cálculo fica em CSS, e não em pixels, porque a largura da coluna só é
 * conhecida no browser: `min()`/`max()` resolvem-no na altura do desenho, sem
 * medição nem re-render.
 */

/**
 * Largura mínima de um bloco de ocorrência.
 *
 * É o que a linha de horário (`09:00–10:00`) ocupa somada ao espaçamento
 * interno do bloco. Abaixo disto o bloco escreve o que não consegue mostrar.
 */
export const MIN_BLOCK_WIDTH = "4rem";

export interface LaneGeometry {
  /** Deslocamento a partir da margem esquerda da coluna do dia. */
  readonly left: string;
  /** Largura do bloco, nunca menor que `MIN_BLOCK_WIDTH`. */
  readonly width: string;
}

export function laneGeometry(lane: number, total: number): LaneGeometry {
  const lanes = Math.max(1, total);
  const width = `min(100%, max(${100 / lanes}%, ${MIN_BLOCK_WIDTH}))`;

  /**
   * Uma faixa só ocupa a coluna inteira; várias repartem o que sobra depois
   * de descontada a largura do bloco, o que mantém a escada dentro da coluna
   * mesmo quando os blocos se sobrepõem.
   */
  const left = lanes > 1 ? `calc(${lane} * (100% - ${width}) / ${lanes - 1})` : "0%";

  return { left, width };
}
