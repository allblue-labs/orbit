import {
  pmocProcedureAnswers,
  pmocProcedureItems,
} from '../pmoc/pmoc-procedure';
import { ChecklistItemType } from '../operations/checklist.dto';

type Checklist = { templateSnapshot: unknown; answers: unknown };
export interface AttendanceSummarySource {
  title: string;
  description?: string | null;
  data?: unknown;
  checklistExecutions?: Checklist[];
  pmocEquipmentExecution?: {
    procedureSnapshot: unknown;
    notes: string | null;
  } | null;
  materials?: {
    description: string;
    quantity: { toString(): string };
    unit: string;
    notes: string | null;
  }[];
  history?: { details: unknown }[];
  fieldEvidence?: {
    caption: string | null;
    storageFile: { fileName: string };
  }[];
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const NOT_INFORMED = 'Não informado';
const INTERNAL_REFERENCE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,})$/i;

function visibleText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  if (!label || INTERNAL_REFERENCE.test(label)) return undefined;
  return label.replace(/\s+/g, ' ');
}

function answer(value: unknown, depth = 0): string | undefined {
  if (value === true) return 'Realizado';
  if (value === false) return 'Não realizado';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (depth >= 6) return visibleText(value);
  if (Array.isArray(value))
    return value.length
      ? value
          .map((item: unknown) => answer(item, depth + 1) ?? NOT_INFORMED)
          .join(', ')
      : undefined;
  if (value === null || typeof value !== 'object') return visibleText(value);

  const parts = record(value);
  const label = visibleText(parts.label);
  const result = label ?? answer(parts.value ?? parts.checked, depth + 1);
  const unit = visibleText(parts.unit);
  const measurement =
    typeof parts.value === 'number' && result && !label && unit
      ? `${result} ${unit}`
      : result;
  const note = visibleText(parts.note ?? parts.notes ?? parts.observation);
  if (!note) return measurement;
  return measurement
    ? `${measurement} — Observação: ${note}`
    : `Observação: ${note}`;
}

function checklistAnswer(type: unknown, value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    if (type === ChecklistItemType.PHOTO) return 'Foto registrada';
    if (type === ChecklistItemType.SIGNATURE) return 'Assinatura registrada';
  }
  return answer(value) ?? NOT_INFORMED;
}

/** O mesmo texto é exibido, conferido pelo hash e congelado no aceite. */
export function attendanceSummary(source: AttendanceSummarySource): string {
  const lines = [source.description?.trim() || source.title];
  for (const checklist of source.checklistExecutions ?? []) {
    const snapshot = record(checklist.templateSnapshot);
    lines.push(`\nChecklist: ${visibleText(snapshot.name) ?? 'Atendimento'}`);
    const answers = record(checklist.answers);
    for (const item of Array.isArray(snapshot.items) ? snapshot.items : []) {
      const row = record(item);
      const key = typeof row.key === 'string' ? row.key : '';
      const value = Object.hasOwn(answers, key) ? answers[key] : undefined;
      lines.push(
        `• ${visibleText(row.label) ?? 'Item'}: ${checklistAnswer(row.type, value)}`,
      );
    }
  }
  if (source.pmocEquipmentExecution) {
    const answers = pmocProcedureAnswers(source.data);
    for (const item of pmocProcedureItems(
      source.pmocEquipmentExecution.procedureSnapshot,
    ))
      lines.push(
        `• ${item.group} — ${item.label}: ${answer(answers[item.key]) ?? NOT_INFORMED}`,
      );
    if (source.pmocEquipmentExecution.notes?.trim())
      lines.push(
        `\nServiço realizado: ${source.pmocEquipmentExecution.notes.trim()}`,
      );
  }
  for (const item of source.history ?? []) {
    const details = record(item.details);
    // Anotações internas não são expostas ao cliente que recebe o aparelho.
    if (
      details.visibility === 'CUSTOMER_VISIBLE' &&
      typeof details.note === 'string'
    )
      lines.push(`\nServiço realizado: ${details.note}`);
  }
  if (source.materials?.length) {
    lines.push('\nMateriais utilizados:');
    for (const material of source.materials)
      lines.push(
        `• ${material.description}: ${material.quantity.toString()} ${material.unit}${material.notes ? ` — ${material.notes}` : ''}`,
      );
  }
  if (source.fieldEvidence?.length) {
    lines.push(`\nEvidências registradas: ${source.fieldEvidence.length}`);
    for (const item of source.fieldEvidence)
      lines.push(`• ${item.caption || item.storageFile.fileName}`);
  }
  return lines.join('\n');
}
