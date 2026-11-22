/**
 * Os recortes do fluxo financeiro: 7 dias, 15 dias, este mês e 12 meses.
 *
 * ## Por que recortes fixos
 *
 * "Como foi a semana?" e "como fecha o mês?" são as perguntas de quem toca
 * uma empresa de manutenção — não "de 03/11 a 17/11". Quatro botões
 * respondem as quatro perguntas sem calendário.
 *
 * ## Calendário em números
 *
 * Tudo aqui é aritmética de data civil em UTC (`Date.UTC`): o dia de hoje
 * chega pronto, no fuso da unidade, e nenhuma conta depende do fuso de quem
 * abre a tela.
 */

export type FinancialWindowKey = "7D" | "15D" | "MONTH" | "12M";

export const FINANCIAL_WINDOWS: ReadonlyArray<{
  key: FinancialWindowKey;
  label: string;
  /** Para o subtítulo: "nos últimos 7 dias". */
  phrase: string;
}> = [
  { key: "7D", label: "7 dias", phrase: "nos últimos 7 dias" },
  { key: "15D", label: "15 dias", phrase: "nos últimos 15 dias" },
  { key: "MONTH", label: "Este mês", phrase: "neste mês" },
  { key: "12M", label: "12 meses", phrase: "nos últimos 12 meses" },
];

export interface FinancialWindow {
  from: string;
  to: string;
  granularity: "DAY" | "MONTH";
}

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const parse = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
};

/** O recorte para hoje (`YYYY-MM-DD`, no fuso da unidade). */
export function financialWindow(
  key: FinancialWindowKey,
  today: string,
): FinancialWindow {
  const hoje = parse(today);
  const y = hoje.getUTCFullYear();
  const m = hoje.getUTCMonth();
  switch (key) {
    case "7D":
    case "15D": {
      const days = key === "7D" ? 7 : 15;
      const from = new Date(Date.UTC(y, m, hoje.getUTCDate() - (days - 1)));
      return { from: iso(from), to: today, granularity: "DAY" };
    }
    case "MONTH":
      /* O mês inteiro: o que vence até o fim dele também é deste mês. */
      return {
        from: iso(new Date(Date.UTC(y, m, 1))),
        to: iso(new Date(Date.UTC(y, m + 1, 0))),
        granularity: "DAY",
      };
    case "12M":
      return {
        from: iso(new Date(Date.UTC(y, m - 11, 1))),
        to: iso(new Date(Date.UTC(y, m + 1, 0))),
        granularity: "MONTH",
      };
  }
}

/** Todos os períodos do recorte — dia a dia, ou mês a mês. */
export function windowPeriods(window: FinancialWindow): string[] {
  const out: string[] = [];
  const end = parse(window.to);
  if (window.granularity === "DAY") {
    for (let d = parse(window.from); d <= end; d = new Date(d.getTime() + 86_400_000))
      out.push(iso(d));
    return out;
  }
  const start = parse(window.from);
  for (
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    d <= end;
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  )
    out.push(iso(d).slice(0, 7));
  return out;
}

export interface FlowPoint {
  period: string;
  incomeConfirmed: string;
  incomePending: string;
  expenseConfirmed: string;
  expensePending: string;
  netConfirmed: string;
}

export interface FlowRow {
  period: string;
  label: string;
  recebido: number;
  aReceber: number;
  pago: number;
  aPagar: number;
  /** Saldo realizado do próprio dia (ou mês). */
  saldo: number;
  /** Recebido menos pago, somado do início do recorte até aqui. */
  saldoAcumulado: number;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** `03/11` para dia; `nov/26` para mês. */
export function periodLabel(period: string): string {
  const [y, m, d] = period.split("-");
  if (d) return `${d}/${m}`;
  return `${MESES[Number(m) - 1] ?? m}/${(y ?? "").slice(2)}`;
}

/**
 * A série completa do recorte, com zero onde não houve movimento.
 *
 * O servidor só devolve os períodos que têm lançamento; um gráfico de barras
 * que pulasse os dias vazios faria três dias parecerem uma semana.
 */
export function flowRows(
  points: readonly FlowPoint[],
  window: FinancialWindow,
): FlowRow[] {
  const byPeriod = new Map(points.map((point) => [point.period, point]));
  let acumulado = 0;
  return windowPeriods(window).map((period) => {
    const point = byPeriod.get(period);
    acumulado += Number(point?.netConfirmed ?? 0);
    return {
      period,
      label: periodLabel(period),
      recebido: Number(point?.incomeConfirmed ?? 0),
      aReceber: Number(point?.incomePending ?? 0),
      pago: Number(point?.expenseConfirmed ?? 0),
      aPagar: Number(point?.expensePending ?? 0),
      saldo: Number(point?.netConfirmed ?? 0),
      /* Arredonda para centavos: somar decimais em ponto flutuante deixa
         0,30000000000000004 na dica do cursor. */
      saldoAcumulado: Math.round(acumulado * 100) / 100,
    };
  });
}

/**
 * A situação de um lado do caixa: o que entrou, o que falta e o que venceu.
 *
 * "A receber" exclui o vencido — os dois somados já são o previsto, e mostrar
 * o vencido dentro do previsto esconderia justamente o que pede cobrança.
 */
export function statusSlices(
  side: "INCOME" | "EXPENSE",
  totals: {
    confirmed: string;
    pending: string;
    overdue: string;
  },
): Array<{ key: string; label: string; value: number }> {
  const confirmed = Number(totals.confirmed) || 0;
  const overdue = Number(totals.overdue) || 0;
  const pending = Math.max((Number(totals.pending) || 0) - overdue, 0);
  const labels =
    side === "INCOME"
      ? { confirmed: "Recebido", pending: "A receber", overdue: "Vencido (a cobrar)" }
      : { confirmed: "Pago", pending: "A pagar", overdue: "Contas vencidas" };
  return [
    { key: "confirmed", label: labels.confirmed, value: confirmed },
    { key: "pending", label: labels.pending, value: pending },
    { key: "overdue", label: labels.overdue, value: overdue },
  ];
}
