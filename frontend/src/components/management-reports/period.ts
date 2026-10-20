/**
 * Os recortes de período que se pede na prática.
 *
 * Fora do componente porque a aritmética de mês é onde isto quebra: "mês
 * passado" em 1º de março tem de ser fevereiro inteiro, e em 31 de janeiro tem de
 * ser dezembro — não 31 de fevereiro nem 1º de janeiro. Aqui se testa sem DOM.
 */

/** Os recortes oferecidos, na ordem em que aparecem. */
export const PERIOD_PRESETS = [
  { id: "30d", label: "Últimos 30 dias" },
  { id: "90d", label: "Últimos 90 dias" },
  { id: "mes-atual", label: "Mês atual" },
  { id: "mes-passado", label: "Mês passado" },
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]["id"];

export interface DayRange {
  /** `YYYY-MM-DD`, inclusivo. */
  readonly from: string;
  /** `YYYY-MM-DD`, inclusivo. */
  readonly to: string;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * O recorte em dias, em UTC.
 *
 * Sem hora e sem fuso, como o gerador de relatório faz: quem decide onde o dia
 * começa é o servidor, a partir da unidade de negócio. Converter para o fuso do
 * navegador faria o mesmo "outubro" começar em horas diferentes conforme quem
 * clicou.
 */
export function periodFor(
  preset: PeriodPresetId,
  today = new Date(),
): DayRange {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  if (preset === "mes-atual") {
    return { from: day(new Date(Date.UTC(year, month, 1))), to: day(today) };
  }

  if (preset === "mes-passado") {
    return {
      from: day(new Date(Date.UTC(year, month - 1, 1))),
      /* Dia 0 do mês atual é o último dia do anterior — e `Date.UTC` resolve a
         virada de ano sozinho: mês -1 em janeiro é dezembro do ano anterior. */
      to: day(new Date(Date.UTC(year, month, 0))),
    };
  }

  const days = preset === "90d" ? 90 : 30;
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - days);
  return { from: day(start), to: day(today) };
}

/** `2026-03-31` → `31/03/2026`, para exibir o recorte escolhido. */
export function formatDayRange(range: DayRange): string {
  const br = (dia: string) => dia.split("-").reverse().join("/");
  return `${br(range.from)} a ${br(range.to)}`;
}
