import type { RenderInput, RenderSectionInput } from './artifact-renderer';
import { pmocProcedure } from '../../pmoc/pmoc-procedure';
import {
  documentLabel,
  documentValue,
  isInternalDocumentKey,
} from '../../../common/document-value';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const name = (value: unknown) => {
  const row = record(value);
  return row.displayName ?? row.name ?? value;
};
function civilDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
}
function performedAt(value: unknown, timezone: string): unknown {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value))
    return value;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  };
  try {
    return new Intl.DateTimeFormat('pt-BR', options).format(instant);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      ...options,
      timeZone: 'America/Recife',
    }).format(instant);
  }
}

/** Presentation only: snapshots, answers, signatures and acceptance hashes stay intact. */
export function documentContent(input: RenderInput): RenderInput {
  if (input.snapshot.artifactType !== 'PMOC') return input;
  const generated = input.sections.find(
    (section) => section.id === 'pmoc_context',
  );
  if (!generated) return input;
  const context = {
    ...input.metadata,
    ...Object.fromEntries(
      generated.fields
        .filter((field) => !field.hidden && field.value !== undefined)
        .map((field) => [field.id, field.value]),
    ),
  };
  const timezone =
    typeof input.metadata.timezone === 'string'
      ? input.metadata.timezone
      : 'America/Recife';
  const technical = record(context.technicalResponsible);
  const omit = new Set([
    'procedure',
    'procedureAnswers',
    'evidence',
    'reviewRequired',
  ]);
  const fields = generated.fields
    .filter(
      (field) =>
        !field.hidden &&
        !isInternalDocumentKey(field.id) &&
        !omit.has(field.id),
    )
    .map((field) => {
      let value = field.value === undefined ? context[field.id] : field.value;
      switch (field.id) {
        case 'plan': {
          if (!value || typeof value !== 'object') break;
          const row = record(value);
          value = [row.code, row.name].filter(Boolean).join(' — ');
          break;
        }
        case 'cycle': {
          if (!value || typeof value !== 'object') break;
          const row = record(value);
          value = {
            sequenceNumber: row.sequenceNumber,
            dueOn: civilDate(row.dueOn),
          };
          break;
        }
        case 'maintenance': {
          if (!value || typeof value !== 'object') break;
          const row = record(value);
          const sequence =
            typeof row.sequence === 'number' &&
            Number.isFinite(row.sequence) &&
            row.sequence > 0
              ? row.sequence
              : undefined;
          const total =
            typeof row.total === 'number' &&
            Number.isFinite(row.total) &&
            row.total > 0
              ? row.total
              : undefined;
          value = sequence ? `${sequence}${total ? ` de ${total}` : ''}` : null;
          break;
        }
        case 'performedAt':
          value = performedAt(value, timezone);
          break;
        case 'customer':
        case 'fieldTechnician':
          value = name(value);
          break;
        case 'auxiliaries':
          value = Array.isArray(value) ? value.map(name) : value;
          break;
        case 'technicalResponsible':
          if (!value || typeof value !== 'object') break;
          value = [
            technical.displayName,
            technical.name,
            documentValue(technical.credential),
          ]
            .filter((item) => item && item !== '—')
            .join(' · ');
          break;
      }
      return { ...field, label: documentLabel(field.id), value };
    });
  const sections: RenderSectionInput[] = input.sections.map((section) =>
    section === generated ? { ...section, fields } : section,
  );
  // Old generated snapshots store the unit checklist in metadata, rather than
  // form fields. Publish the same recorded answers to every rendering format.
  if (!sections.some((section) => section.type === 'CHECKLIST')) {
    const answers = record(context.procedureAnswers);
    for (const [groupIndex, [group, items]] of Object.entries(
      pmocProcedure(context.procedure),
    ).entries()) {
      sections.push({
        id: `pmoc_procedure_${groupIndex}`,
        title: group,
        order: generated.order + (groupIndex + 1) / 100,
        type: 'CHECKLIST',
        fields: items.map((label, index) => ({
          id: `${groupIndex}:${index}`,
          label,
          type: 'TEXT',
          order: index + 1,
          required: false,
          hidden: false,
          value:
            answers[`${groupIndex}:${index}`] === true
              ? 'Realizado'
              : answers[`${groupIndex}:${index}`] === false
                ? 'Não realizado'
                : 'Não informado',
        })),
      });
    }
  }
  return { ...input, sections };
}
