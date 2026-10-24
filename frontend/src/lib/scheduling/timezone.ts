/**
 * Aritmética de datas em um fuso nomeado.
 *
 * A agenda é o único módulo do Orbit em que "que dia é este evento?" depende
 * do fuso: uma visita às 22h em `America/Recife` acontece no dia seguinte em
 * UTC. Usar as funções nativas de `Date` — que operam no fuso do navegador —
 * colocaria eventos no dia errado para quem abrisse a tela viajando, e o
 * comportamento mudaria conforme a máquina.
 *
 * **Sem dependência externa.** `Intl.DateTimeFormat` sabe converter um
 * instante para as partes de parede de qualquer fuso IANA; o caminho inverso
 * é resolvido com duas passadas de compensação de deslocamento, que é o que
 * uma biblioteca faria. São ~60 linhas contra um pacote a mais no bundle.
 *
 * Convenção deste módulo:
 *
 * - **instante** é um `Date` — um ponto absoluto no tempo, sem fuso;
 * - **parede** (`ZonedParts`) é o que um relógio naquele fuso mostraria.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = domingo, como `Date#getDay`. */
  weekday: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** O que um relógio no fuso indicado mostraria neste instante. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    /** Algumas versões de ICU devolvem "24" para a meia-noite. */
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: WEEKDAY_INDEX[read("weekday")] ?? 0,
  };
}

/** Deslocamento do fuso neste instante, em milissegundos. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * Instante correspondente a uma hora de parede naquele fuso.
 *
 * Duas passadas: a primeira estima o deslocamento com o palpite em UTC, a
 * segunda corrige quando o palpite caiu do outro lado de uma virada de
 * horário de verão. É o mesmo procedimento das bibliotecas de fuso.
 *
 * Em horários que não existem (o salto de primavera) o resultado é o instante
 * seguinte válido; em horários ambíguos (o retorno do outono) o primeiro dos
 * dois. Nenhum dos dois casos ocorre hoje no Brasil, mas o comportamento é
 * definido em vez de acidental.
 */
export function instantFromZoned(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const firstPass = utcGuess - offsetAt(new Date(utcGuess), timeZone);
  const secondPass = utcGuess - offsetAt(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/** Meia-noite local do dia deste instante, como instante. */
/** A datetime-local input carries wall time, not the device's timezone. */
export function instantFromLocalInput(local: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    local,
  );
  if (!match) return new Date(local);
  return instantFromZoned(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] ?? 0),
    },
    timeZone,
  );
}

export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const parts = zonedParts(instant, timeZone);
  return instantFromZoned(
    { year: parts.year, month: parts.month, day: parts.day },
    timeZone,
  );
}

/**
 * Soma dias no calendário local.
 *
 * Não é somar 24 horas: em uma virada de horário de verão o dia tem 23 ou 25
 * horas, e somar em milissegundos deslocaria o horário de parede.
 */
export function addZonedDays(
  instant: Date,
  days: number,
  timeZone: string,
): Date {
  const parts = zonedParts(instant, timeZone);
  return instantFromZoned(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + days,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  );
}

export function addZonedMonths(
  instant: Date,
  months: number,
  timeZone: string,
): Date {
  const parts = zonedParts(instant, timeZone);
  return instantFromZoned(
    { year: parts.year, month: parts.month + months, day: parts.day },
    timeZone,
  );
}

/** Domingo da semana deste instante, à meia-noite local. */
export function startOfZonedWeek(instant: Date, timeZone: string): Date {
  const parts = zonedParts(instant, timeZone);
  return instantFromZoned(
    { year: parts.year, month: parts.month, day: parts.day - parts.weekday },
    timeZone,
  );
}

/** Primeiro dia do mês deste instante, à meia-noite local. */
export function startOfZonedMonth(instant: Date, timeZone: string): Date {
  const parts = zonedParts(instant, timeZone);
  return instantFromZoned(
    { year: parts.year, month: parts.month, day: 1 },
    timeZone,
  );
}

/**
 * Chave `AAAA-MM-DD` do dia local.
 *
 * É por esta chave que os eventos são agrupados nas visões — e é justamente
 * o que difere de `startsAt.slice(0, 10)`, que devolve o dia **em UTC**.
 */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

/** Minutos desde a meia-noite local — usado para posicionar na grade. */
export function minutesIntoZonedDay(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function isSameZonedDay(
  left: Date,
  right: Date,
  timeZone: string,
): boolean {
  return zonedDateKey(left, timeZone) === zonedDateKey(right, timeZone);
}

const displayCache = new Map<string, Intl.DateTimeFormat>();

function displayFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  const cached = displayCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("pt-BR", { ...options, timeZone });
  displayCache.set(key, formatter);
  return formatter;
}

/** Formata um instante no fuso indicado — nunca no fuso do navegador. */
export function formatInZone(
  instant: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "—";
  return displayFormatter(timeZone, options).format(date);
}

export const formatZonedTime = (
  instant: Date | string,
  timeZone: string,
): string =>
  formatInZone(instant, timeZone, { hour: "2-digit", minute: "2-digit" });

export const formatZonedDate = (
  instant: Date | string,
  timeZone: string,
): string =>
  formatInZone(instant, timeZone, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export const formatZonedDateTime = (
  instant: Date | string,
  timeZone: string,
): string =>
  formatInZone(instant, timeZone, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Abreviação do fuso para exibir junto do horário (ex.: `GMT-3`). */
export function zoneAbbreviation(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}

/** O fuso é reconhecido por esta plataforma? */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
