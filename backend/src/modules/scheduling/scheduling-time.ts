import { ValidationException } from '../../exceptions';

export type CivilDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const weekdays: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const formatters = new Map<string, Intl.DateTimeFormat>();

export function assertIanaTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0);
  } catch {
    throw new ValidationException(`Invalid IANA timezone: ${timezone}`);
  }
}

export function civilParts(instant: Date, timezone: string): CivilDateTime {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    assertIanaTimezone(timezone);
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timezone, formatter);
  }
  const values = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((part) => part.type === type)?.value ?? '0';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
    second: Number(read('second')),
    weekday: weekdays[read('weekday')] ?? 0,
  };
}

function offsetAt(instant: Date, timezone: string): number {
  const part = civilParts(instant, timezone);
  return (
    Date.UTC(
      part.year,
      part.month - 1,
      part.day,
      part.hour,
      part.minute,
      part.second,
    ) - instant.getTime()
  );
}

/** Converte hora civil em instante sem consultar o timezone do processo. */
export function instantFromCivil(
  part: Partial<Omit<CivilDateTime, 'weekday'>> &
    Pick<CivilDateTime, 'year' | 'month' | 'day'>,
  timezone: string,
): Date {
  assertIanaTimezone(timezone);
  const guess = Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour ?? 0,
    part.minute ?? 0,
    part.second ?? 0,
  );
  const first = guess - offsetAt(new Date(guess), timezone);
  return new Date(guess - offsetAt(new Date(first), timezone));
}

export function instantFromCivilDate(
  date: string,
  timezone: string,
  hour = 0,
  minute = 0,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new ValidationException(`Invalid civil date: ${date}`);
  return instantFromCivil(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour,
      minute,
    },
    timezone,
  );
}

export function civilDateKey(instant: Date, timezone: string): string {
  const part = civilParts(instant, timezone);
  return `${String(part.year).padStart(4, '0')}-${String(part.month).padStart(2, '0')}-${String(part.day).padStart(2, '0')}`;
}

export function civilMinute(instant: Date, timezone: string): number {
  const part = civilParts(instant, timezone);
  return part.hour * 60 + part.minute;
}

export function availabilityRuleApplies(
  rule: {
    dayOfWeek: number | null;
    date: Date | null;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    timezone: string;
  },
  startsAt: Date,
): boolean {
  const date = civilDateKey(startsAt, rule.timezone);
  if (rule.date && rule.date.toISOString().slice(0, 10) !== date) return false;
  if (
    rule.date === null &&
    rule.dayOfWeek !== civilParts(startsAt, rule.timezone).weekday
  )
    return false;
  if (rule.effectiveFrom && startsAt < rule.effectiveFrom) return false;
  if (rule.effectiveUntil && startsAt > rule.effectiveUntil) return false;
  return true;
}

export function addCivilDays(
  instant: Date,
  days: number,
  timezone: string,
): Date {
  const part = civilParts(instant, timezone);
  return instantFromCivil({ ...part, day: part.day + days }, timezone);
}

export function addCivilMonths(
  instant: Date,
  months: number,
  timezone: string,
): Date {
  const part = civilParts(instant, timezone);
  return instantFromCivil({ ...part, month: part.month + months }, timezone);
}

export function localViewRange(
  view: string,
  civilDate: Date,
  timezone: string,
): { from: Date; to: Date } {
  // AgendaQueryDto representa um DATE civil. Seus componentes UTC preservam a
  // string YYYY-MM-DD recebida, sem convertê-la para o timezone do servidor.
  let part = {
    year: civilDate.getUTCFullYear(),
    month: civilDate.getUTCMonth() + 1,
    day: civilDate.getUTCDate(),
  };
  let from = instantFromCivil(part, timezone);
  if (view === 'WEEK') {
    from = addCivilDays(from, -civilParts(from, timezone).weekday, timezone);
  } else if (view === 'MONTH') {
    part = { ...part, day: 1 };
    from = instantFromCivil(part, timezone);
  }
  const to =
    view === 'DAY'
      ? addCivilDays(from, 1, timezone)
      : view === 'WEEK'
        ? addCivilDays(from, 7, timezone)
        : addCivilMonths(from, 1, timezone);
  return { from, to };
}
