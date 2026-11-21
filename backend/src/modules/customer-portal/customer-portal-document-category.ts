/**
 * A categoria de um documento, como o cliente pensa nele.
 *
 * O tipo do artefato varia com o modelo da organização (`RECIBO`, `RECEIPT`,
 * `ORDEM_SERVICO`, `RELATORIO_VISITA`…). Para quem recebe, são quatro coisas:
 * o recibo do que pagou, a proposta que recebeu, o PMOC que a fiscalização
 * pede, e o relatório do atendimento — onde cabe todo o resto.
 *
 * Decidido aqui, e não no app: um tipo novo cai em "atendimento" em todo lugar
 * ao mesmo tempo, sem esperar versão nova na loja.
 */
export const PORTAL_DOCUMENT_CATEGORIES = [
  'service',
  'pmoc',
  'quote',
  'receipt',
] as const;
export type PortalDocumentCategory =
  (typeof PORTAL_DOCUMENT_CATEGORIES)[number];

const TYPES: Readonly<
  Record<Exclude<PortalDocumentCategory, 'service'>, readonly string[]>
> = {
  receipt: ['RECIBO', 'RECEIPT'],
  quote: ['ORCAMENTO', 'QUOTE'],
  pmoc: ['PMOC'],
};

const LABELS: Readonly<Record<PortalDocumentCategory, string>> = {
  service: 'Relatório de atendimento',
  pmoc: 'PMOC',
  quote: 'Orçamento',
  receipt: 'Recibo',
};

export function documentCategoryOf(
  artifactType: string,
): PortalDocumentCategory {
  const tipo = artifactType.toUpperCase();
  for (const [categoria, tipos] of Object.entries(TYPES)) {
    if (tipos.includes(tipo)) return categoria as PortalDocumentCategory;
  }
  return 'service';
}

export function documentCategoryLabel(category: PortalDocumentCategory) {
  return LABELS[category];
}

/** Os tipos que pertencem à categoria; `service` é o complemento dos demais. */
export function documentTypesFilter(
  category: PortalDocumentCategory,
): { in: string[] } | { notIn: string[] } {
  if (category === 'service') {
    return { notIn: Object.values(TYPES).flat() };
  }
  return { in: [...TYPES[category]] };
}
