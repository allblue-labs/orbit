/**
 * O catálogo de relatórios gerenciais.
 *
 * Oito tipos, e só eles. Não há criação de tipo por consulta, por fórmula ou
 * por configuração: um relatório é código que alguém escreveu, revisou e sabe
 * de onde tira cada número. Um construtor de relatório seria um construtor de
 * consulta, e um construtor de consulta num ERP multi-tenant é uma via para ler
 * o que a autorização deveria estar decidindo.
 *
 * ## Cada tipo declara o que exige
 *
 * `capabilities` e `permissions` são a autorização **composta**: o relatório
 * financeiro exige `financial.read` além da capability de relatórios, e o
 * servidor confere as duas antes de compor qualquer coisa. Sem isso,
 * `reports.management.read` viraria um contorno para ler dinheiro, estoque e
 * comercial de uma vez — que é justamente o risco de um motor que agrega tudo.
 *
 * `domains` diz de onde vêm os números, e existe para a interface poder
 * explicar a recusa: "este relatório usa Financeiro, e seu acesso não inclui
 * Financeiro" é uma frase útil; "403" não é.
 */

/** Parâmetros que um tipo aceita. O período é sempre obrigatório. */
export const REPORT_PARAMETERS = [
  'businessUnitId',
  'customerId',
  'operationKind',
  'operationStatus',
] as const;
export type ReportParameterKey = (typeof REPORT_PARAMETERS)[number];

