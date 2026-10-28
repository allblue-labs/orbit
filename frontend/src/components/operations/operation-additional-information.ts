const LABELS: Record<string, string> = {
  source: "Origem do atendimento",
  reference_point: "Ponto de referência",
  reference: "Referência",
  complement: "Complemento",
  notes: "Observações",
  observations: "Observações",
  instructions: "Instruções de acesso",
  street: "Logradouro",
  number: "Número",
  district: "Bairro",
  city: "Cidade",
  state_code: "UF",
  postal_code: "CEP",
  address: "Endereço",
  latitude: "Latitude",
  longitude: "Longitude",
  contact: "Contato",
  name: "Nome",
  phone: "Telefone",
  email: "E-mail",
  description: "Descrição",
  sector: "Setor",
  location: "Localização",
};
const SOURCES: Record<string, string> = {
  MOBILE_WALK_IN: "Iniciado pelo técnico em campo",
  QUOTE: "Orçamento aprovado",
  WEB: "Cadastro na plataforma",
};
const INTERNAL = new Set([
  "id",
  "ids",
  "uuid",
  "hash",
  "sha256",
  "token",
  "signature",
  "secret",
  "version",
  "metadata",
  "field_execution",
  "field_record",
  "checklist",
  "checklists",
  "evidence",
  "materials",
  "acknowledgement",
  "storage",
  "snapshot",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function operationAdditionalInformation(
  location: unknown,
  data: unknown,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const visit = (input: unknown, prefix: string, depth: number) => {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      depth > 3
    )
      return;
    for (const [key, value] of Object.entries(input)) {
      const normalized = key
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[\s-]+/g, "_")
        .toLowerCase();
      if (
        normalized.split("_").some((part) => INTERNAL.has(part)) ||
        INTERNAL.has(normalized) ||
        /^(?:created|updated|deleted|authorized|started|completed)_at$/.test(
          normalized,
        )
      )
        continue;
      const name =
        (Object.hasOwn(LABELS, normalized) ? LABELS[normalized] : undefined) ??
        normalized
          .replaceAll("_", " ")
          .replace(/^./, (first) => first.toLocaleUpperCase("pt-BR"));
      const label = prefix ? `${prefix} · ${name}` : name;
      if (
        typeof value === "string" &&
        value.trim() &&
        !UUID.test(value.trim()) &&
        !/^[{[]/.test(value.trim())
      ) {
        const text = normalized === "source" ? (Object.hasOwn(SOURCES, value) ? SOURCES[value] : undefined) : value.trim();
        if (text) rows.push({ label, value: text });
      } else if (typeof value === "number" && Number.isFinite(value))
        rows.push({ label, value: value.toLocaleString("pt-BR") });
      else if (typeof value === "boolean")
        rows.push({ label, value: value ? "Sim" : "Não" });
      else if (Array.isArray(value))
        value.slice(0, 10).forEach((item) => visit(item, label, depth + 1));
      else visit(value, label, depth + 1);
    }
  };
  visit(location, "", 0);
  visit(data, "", 0);
  return rows.slice(0, 30);
}
