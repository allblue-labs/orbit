/**
 * O que um chamado leva para o atendimento e para o orçamento.
 *
 * O cliente já disse muita coisa ao abrir o chamado: o equipamento, o estado
 * dele, onde fica, quando dá para receber o técnico e com quem falar. Quem cria
 * o atendimento ou o orçamento não deveria redigitar nada disso — e o técnico,
 * lá na ponta, precisa ler o mesmo texto que o cliente escreveu.
 *
 * Funções puras: a tela só chama e mostra.
 */
import type { QuoteDraft } from "@/components/quotes/wizard/quote-wizard.model";
import type { CustomerServiceRequestDetailsReadModel as ServiceRequest } from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";

/** Os detalhes do chamado em linhas "Rótulo: valor", sem as vazias. */
export function requestDetailLines(request: ServiceRequest): string[] {
  const d = request.details;
  const contato = d.contactName
    ? `${d.contactName}${d.contactPhone ? ` — ${d.contactPhone}` : ""}`
    : d.contactPhone;
  return [
    request.asset
      ? `Equipamento: ${[request.asset.name, request.asset.identifier].filter(Boolean).join(" · ")}`
      : null,
    d.equipmentCondition ? `Situação do equipamento: ${d.equipmentCondition.label}` : null,
    d.siteLocation ? `Local: ${d.siteLocation}` : null,
    d.availability ? `Melhor horário: ${d.availability}` : null,
    contato ? `Contato no local: ${contato}` : null,
  ].filter((line): line is string => Boolean(line));
}

/**
 * A descrição do atendimento: o pedido do cliente, os detalhes e a origem.
 * O equipamento em si já vai vinculado pelo servidor; aqui ele aparece para o
 * técnico ler junto com o resto.
 */
export function operationDescription(request: ServiceRequest): string {
  return [
    request.description.trim(),
    requestDetailLines(request).join("\n"),
    `Origem: chamado ${request.code}${request.urgency.code === "URGENT" || request.urgency.code === "HIGH" ? ` (urgência ${request.urgency.label.toLowerCase()})` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
}

/** O tipo do atendimento pelo que o cliente pediu. */
export function operationKind(request: ServiceRequest): string {
  switch (request.category.code) {
    case "EQUIPMENT_PROBLEM":
    case "MAINTENANCE":
      return "MAINTENANCE";
    case "SERVICE_REQUEST":
      return request.asset ? "MAINTENANCE" : "INSTALLATION";
    default:
      return "OTHER";
  }
}

/** `OS-AAAAMMDD-NNNNNN` — o mesmo formato das ordens criadas na web. */
export function suggestedOperationCode(now = new Date(), random?: number): string {
  const data = now.toISOString().slice(0, 10).replaceAll("-", "");
  const sorteio =
    random ?? crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return `OS-${data}-${String(sorteio % 1_000_000).padStart(6, "0")}`;
}

/**
 * O rascunho do orçamento a partir do chamado.
 *
 * Cliente e equipamento entram como dados do orçamento; o pedido e os detalhes
 * viram o "objeto da proposta", que a pessoa ajusta antes de gerar.
 */
export function quoteDraftFrom(request: ServiceRequest): Partial<QuoteDraft> {
  return {
    origin: "SCRATCH",
    customerId: request.customer.id,
    customerLabel: request.customer.name,
    assetIds: request.asset ? [request.asset.id] : [],
    title: request.subject.slice(0, 220),
    notes: [
      request.description.trim(),
      requestDetailLines(request)
        .filter((line) => !line.startsWith("Contato no local"))
        .join("\n"),
      `Referente ao chamado ${request.code}.`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000),
  };
}

/** A nota interna que liga o orçamento ao chamado. */
export function quoteLinkNote(quote: { code: string; title: string }): string {
  return `Orçamento ${quote.code} criado a partir deste chamado — "${quote.title}".`;
}
