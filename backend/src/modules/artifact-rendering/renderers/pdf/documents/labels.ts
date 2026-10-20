/**
 * Códigos do banco em palavras de produto.
 *
 * O documento impresso é lido por quem não conhece o sistema — o cliente, o
 * fiscal, o síndico. `TECHNICAL_RESPONSIBLE` no lugar de "Responsável técnico"
 * é o tipo de vazamento que faz um documento parecer rascunho de programador.
 *
 * O que não se reconhece sai como veio: inventar uma tradução seria pior que
 * mostrar o código, porque uma tradução errada não dá para desconfiar.
 */
const PAPEIS: Readonly<Record<string, string>> = {
  TECHNICAL_RESPONSIBLE: 'Responsável técnico',
  FIELD_TECHNICIAN: 'Técnico em campo',
  ASSISTANT_TECHNICIAN: 'Técnico auxiliar',
  CUSTOMER: 'Cliente',
  /* Papéis dos slots do catálogo oficial. `ISSUER` assina o recibo — é quem
     recebeu o dinheiro — e `TECHNICIAN` assina OS e RVT. Sem estes dois, o
     código do banco ia impresso ao lado da assinatura. */
  ISSUER: 'Emitente',
  TECHNICIAN: 'Técnico responsável',
  CUSTOMER_REPRESENTATIVE: 'Representante do cliente',
  OWNER: 'Responsável pela organização',
  MANAGER: 'Gestor',
  WITNESS: 'Testemunha',
};

export function roleLabel(code?: string): string | undefined {
  if (!code) return undefined;
  return PAPEIS[code.toUpperCase()] ?? code;
}

/**
 * O nome do documento no cabeçalho.
 *
 * É o **tipo** do papel, não o da instância. `execution.title` costuma trazer
 * o contrato ou a configuração de origem ("Contrato Synapse — Relatório de
 * Visita Técnica"), que é contexto útil mas não é o que o documento é. No
 * cabeçalho isso ocupa duas linhas e empurra o código; na identificação, onde
 * ele volta a aparecer, é exatamente a informação certa.
 *
 * O fallback é o título da execução: um tipo que este mapa não conhece ainda
 * é melhor impresso com o nome que tem do que com um rótulo genérico.
 */
const TITULOS: Readonly<Record<string, string>> = {
  PMOC: 'PMOC — Relatório de Execução',
  RVT: 'Relatório de Visita Técnica',
  RELATORIO_VISITA: 'Relatório de Visita Técnica',
  ORDEM_SERVICO: 'Ordem de Serviço',
  SERVICE_ORDER: 'Ordem de Serviço',
  RELATORIO_TECNICO: 'Laudo Técnico',
  RECIBO: 'Recibo',
  ORCAMENTO: 'Orçamento',
  QUALIDADE_AR: 'Relatório de Qualidade do Ar',
};

export function documentTitleFor(
  artifactType: string,
  fallback: string,
): string {
  return TITULOS[artifactType] ?? fallback;
}
