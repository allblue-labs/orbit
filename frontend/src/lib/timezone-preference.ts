import { DEFAULT_TIMEZONE } from "@/lib/env";
import { isValidTimeZone } from "@/lib/scheduling/timezone";

export interface ResolvedTimeZone {
  readonly timeZone: string;
  readonly origin: string;
}

interface UnitTimeZone {
  id: string;
  timezone?: string | null;
  isPrimary?: boolean;
  tradeName?: string | null;
  legalName?: string | null;
}

/** Personal display preference wins over unit and device defaults. */
export function resolveTimeZone({
  preferredTimeZone,
  businessUnits = [],
  businessUnitId,
  browserTimeZone,
}: {
  preferredTimeZone?: string | null;
  businessUnits?: readonly UnitTimeZone[];
  businessUnitId?: string | null;
  browserTimeZone?: string | null;
}): ResolvedTimeZone {
  if (preferredTimeZone && isValidTimeZone(preferredTimeZone)) {
    return { timeZone: preferredTimeZone, origin: "preferência da sua conta" };
  }
  const active = businessUnits.find((unit) => unit.id === businessUnitId);
  const primary =
    businessUnits.find((unit) => unit.isPrimary) ?? businessUnits[0];
  for (const unit of [active, primary]) {
    if (unit?.timezone && isValidTimeZone(unit.timezone)) {
      return {
        timeZone: unit.timezone,
        origin: `unidade ${unit.tradeName ?? unit.legalName ?? "principal"}`,
      };
    }
  }
  if (browserTimeZone && isValidTimeZone(browserTimeZone)) {
    return { timeZone: browserTimeZone, origin: "fuso deste navegador" };
  }
  return { timeZone: DEFAULT_TIMEZONE, origin: "padrão da aplicação" };
}
