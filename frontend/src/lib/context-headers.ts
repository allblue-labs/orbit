/**
 * Nomes dos cabeçalhos de contexto — compartilhados entre browser, BFF e
 * backend. Fonte única para evitar divergência de grafia.
 */
export const CONTEXT_HEADERS = {
  correlationId: "x-correlation-id",
  requestId: "x-request-id",
  locale: "accept-language",
  timezone: "x-timezone",
  organizationId: "x-organization-id",
  businessUnitId: "x-business-unit-id",
} as const;

export type ContextHeaderName =
  (typeof CONTEXT_HEADERS)[keyof typeof CONTEXT_HEADERS];
