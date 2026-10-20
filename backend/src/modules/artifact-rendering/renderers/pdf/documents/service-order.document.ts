/**
 * OS — Ordem de Serviço.
 *
 * É o documento mais emitido do Orbit, e o que mais é contestado: ele registra
 * o que foi pedido, o que foi feito e o que ficou faltando, e é a peça que o
 * cliente saca quando discorda da cobrança ou pede garantia.
 *
 * ## O que o modelo do setor não responde
 *
 * A OS tradicional imprime datas soltas — criação, agendamento, conclusão — e
 * um nome de técnico. Quando o cliente contesta, a pergunta não é *quando*, é
 * **quem**: quem iniciou, quem concluiu, quem mais esteve na equipe. O Orbit
 * tem esse dado e ele sai aqui, numa linha do tempo, em vez de ficar só na
 * trilha de auditoria que o cliente nunca vê.
 *
 * ## Pendência é o que gera o retorno
 *
 * Sai em bloco próprio e por último, antes das assinaturas: é o item que o
 * cliente precisa ver antes de assinar, e é o que agenda o próximo
 * atendimento. Diluída no meio dos procedimentos, ela é assinada sem ser lida.
 *
 * ## Materiais são texto, e continuam texto
 *
 * O template oficial registra materiais aplicados como texto livre, e o
 * domínio de operações não tem peça nem valor estruturado. Imprimir uma tabela
 * de itens com quantidade e preço exigiria inventar dado que ninguém digitou —
 * e numa folha que vira cobrança, isso é pior que a falta dela.
 */
import {
  checkList,
  definitionCard,
  groupLabel,
  noteBlock,
  sectionTitle,
  table,
  type CheckItem,
  type DefinitionItem,
  type TableColumn,
} from '../kit/blocks';
import { photoGrid, signatureBlock } from '../kit/media-blocks';
import type { DocumentContext } from '../kit/document-context';
import type { DocumentTheme } from '../kit/theme';
import type {
  RenderFieldInput,
  RenderInput,
  RenderSectionInput,
} from '../../artifact-renderer';
import { answerText } from './answer-text';
import { checkState } from './check-state';
import { roleLabel } from './labels';

type Doc = PDFKit.PDFDocument;

const COLUNAS_DO_EQUIPAMENTO: readonly TableColumn[] = [
  { header: 'Item', weight: 0.7, align: 'center' },
  { header: 'Setor', weight: 1.8 },
  { header: 'Equipamento', weight: 2.2 },
  { header: 'Marca', weight: 1.4 },
  { header: 'Modelo', weight: 1.6 },
  { header: 'Identificação', weight: 1.8, mono: true },
  { header: 'Capacidade', weight: 1.8, align: 'right' },
];

const COLUNAS_DA_LINHA_DO_TEMPO: readonly TableColumn[] = [
  { header: 'Etapa', weight: 2 },
  { header: 'Quando', weight: 2.4 },
  { header: 'Por quem', weight: 3 },
];

/** Campos que saem em lugar próprio e não devem repetir no resíduo. */
const CAMPOS_PROPRIOS = new Set([
  'tipo_servico',
  'descricao',
  'inicio',
  'termino',
  'procedimentos',
  'materiais',
  'pendencias',
  'fotos',
  'cliente',
  'documento',
  'endereco',
  'contato',
  'data',
]);

export function composeServiceOrder(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  identificacao(document, input, context, theme);
  cliente(document, context, theme);
  equipe(document, context, theme);
  solicitacao(document, input, context, theme);
  equipamentos(document, context, theme);
  execucao(document, input, theme);
  checklist(document, input, theme);
  linhaDoTempo(document, context, theme);
  respostasLivres(document, input, theme);
  evidencias(document, input, theme);
  pendencias(document, input, theme);
  assinaturas(document, input, theme);
}

function identificacao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const operacao = context.operation;

  const itens: DefinitionItem[] = [
    { label: 'Número', value: input.execution.code },
    { label: 'Situação', value: situacao(input.execution.status) },
    {
      label: 'Tipo de serviço',
      value: valorDoCampo(input, 'tipo_servico') ?? natureza(operacao?.kind),
    },
    { label: 'Prioridade', value: prioridade(operacao?.priority) },
    { label: 'Agendamento', value: operacao?.scheduledFor },
    { label: 'Duração do atendimento', value: operacao?.duration },
    { label: 'Setor', value: operacao?.sector },
    { label: 'Assunto', value: operacao?.title ?? input.execution.title },
  ];

  sectionTitle(document, 'Identificação da ordem de serviço', theme);
  definitionCard(document, itens, theme);
}

function cliente(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const dados = context.customer;
  if (!dados) return;

  const itens: DefinitionItem[] = [
    { label: 'Cliente', value: dados.name },
    { label: 'Razão social', value: dados.legalName },
    { label: 'Documento', value: dados.document },
    { label: 'Contato', value: dados.contactPhone ?? dados.contactName },
    { label: 'Endereço do atendimento', value: dados.address, full: true },
  ];

  sectionTitle(document, 'Cliente', theme);
  definitionCard(document, itens, theme);
}

