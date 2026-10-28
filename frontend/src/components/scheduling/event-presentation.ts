/** Texto de apresentação: objetos internos nunca são impressos no drawer. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function schedulingAddress(value: unknown): string[] {
  if (typeof value === "string") {
    const content = value.trim();
    if (content.startsWith("{") || content.startsWith("[")) {
      try {
        return schedulingAddress(JSON.parse(content) as unknown);
      } catch {
        return [];
      }
    }
    return content ? [content] : [];
  }
  if (Array.isArray(value)) return value.flatMap(schedulingAddress);
  const root = record(value);
  const address = { ...root, ...record(root.address) };
  const pick = (...keys: string[]) =>
    keys.map((key) => text(address[key])).find(Boolean) ?? "";
  const street = pick("street", "logradouro", "addressLine1");
  const number = pick("number", "numero");
  const complement = pick("complement", "complemento", "addressLine2");
  const district = pick("district", "neighborhood", "bairro");
  const city = pick("city", "cidade", "localidade");
  const state = pick("stateCode", "uf", "state", "estado");
  const postal = pick("postalCode", "zipCode", "cep");
  const reference = pick("reference", "landmark", "notes", "pontoReferencia");
  const lines = [
    [street, number].filter(Boolean).join(", "),
    complement,
    district,
    [city, state].filter(Boolean).join(" / "),
    postal ? `CEP ${postal.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "",
    reference ? `Referência: ${reference}` : "",
  ].filter(Boolean);
  if (lines.length) return lines;
  if (typeof root.address === "string") return schedulingAddress(root.address);
  const label = pick(
    "formattedAddress",
    "addressText",
    "address",
    "label",
    "name",
  );
  if (label) return [label];
  const lat = pick("lat", "latitude"),
    lng = pick("lng", "lon", "longitude");
  return lat && lng ? [`Coordenadas: ${lat}, ${lng}`] : [];
}

const HISTORY: Readonly<Record<string, string>> = {
  CREATED: "Agendamento criado",
  UPDATED: "Agendamento atualizado",
  DELETED: "Agendamento excluído",
  CANCELLED: "Agendamento cancelado",
  RESOURCE_ALLOCATED: "Recurso adicionado à equipe",
  RESOURCE_RELEASED: "Recurso removido da equipe",
  STATUS_CHANGED: "Status atualizado",
  RESCHEDULED: "Agendamento remarcado",
};
export function schedulingHistoryLabel(action: string): string {
  return HISTORY[action] ?? "Agendamento atualizado";
}
export function allocationStatusLabel(status: string): string {
  return (
    (
      {
        ALLOCATED: "Alocado",
        CONFIRMED: "Confirmado",
        RELEASED: "Liberado",
        CANCELLED: "Cancelado",
        COMPLETED: "Concluído",
        ACTIVE: "Ativo",
        PENDING: "Pendente",
        DECLINED: "Recusado",
      } as Record<string, string>
    )[status] ?? "Registrado"
  );
}
