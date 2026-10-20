/**
 * Períodos ancorados no aniversário da assinatura.
 *
 * Uma única aritmética serve às duas perguntas do produto: qual é o período de
 * cobrança e qual é a janela de uso. A diferença entre elas é o **tamanho**,
 * não o método — cobrança pode ser de 1, 6 ou 12 meses; uso é sempre de 1 (§5).
 * Escrever duas contas parecidas seria convidar as duas a divergirem.
 *
 * Nada aqui conhece o mês do calendário. Quem assinou dia 17 tem períodos que
 * começam dia 17, e um cliente que assinou em 30 de setembro não perde meio mês
 * porque outubro começou (§7).
 */
export interface AnchoredPeriod {
  readonly start: Date;
  readonly end: Date;
}

/**
 * O período de `months` meses, ancorado em `anchor`, que contém `at`.
 *
 * O fim é **exclusivo**: o instante exato do aniversário já pertence ao
 * período seguinte. Sem essa escolha, um evento na virada caberia em dois
 * períodos e seria contado duas vezes.
 */
export function anchoredPeriod(
  anchor: Date,
  months: number,
  at: Date,
): AnchoredPeriod {
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error(`Período inválido: ${months} meses.`);
  }
  let indice = Math.floor(mesesEntre(anchor, at) / months);
  while (addMonths(anchor, indice * months) > at) indice -= 1;
  while (addMonths(anchor, (indice + 1) * months) <= at) indice += 1;
  return {
    start: addMonths(anchor, indice * months),
    end: addMonths(anchor, (indice + 1) * months),
  };
}

/**
 * Soma meses preservando a hora e prendendo o dia ao fim do mês curto.
 *
 * Âncora em 31 de janeiro passa por 28 de fevereiro e volta a 31 de março —
 * porque **toda** janela é calculada da âncora original, e não da anterior.
 * Somar de janela em janela derraparia para o dia 28 para sempre, e um ano
 * depois o cliente estaria sendo cobrado noutro dia do mês (§8).
 */
export function addMonths(anchor: Date, months: number): Date {
  const alvo = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + months,
      1,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
  const ultimoDia = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0),
  ).getUTCDate();
  alvo.setUTCDate(Math.min(anchor.getUTCDate(), ultimoDia));
  return alvo;
}

function mesesEntre(anchor: Date, at: Date): number {
  return (
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - anchor.getUTCMonth())
  );
}