/**
 * Quem esteve no atendimento.
 *
 * O modelo do setor imprime um nome só, repetido em dois rótulos. Uma equipe
 * de três pessoas aparecendo como uma é exatamente o que gera discussão sobre
 * hora de mão de obra.
 */
function equipe(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const operacao = context.operation;
  if (!operacao) return;

  const auxiliares = operacao.auxiliaryTechnicians ?? [];
  const itens: DefinitionItem[] = [
    { label: 'Técnico responsável', value: operacao.fieldTechnician },
    { label: 'Responsável técnico', value: operacao.technicalResponsible },
    {
      label: auxiliares.length === 1 ? 'Auxiliar' : 'Auxiliares',
      value: auxiliares.length > 0 ? auxiliares.join(', ') : undefined,
      full: auxiliares.join(', ').length > 60,
    },
  ];
  if (!itens.some((item) => item.value)) return;

  sectionTitle(document, 'Equipe', theme);
  definitionCard(document, itens, theme);
}

/** O que o cliente pediu — o defeito relatado, como foi registrado. */
function solicitacao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const texto =
    valorDoCampo(input, 'descricao') ?? context.operation?.description;
  if (!texto) return;

  sectionTitle(document, 'Solicitação do cliente', theme);
  noteBlock(document, texto, theme);
}

function equipamentos(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const lista = context.equipment ?? [];
  if (lista.length === 0) return;

  sectionTitle(document, 'Equipamentos atendidos', theme);
  table(
    document,
    COLUNAS_DO_EQUIPAMENTO,
    lista.map((item, indice) => [
      String(indice + 1).padStart(2, '0'),
      item.sector,
      item.name,
      item.manufacturer,
      item.model,
      item.identifier,
      item.capacity,
    ]),
    theme,
    { continuationLabel: '(continuação)' },
  );
}

/** Procedimentos e materiais — o que de fato foi feito. */
function execucao(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const procedimentos = valorDoCampo(input, 'procedimentos');
  const materiais = valorDoCampo(input, 'materiais');
  if (!procedimentos && !materiais) return;

  sectionTitle(document, 'Execução', theme);
  if (procedimentos) {
    noteBlock(document, procedimentos, theme, {
      title: 'Procedimentos realizados',
    });
  }
  if (materiais) {
    noteBlock(document, materiais, theme, { title: 'Materiais aplicados' });
  }
}

function checklist(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const secoes = secoesDeVerificacao(input);
  if (secoes.length === 0) return;

  sectionTitle(document, 'Checklist da execução', theme, {
    espacoMinimo: 120,
  });

  for (const secao of secoes) {
    if (secoes.length > 1) groupLabel(document, secao.title, theme);

    const itens: CheckItem[] = [...secao.fields]
      .sort((esquerda, direita) => esquerda.order - direita.order)
      .map((campo) => ({
        label: campo.label,
        checked: checkState(campo.value),
        note: campo.notes,
      }));

    checkList(document, itens, theme);
  }
}

/**
 * Quando cada etapa aconteceu, e por quem.
 *
 * Tabela e não cartão: as etapas têm ordem, e ordem se lê melhor em linhas
 * empilhadas do que em pares espalhados por duas colunas.
 *
 * Etapa sem data não aparece. Uma linha "Autorizada — —" ocupa espaço para
 * dizer que nada aconteceu, e quem lê tenta entender o que ela significa.
 */
function linhaDoTempo(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const operacao = context.operation;
  if (!operacao) return;

  const etapas: [string, string | undefined, string | undefined][] = [
    ['Aberta', operacao.openedAt, undefined],
    ['Agendada', operacao.scheduledFor, undefined],
    ['Autorizada', operacao.authorizedAt, undefined],
    ['Iniciada', operacao.startedAt, operacao.startedBy],
    ['Concluída', operacao.completedAt, operacao.completedBy],
  ];
  const linhas = etapas.filter(([, quando]) => quando);
  if (linhas.length === 0) return;

  /**
   * A coluna do autor só existe quando alguma etapa tem autor.
   *
   * Abertura, agendamento e autorização não trazem quem — é o limite do
   * `select` documentado no repositório. Nas etapas em que ninguém é
   * conhecido o kit imprime o traço de célula vazia, que é a convenção do
   * documento inteiro; o que não se admite é a coluna **toda** de traços,
   * ocupando um terço da largura para não dizer nada.
   */
  const temAutor = linhas.some(([, , quem]) => quem);
  const colunas = temAutor
    ? COLUNAS_DA_LINHA_DO_TEMPO
    : COLUNAS_DA_LINHA_DO_TEMPO.slice(0, 2);

  sectionTitle(document, 'Andamento do atendimento', theme);
  table(
    document,
    colunas,
    linhas.map(([etapa, quando, quem]) =>
      temAutor ? [etapa, quando, quem] : [etapa, quando],
    ),
    theme,
  );
}

