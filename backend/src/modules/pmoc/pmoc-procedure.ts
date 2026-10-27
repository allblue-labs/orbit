/** A mesma declaração alimenta a preparação, o snapshot e o relatório. */
export function pmocProcedure(
  procedure: unknown,
  units: readonly {
    unit: { name: string; checklistTemplate: { items: unknown } | null };
  }[] = [],
): Record<string, string[]> {
  const groups: Record<string, string[]> = Object.create(null) as Record<
    string,
    string[]
  >;
  if (procedure && typeof procedure === 'object' && !Array.isArray(procedure)) {
    for (const [name, value] of Object.entries(procedure))
      add(name, labels(value));
  }
  for (const { unit } of units)
    add(unit.name, labels(unit.checklistTemplate?.items));
  return groups;

  function add(name: string, items: string[]) {
    if (items.length)
      groups[name] = [...new Set([...(groups[name] ?? []), ...items])];
  }
}

function labels(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item: unknown) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        const label = row.label ?? row.name ?? row.title ?? row.text;
        return typeof label === 'string' ? label.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
}

/** Execuções anteriores sem snapshot aproveitam o roteiro configurado do plano. */
export function executionPmocProcedure(
  snapshot: unknown,
  procedure: unknown,
  units: Parameters<typeof pmocProcedure>[1] = [],
) {
  const existing = pmocProcedure(snapshot);
  return Object.keys(existing).length
    ? existing
    : pmocProcedure(procedure, units);
}

/** Chaves estáveis dentro do snapshot congelado da execução. */
export function pmocProcedureItems(procedure: unknown) {
  return Object.entries(pmocProcedure(procedure)).flatMap(([group, items], g) =>
    items.map((label, i) => ({ key: `${g}:${i}`, group, label })),
  );
}

export function pmocProcedureAnswers(
  metadata: unknown,
): Record<string, boolean> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return {};
  const answers = (metadata as Record<string, unknown>).pmocChecklistAnswers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    return {};
  return Object.fromEntries(
    Object.entries(answers).filter(([, value]) => typeof value === 'boolean'),
  ) as Record<string, boolean>;
}
