const pattern =
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

export function safeCorrelationId(value: unknown): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}
