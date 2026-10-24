import {
  OPERATION_HISTORY_LABELS,
  OPERATION_STATUS_LABELS,
  type OperationHistoryEntry,
} from "@/types/operations";

const EXPLANATIONS: Readonly<Record<string, string>> = {
  FIELD_DOCUMENT_PREPARED:
    "Os dados do atendimento foram reunidos para preparar o documento.",
  FIELD_EVIDENCE_ADDED:
    "Uma foto ou outro registro do atendimento foi adicionado.",
  CUSTOMER_ACKNOWLEDGEMENT_CAPTURED:
    "A confirmação do cliente sobre o atendimento foi registrada.",
  ASSIGNMENT_AUTHORIZED:
    "O atendimento foi liberado para a equipe responsável.",
  ASSIGNMENT_AUTHORIZATION_REVOKED:
    "A liberação deste atendimento para a equipe foi retirada.",
};

/** Only known presentation fields are shown; audit payloads can contain IDs and hashes. */
export function presentOperationHistory(
  entry: Pick<
    OperationHistoryEntry,
    "action" | "fromStatus" | "toStatus" | "details"
  >,
): { title: string; explanation?: string } {
  const details =
    entry.details &&
    typeof entry.details === "object" &&
    !Array.isArray(entry.details)
      ? (entry.details as Record<string, unknown>)
      : {};
  let title = Object.hasOwn(OPERATION_HISTORY_LABELS, entry.action)
    ? OPERATION_HISTORY_LABELS[entry.action]
    : "Atualização registrada na operação";
  let explanation = Object.hasOwn(EXPLANATIONS, entry.action)
    ? EXPLANATIONS[entry.action]
    : undefined;

  if (entry.action === "STATUS_CHANGED") {
    const from =
      entry.fromStatus &&
      Object.hasOwn(OPERATION_STATUS_LABELS, entry.fromStatus)
        ? OPERATION_STATUS_LABELS[entry.fromStatus]
        : null;
    const to =
      entry.toStatus && Object.hasOwn(OPERATION_STATUS_LABELS, entry.toStatus)
        ? OPERATION_STATUS_LABELS[entry.toStatus]
        : null;
    if (from && to)
      title = `Situação alterada de ${from.toLocaleLowerCase("pt-BR")} para ${to.toLocaleLowerCase("pt-BR")}`;
    else if (to)
      title = `Situação alterada para ${to.toLocaleLowerCase("pt-BR")}`;
  }
  if (entry.action === "FIELD_CHECKLIST_UPDATED") {
    if (details.completed === true) title = "Checklist concluído em campo";
    if (
      typeof details.progress === "number" &&
      Number.isFinite(details.progress) &&
      details.progress >= 0 &&
      details.progress <= 100
    ) {
      explanation = `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(details.progress)}% do checklist preenchido.`;
    }
  }
  if (
    entry.action === "CUSTOMER_ACKNOWLEDGEMENT_CAPTURED" &&
    details.hasSignature === true
  ) {
    title = "Assinatura do cliente registrada";
  }
  return { title, explanation };
}
