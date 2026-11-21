/**
 * O assistente de chamado, sem tela — o mesmo do app.
 *
 * Obrigatório é só o mínimo para alguém entender o pedido: do que se trata,
 * um assunto e o que está acontecendo. O resto ajuda o técnico e se pula.
 */
import type { ServiceRequest } from "./portal-types";

export const REQUEST_CATEGORIES = [
  { code: "EQUIPMENT_PROBLEM", label: "Problema em equipamento" },
  { code: "MAINTENANCE", label: "Manutenção" },
  { code: "SERVICE_REQUEST", label: "Solicitar um serviço" },
  { code: "DOCUMENT_REQUEST", label: "Pedir um documento" },
  { code: "QUESTION", label: "Tirar uma dúvida" },
  { code: "OTHER", label: "Outro assunto" },
] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number]["code"];

export const REQUEST_URGENCIES = [
  { code: "LOW", label: "Baixa", hint: "Pode esperar alguns dias" },
  { code: "NORMAL", label: "Normal", hint: "Na próxima visita possível" },
  { code: "HIGH", label: "Alta", hint: "Atrapalha o funcionamento do local" },
  { code: "URGENT", label: "Urgente", hint: "Precisa de atendimento hoje" },
] as const;
export type RequestUrgency = (typeof REQUEST_URGENCIES)[number]["code"];

export const EQUIPMENT_CONDITIONS = [
  { code: "STOPPED", label: "Parado" },
  { code: "MALFUNCTIONING", label: "Funcionando com problema" },
  { code: "WORKING", label: "Funcionando normalmente" },
] as const;
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number]["code"];

export const DESCRIPTION_HINTS: Record<RequestCategory, string> = {
  EQUIPMENT_PROBLEM:
    "Ex.: desde quando, se faz barulho, se pinga água, se aparece algum código no visor.",
  MAINTENANCE:
    "Ex.: quais equipamentos, quando foi a última manutenção, alguma preferência de data.",
  SERVICE_REQUEST:
    "Ex.: o que precisa ser feito, onde, tamanho do ambiente, prazo desejado.",
  DOCUMENT_REQUEST:
    "Ex.: qual documento, de qual período e para quê (fiscalização, contabilidade…).",
  QUESTION: "Escreva sua dúvida com o máximo de detalhes.",
  OTHER: "Conte o que você precisa.",
};

export interface RequestDraft {
  category: RequestCategory | null;
  assetId: string | null;
  equipmentCondition: EquipmentCondition | null;
  subject: string;
  description: string;
  urgency: RequestUrgency;
  siteLocation: string;
  availability: string;
  contactName: string;
  contactPhone: string;
}

export const WIZARD_STEPS = [
  "Sobre o que é?",
  "Qual equipamento?",
  "Conte o que está acontecendo",
  "Para a visita",
  "Revise e envie",
] as const;

export function emptyDraft(
  contactName = "",
  assetId: string | null = null,
): RequestDraft {
  return {
    category: null,
    assetId,
    equipmentCondition: null,
    subject: "",
    description: "",
    urgency: "NORMAL",
    siteLocation: "",
    availability: "",
    contactName,
    contactPhone: "",
  };
}

/** O rascunho com o que está gravado — a edição parte daqui. */
export function draftFrom(request: ServiceRequest): RequestDraft {
  return {
    category: request.category.code,
    assetId: request.asset?.id ?? null,
    equipmentCondition: request.details.equipmentCondition?.code ?? null,
    subject: request.subject,
    description: request.description,
    urgency: request.urgency.code,
    siteLocation: request.details.siteLocation ?? "",
    availability: request.details.availability ?? "",
    contactName: request.details.contactName ?? "",
    contactPhone: request.details.contactPhone ?? "",
  };
}

/** O que impede seguir no passo; `null` quando pode avançar. */
export function stepProblem(step: number, draft: RequestDraft): string | null {
  if (step === 0 && !draft.category)
    return "Escolha do que se trata o chamado.";
  if (step === 2 && draft.subject.trim().length < 3)
    return "Escreva um assunto com pelo menos 3 letras.";
  if (step === 2 && draft.description.trim().length < 5)
    return "Descreva o que está acontecendo (pelo menos 5 letras).";
  return null;
}

/** O assunto sugerido pela categoria e pelo equipamento — editável. */
export function suggestedSubject(
  category: RequestCategory | null,
  assetName: string | null,
): string {
  const rotulo =
    REQUEST_CATEGORIES.find((c) => c.code === category)?.label ?? "";
  return assetName ? `${rotulo} — ${assetName}` : rotulo;
}

/** O corpo da API: detalhes só com o que foi preenchido. */
export function requestPayload(draft: RequestDraft) {
  const details: Record<string, string> = {};
  if (draft.assetId && draft.equipmentCondition)
    details.equipmentCondition = draft.equipmentCondition;
  for (const chave of [
    "siteLocation",
    "availability",
    "contactName",
    "contactPhone",
  ] as const) {
    const valor = draft[chave].trim();
    if (valor) details[chave] = valor;
  }
  return {
    category: draft.category ?? "OTHER",
    subject: draft.subject.trim(),
    description: draft.description.trim(),
    ...(draft.assetId ? { assetId: draft.assetId } : {}),
    urgency: draft.urgency,
    details,
  };
}

/** Uma chave por envio: a nova tentativa é o mesmo pedido. */
export function newIdempotencyKey(): string {
  const aleatorio =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now()}`;
  return `web-${aleatorio}`;
}

export type RequestTone = "info" | "warning" | "success" | "danger" | "neutral";

export function requestTone(status: string): RequestTone {
  if (status === "WAITING_CUSTOMER") return "warning";
  if (status === "RESOLVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "CANCELLED") return "neutral";
  return "info";
}

export function isActiveRequest(status: string): boolean {
  return ["OPEN", "IN_TRIAGE", "IN_PROGRESS", "WAITING_CUSTOMER"].includes(
    status,
  );
}

/** "Urgente", e não "Urgência urgente". */
export function urgencyBadge(code: string, label: string): string {
  return code === "URGENT" ? "Urgente" : `Urgência ${label.toLowerCase()}`;
}

const MARCOS: Record<string, string> = {
  CREATED: "Chamado aberto",
  CANCELLED: "Chamado cancelado",
  CUSTOMER_UPDATED: "Chamado atualizado pelo cliente",
  ASSIGNED: "Um responsável foi definido",
  OPERATION_LINKED: "Virou um atendimento agendado",
};
const SITUACOES: Record<string, string> = {
  IN_TRIAGE: "A equipe começou a analisar",
  IN_PROGRESS: "Em atendimento",
  WAITING_CUSTOMER: "Aguardando o cliente",
  RESOLVED: "Chamado resolvido",
  REJECTED: "Chamado recusado",
  CANCELLED: "Chamado cancelado",
};

/** O marco da linha do tempo, quando o evento não traz mensagem. */
export function timelineMilestone(type: string, to: string | null): string {
  return MARCOS[type] ?? (to ? SITUACOES[to] : undefined) ?? "Situação atualizada";
}
