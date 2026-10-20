/**
 * A janela da evolução financeira.
 *
 * ## Por que ela não é a do painel
 *
 * A série do Financeiro é **mensal** — o servidor agrupa por `date_trunc('month')`.
 * O painel abre em 30 dias, e trinta dias dão um mês, às vezes dois: um gráfico de
 * linha com um ponto não desenha nada, e era por isso que o gráfico simplesmente não
 * aparecia.
 *
 * Os números do cartão continuam sendo os do período escolhido — realizado, previsto,
 * vencido. O que olha para trás é a **linha**, porque é ela que responde "como
 * chegamos até aqui", e essa pergunta não cabe em trinta dias.
 *
 * ## Doze meses, terminando onde o período termina
 *
 * Termina no fim do recorte do painel para que a linha e os números falem do mesmo
 * instante: num recorte passado, a evolução para onde o período para, em vez de
 * seguir até hoje e sugerir que os números também seguem.
 */

/** Quantos meses de história a linha mostra, contando o mês corrente. */
export const HISTORY_MONTHS = 12;

/** `2026-10-02T12:00:00.000Z` ou `2026-10-02` → `2026-10-02`. */
const toDay = (value: string | undefined): string | undefined =>
  value?.slice(0, 10);

/**
 * O primeiro dia do mês, `HISTORY_MONTHS - 1` meses antes do dia informado.
 *
 * Aritmética em texto, sem `Date`: `new Date('2026-10-02')` é interpretado em UTC e
 * `setMonth` resolve no fuso de quem executa — e numa fronteira de mês isso devolve o
 * mês anterior para quem está a oeste de Greenwich. A janela é de calendário, não um
 * instante, e calendário se calcula em números.
 */
function firstDayMonthsBefore(day: string, months: number): string {
  const [ano, mes] = day.split("-").map(Number);
  if (!ano || !mes) return day;

  /* Meses desde o ano zero, para não tratar a virada de ano como caso especial. */
  const total = ano * 12 + (mes - 1) - months;
  const anoFinal = Math.floor(total / 12);
  const mesFinal = (total % 12) + 1;

  return `${anoFinal}-${String(mesFinal).padStart(2, "0")}-01`;
}

/**
 * A janela da linha, a partir do recorte do painel.
 *
 * Sem `to`, hoje — que é o que o painel usa quando ninguém escolheu fim. `sv-SE` dá
 * `YYYY-MM-DD` sem montar a data à mão.
 */
export function historyWindow(
  to: string | undefined,
  now = new Date(),
): { from: string; to: string } {
  const fim = toDay(to) ?? now.toLocaleDateString("sv-SE");
  return { from: firstDayMonthsBefore(fim, HISTORY_MONTHS - 1), to: fim };
}

/**
 * Com quantos pontos a linha é desenhada.
 *
 * ## Por que não é "dois"
 *
 * Era. E foi por isso que o gráfico "continuava não aparecendo": numa organização
 * com um mês de uso a série tem um ponto, o corte em dois devolvia uma frase, e quem
 * pediu um gráfico de linha leu isso como ausência de gráfico. Uma linha de um ponto
 * não desenha traço, mas desenha o ponto — e eixo, grade e escala já respondem "onde
 * estamos", que é metade do que o painel promete.
 *
 * Sem ponto nenhum não há o que desenhar, e aí a frase é a resposta certa.
 */
export function deveDesenharEvolucao(pontos: number): boolean {
  return pontos > 0;
}

/**
 * Quando o ponto precisa de marca.
 *
 * Numa série de doze meses, doze marcas por linha viram ruído e a curva se lê
 * melhor sem elas. Com um ou dois pontos é o contrário: sem marca, um ponto único
 * não pinta pixel nenhum e o cartão mostra eixos vazios — o mesmo sintoma de "não
 * tem gráfico" que o corte em dois pontos causava.
 */
export function deveMarcarPontos(pontos: number): boolean {
  return pontos <= 2;
}
