import {
  pmocProcedureAnswers,
  pmocProcedureItems,
} from '../pmoc/pmoc-procedure';

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
const answer = (value: unknown): string =>
  value === true
    ? 'Realizado'
    : value === false
      ? 'Não realizado'
      : value == null
        ? 'Não informado'
        : Array.isArray(value)
          ? value.join(', ')
          : String(value);

/** O mesmo texto é exibido, conferido pelo hash e congelado no aceite. */
export function attendanceSummary(source: AttendanceSummarySource): string {
  const lines = [source.description?.trim() || source.title];
  for (const checklist of source.checklistExecutions ?? []) {
    const snapshot = record(checklist.templateSnapshot);
    lines.push(`\nChecklist: ${String(snapshot.name ?? 'Atendimento')}`);
    const answers = record(checklist.answers);
    for (const item of Array.isArray(snapshot.items) ? snapshot.items : []) {
      const row = record(item);
      lines.push(
        `• ${String(row.label ?? row.key)}: ${answer(answers[String(row.key)])}`,
      );
    }
  }
  if (source.pmocEquipmentExecution) {
    const answers = pmocProcedureAnswers(source.data);
    for (const item of pmocProcedureItems(
      source.pmocEquipmentExecution.procedureSnapshot,
    ))
      lines.push(
        `• ${item.group} — ${item.label}: ${answer(answers[item.key])}`,
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
