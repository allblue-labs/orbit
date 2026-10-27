/** Apenas itens de marcação recebem seleção inicial; medições e texto continuam vazios. */
export function checklistDefaults(items: unknown): Record<string, boolean> {
  if (!Array.isArray(items)) return {};
  return Object.fromEntries(
    items.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      return typeof row.key === 'string' && row.type === 'BOOLEAN'
        ? [[row.key, true]]
        : [];
    }),
  );
}
