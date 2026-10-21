import { instantFromZoned } from "@/lib/scheduling";
import { OPERATION_LIMITS, type ChecklistItem } from "@/types/operations";

export const OPERATION_STEPS = [
  { title: "Cliente e local", description: "Escolha quem será atendido e confira as informações de acesso." },
  { title: "Serviço e equipamentos", description: "Descreva o atendimento e selecione os equipamentos envolvidos." },
  { title: "Agenda e equipe", description: "Defina a previsão de atendimento e quem vai executar e acompanhar." },
  { title: "Valores e checklist", description: "Informe o valor combinado, sua visibilidade e o roteiro de execução." },
  { title: "Revisão", description: "Confira as informações antes de criar a operação." },
] as const;

export interface OperationWizardFields {
  businessUnitId: string;
  title: string;
  code: string;
  kind: string;
  startLocal: string;
  endLocal: string;
  manualAmount: string;
}

export interface OperationFormState extends OperationWizardFields {
  description: string;
  priority: string;
  customerId: string;
  assetIds: string[];
  customerAddressId: string;
  sector: string;
  amountVisibleInField: boolean;
  responsibleId: string;
  auxiliaryIds: string[];
  checklistExtras: ChecklistItem[];
}

export const MAX_OPERATION_AMOUNT = 999999999999.99;

/** Blank is absent, zero is explicit; accept Brazilian and decimal notation. */
export function parseOperationAmount(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(value) ? value.replace(/\./g, "") : value;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export function operationInstant(local: string, timeZone: string): string | undefined {
  if (!local) return undefined;
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return instantFromZoned({ year, month, day, hour, minute, second: 0 }, timeZone).toISOString();
}

/** Input checks only; assignment eligibility and business rules stay in the API. */
export function operationStepIssues(step: number, form: OperationWizardFields, timeZone: string): string[] {
  if (step === 4) return [1, 2, 3].flatMap((index) => operationStepIssues(index, form, timeZone));
  const issues: string[] = [];
  if (step === 1) {
    if (form.title.trim().length < OPERATION_LIMITS.titleMinLength) issues.push("Informe um título com ao menos dois caracteres.");
    if (form.code.trim().length < OPERATION_LIMITS.codeMinLength) issues.push("Informe um código com ao menos dois caracteres.");
    if (!form.kind) issues.push("Escolha o tipo de atendimento.");
  }
  if (step === 2) {
    if (!form.businessUnitId) issues.push("Selecione a unidade responsável pelo atendimento.");
    if (form.endLocal && !form.startLocal) issues.push("Informe o início previsto antes do término.");
    if (form.startLocal) {
      try {
        const start = operationInstant(form.startLocal, timeZone);
        const end = operationInstant(form.endLocal, timeZone);
        if (!start || !Number.isFinite(Date.parse(start)) || (end && !Number.isFinite(Date.parse(end)))) issues.push("Confira as datas informadas.");
        else if (end && end <= start) issues.push("O término previsto deve ser posterior ao início.");
      } catch { issues.push("Confira as datas informadas."); }
    }
  }
  if (step === 3) {
    const amount = parseOperationAmount(form.manualAmount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_OPERATION_AMOUNT)) issues.push("Informe um valor válido, a partir de zero, com até duas casas decimais.");
  }
  return issues;
}
