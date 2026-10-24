/**
 * Contexto de requisição do browser.
 *
 * Mantido em um único lugar para que toda chamada — de qualquer módulo —
 * envie automaticamente organização, unidade, locale e timezone. O
 * `RequestContextProvider` mantém este store sincronizado com a sessão.
 */
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/lib/env";
import type { OrbitRequestContext } from "@/types/api";
import { generateRequestId } from "@/utils/http";

export type AmbientContext = Omit<OrbitRequestContext, "requestId">;

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function detectLocale(): string {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  return navigator.language || DEFAULT_LOCALE;
}

/** Device defaults must not inherit a previous signed-in user's preferences. */
export function getDeviceContext(): Pick<
  AmbientContext,
  "locale" | "timezone"
> {
  return { locale: detectLocale(), timezone: detectTimezone() };
}

let ambient: AmbientContext = {
  organizationId: null,
  businessUnitId: null,
  locale: DEFAULT_LOCALE,
  timezone: DEFAULT_TIMEZONE,
};

let initialized = false;

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  ambient = {
    ...ambient,
    locale: detectLocale(),
    timezone: detectTimezone(),
  };
  initialized = true;
}

export function getAmbientContext(): AmbientContext {
  ensureInitialized();
  return ambient;
}

/** Atualiza o contexto ambiente (usado pelo `RequestContextProvider`). */
export function setAmbientContext(patch: Partial<AmbientContext>): void {
  ensureInitialized();
  ambient = { ...ambient, ...patch };
}

/** Contexto final de uma requisição, com `requestId` recém-gerado. */
export function resolveRequestContext(
  override?: Partial<OrbitRequestContext>,
): OrbitRequestContext {
  const base = getAmbientContext();
  return {
    organizationId: override?.organizationId ?? base.organizationId,
    businessUnitId: override?.businessUnitId ?? base.businessUnitId,
    locale: override?.locale ?? base.locale,
    timezone: override?.timezone ?? base.timezone,
    requestId: override?.requestId ?? generateRequestId(),
  };
}