function respostasLivres(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const verificacao = new Set(secoesDeVerificacao(input).map((s) => s.id));

  const itens: DefinitionItem[] = [...input.sections]
    .sort((esquerda, direita) => esquerda.order - direita.order)
    .filter((secao) => !verificacao.has(secao.id))
    .flatMap((secao) =>
      [...secao.fields]
        .filter((campo) => !campo.hidden && !CAMPOS_PROPRIOS.has(campo.id))
        .sort((esquerda, direita) => esquerda.order - direita.order)
        .map((campo) => {
          const texto = answerText(campo);
          return {
            label: campo.unit ? `${campo.label} (${campo.unit})` : campo.label,
            value: texto,
            full: texto.length > 60,
          };
        }),
    )
    .filter((item) => item.value);

  if (itens.length === 0) return;

  sectionTitle(document, 'Outras informações registradas', theme);
  definitionCard(document, itens, theme);
}

function evidencias(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const fotos = input.evidence ?? [];
  if (fotos.length === 0) return;
  sectionTitle(document, 'Registro fotográfico', theme, { espacoMinimo: 200 });
  photoGrid(
    document,
    fotos.map((item) => ({
      caption: item.caption,
      bytes: item.bytes,
      mimeType: item.mimeType,
      fileName: item.fileName,
    })),
    theme,
  );
}

/**
 * O que ficou faltando.
 *
 * Imediatamente antes das assinaturas de propósito: é o último texto que quem
 * assina lê, e é o que justifica o próximo atendimento. Observações gerais da
 * execução entram no mesmo bloco quando existem, porque o leitor procura as
 * duas coisas no mesmo lugar — o que sobrou para fazer.
 */
function pendencias(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = valorDoCampo(input, 'pendencias');
  const observacoes = input.metadata.executionNotes;
  const notas = typeof observacoes === 'string' ? observacoes.trim() : '';
  if (!texto && !notas) return;

  sectionTitle(document, 'Pendências e observações', theme);
  if (texto) {
    noteBlock(document, texto, theme, { title: 'Pendências' });
  }
  if (notas) {
    noteBlock(document, notas, theme, { title: 'Observações da execução' });
  }
}

function assinaturas(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  if (input.signatures.length === 0) return;
  sectionTitle(document, 'Aceite', theme, { espacoMinimo: 130 });
  signatureBlock(
    document,
    [...input.signatures]
      .sort((esquerda, direita) => esquerda.order - direita.order)
      .map((assinatura) => ({
        label: assinatura.label,
        signerName: assinatura.signerName,
        roleLabel: roleLabel(assinatura.signerRole),
        credential: assinatura.professionalCredential,
        signedAtLabel: assinatura.signedAt
          ? formatDateTime(assinatura.signedAt)
          : undefined,
        image: assinatura.signatureImage,
        imageMimeType: assinatura.signatureImageMimeType,
      })),
    theme,
  );
}

/* ------------------------------------------------------------------ */
/* Leitura das respostas                                               */
/* ------------------------------------------------------------------ */

function secoesDeVerificacao(
  input: RenderInput,
): readonly RenderSectionInput[] {
  return [...input.sections]
    .sort((esquerda, direita) => esquerda.order - direita.order)
    .filter(
      (secao) =>
        secao.type === 'CHECKLIST' ||
        (secao.fields.length > 0 &&
          secao.fields.every((campo) => campo.type === 'BOOLEAN')),
    );
}

function campo(input: RenderInput, id: string): RenderFieldInput | undefined {
  for (const secao of input.sections) {
    const achado = secao.fields.find((item) => item.id === id);
    if (achado) return achado;
  }
  return undefined;
}

function valorDoCampo(input: RenderInput, id: string): string | undefined {
  const encontrado = campo(input, id);
  if (!encontrado || encontrado.hidden) return undefined;
  const texto = answerText(encontrado);
  return texto.length > 0 ? texto : undefined;
}

/** Natureza do atendimento em português; o código do enum não é do cliente. */
function natureza(kind?: string): string | undefined {
  if (!kind) return undefined;
  const rotulos: Readonly<Record<string, string>> = {
    CORRECTIVE: 'Corretiva',
    PREVENTIVE: 'Preventiva',
    INSTALLATION: 'Instalação',
    INSPECTION: 'Inspeção',
    EMERGENCY: 'Emergencial',
  };
  return rotulos[kind] ?? kind;
}

function prioridade(priority?: string): string | undefined {
  if (!priority) return undefined;
  const rotulos: Readonly<Record<string, string>> = {
    LOW: 'Baixa',
    NORMAL: 'Normal',
    HIGH: 'Alta',
    URGENT: 'Urgente',
    CRITICAL: 'Crítica',
  };
  return rotulos[priority] ?? priority;
}

function situacao(status: string): string {
  const rotulos: Readonly<Record<string, string>> = {
    DRAFT: 'Rascunho',
    IN_PROGRESS: 'Em andamento',
    COMPLETED: 'Concluída',
    CANCELLED: 'Cancelada',
    PENDING_SIGNATURE: 'Aguardando assinatura',
  };
  return rotulos[status] ?? status;
}

function formatDateTime(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Recife',
  }).format(data);
}