export const REPORT_FORMATS = ['PDF', 'HTML'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * Renderizador de cada formato.
 *
 * São os mesmos do Artifact Rendering Engine. **Não existe segundo gerador de
 * PDF**: o que este módulo acrescenta é o que alimenta o renderizador, não o
 * renderizador.
 *
 * O PDF passou de `pdf.default` para `pdf.premium`. O relatório gerencial saía
 * com o desenho antigo — título, seções, pares rótulo/valor — enquanto todo
 * documento de campo já saía com timbre, faixa da marca, tabela que continua na
 * página seguinte e rodapé numerado. Era o mesmo sistema entregando dois níveis
 * de acabamento, e o pior deles justamente no papel que vai para uma reunião.
 *
 * O premium não conhece `MANAGEMENT_REPORT` e cai na composição genérica — que
 * é o caminho previsto para tipo sem compositor próprio, e já desenha dentro da
 * moldura de marca.
 */
export const RENDERER_BY_FORMAT: Readonly<Record<ReportFormat, string>> = {
  PDF: 'pdf.premium',
  HTML: 'html.default',
};

export interface ReportTypeDefinition {
  readonly type: string;
  readonly name: string;
  readonly description: string;
  /** Domínios de onde os números saem — para a interface explicar a recusa. */
  readonly domains: readonly string[];
  /** Capabilities do plano exigidas **além** da de relatórios gerenciais. */
  readonly capabilities: readonly string[];
  /** Permissões de papel exigidas além da de relatórios gerenciais. */
  readonly permissions: readonly string[];
  readonly parameters: readonly ReportParameterKey[];
  readonly formats: readonly ReportFormat[];
  /**
   * Janela máxima do recorte, em dias.
   *
   * Existe por desempenho e é declarada, não silenciosa: um relatório de cinco
   * anos varre o histórico inteiro de operações e o resultado chega tarde
   * demais para ser útil. Quem precisa de mais gera por ano.
   */
  readonly maxRangeDays: number;
}

const OPERATIONS = {
  capability: 'operations.read',
  permission: 'operations.read',
};
const FINANCIAL = {
  capability: 'financial.read',
  permission: 'financial.read',
};
const QUOTES = { capability: 'quotes.read', permission: 'quotes.read' };
const INVENTORY = {
  capability: 'inventory.read',
  permission: 'inventory.read',
};
const SCHEDULING = {
  capability: 'scheduling.read',
  permission: 'scheduling.read',
};
const PMOC = { capability: 'pmoc.read', permission: 'pmoc.read' };
const EXECUTIONS = {
  capability: 'artifact_executions.read',
  permission: 'artifact_executions.read',
};

export const REPORT_TYPES: readonly ReportTypeDefinition[] = [
  {
    /**
     * Visão executiva.
     *
     * Compõe **apenas** os domínios que o ator pode consultar. Quem não tem
     * Financeiro recebe o relatório sem a seção financeira, com a ausência
     * declarada — recusar o relatório inteiro por causa de uma seção seria
     * transformar acesso parcial em nenhum acesso.
     */
    type: 'EXECUTIVE_OVERVIEW',
    name: 'Visão executiva',
    description:
      'Consolidado gerencial do período: operação, agenda, comercial, financeiro, estoque e documentos — cada bloco vindo do módulo que é dono do número.',
    domains: [
      'OPERATIONS',
      'SCHEDULING',
      'FINANCIAL',
      'COMMERCIAL',
      'INVENTORY',
      'DOCUMENTS',
    ],
    capabilities: [OPERATIONS.capability],
    permissions: [OPERATIONS.permission],
    parameters: ['businessUnitId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    type: 'OPERATIONS_PERFORMANCE',
    name: 'Desempenho operacional',
    description:
      'Volume e situação das ordens de serviço no período: abertas, concluídas, canceladas, por tipo, por situação e por cliente.',
    domains: ['OPERATIONS'],
    capabilities: [OPERATIONS.capability],
    permissions: [OPERATIONS.permission],
    parameters: [
      'businessUnitId',
      'customerId',
      'operationKind',
      'operationStatus',
    ],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    type: 'SCHEDULING_SLA',
    name: 'Agenda e cumprimento',
    description:
      'Compromissos do período e cumprimento de prazo das operações — concluídas dentro e fora do prazo previsto.',
    domains: ['SCHEDULING', 'OPERATIONS'],
    capabilities: [SCHEDULING.capability, OPERATIONS.capability],
    permissions: [SCHEDULING.permission, OPERATIONS.permission],
    parameters: ['businessUnitId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    type: 'FINANCIAL_PERFORMANCE',
    name: 'Desempenho financeiro',
    description:
      'Receita realizada, despesas, saldo realizado e receita prevista — realizado e previsto sempre separados.',
    domains: ['FINANCIAL'],
    capabilities: [FINANCIAL.capability],
    permissions: [FINANCIAL.permission],
    parameters: ['businessUnitId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    type: 'COMMERCIAL_PERFORMANCE',
    name: 'Desempenho comercial',
    description:
      'Propostas enviadas, aprovadas, recusadas, expiradas e canceladas, com taxa de aprovação e valor aprovado do período.',
    domains: ['COMMERCIAL'],
    capabilities: [QUOTES.capability],
    permissions: [QUOTES.permission],
    parameters: ['businessUnitId', 'customerId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    type: 'INVENTORY_CONSUMPTION',
    name: 'Estoque e consumo',
    description:
      'Movimentação física do período e itens em situação crítica. Quantidades — sem valor, custo ou valoração.',
    domains: ['INVENTORY'],
    capabilities: [INVENTORY.capability],
    permissions: [INVENTORY.permission],
    parameters: ['businessUnitId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    /**
     * Desde a PR-26 este relatório lê o **domínio de PMOC**, não só o
     * documento. Por isso passou a exigir `pmoc.read` além do acesso às
     * execuções de artefato: quem não pode ver os planos de manutenção da
     * carteira não passa a vê-los por dentro de um relatório.
     */
    type: 'PMOC_COMPLIANCE',
    name: 'PMOC e conformidade',
    description:
      'Planos de manutenção, conformidade e execuções cumpridas no período — com a evidência documental ao lado.',
    domains: ['PMOC', 'DOCUMENTS'],
    capabilities: [PMOC.capability, EXECUTIONS.capability],
    permissions: [PMOC.permission, EXECUTIONS.permission],
    parameters: ['businessUnitId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
  {
    type: 'DOCUMENTS_EXECUTIONS',
    name: 'Documentos e execuções',
    description:
      'Execuções de artefato do período, por situação e por tipo de documento, e as revisões emitidas.',
    domains: ['DOCUMENTS'],
    capabilities: [EXECUTIONS.capability],
    permissions: [EXECUTIONS.permission],
    parameters: ['businessUnitId'],
    formats: ['PDF', 'HTML'],
    maxRangeDays: 400,
  },
];

export const REPORT_TYPE_KEYS: readonly string[] = REPORT_TYPES.map(
  (definition) => definition.type,
);

export const findReportType = (
  type: string,
): ReportTypeDefinition | undefined =>
  REPORT_TYPES.find((definition) => definition.type === type);

/**
 * Versão do formato do snapshot.
 *
 * Sobe quando a **forma** de `data` muda — seção nova, campo renomeado. Um
 * relatório gravado na versão 1 continua legível como versão 1: quem lê
 * confere antes de interpretar, em vez de assumir que o formato de hoje sempre
 * valeu.
 */
/**
 * 2 — PR-36: o relatório de PMOC ganhou a seção `pmoc.units` (unidades
 * atendidas e o roteiro de cada uma), e `pmoc.cycles` passou a falar em
 * "execução" no lugar de "ciclo". Snapshots gravados na versão 1 continuam
 * como estão: nada os reescreve, e quem os lê vê a versão com que foram
 * compostos.
 */
export const REPORT_SCHEMA_VERSION = 2;
