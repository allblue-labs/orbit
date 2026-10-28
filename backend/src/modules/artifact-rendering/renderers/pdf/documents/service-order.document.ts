/**
 * OS — Ordem de Serviço.
 *
 * É o documento mais emitido do Orbit, e o que mais é contestado: ele registra
 * o que foi pedido, o que foi feito e o que ficou faltando, e é a peça que o
 * cliente saca quando discorda da cobrança ou pede garantia.
 *
 * As datas úteis do atendimento aparecem na identificação. As etapas internas
 * e a trilha de auditoria ficam no sistema, fora do documento entregue ao cliente.
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
import type {
  DocumentContext,
  DocumentEquipment,
} from '../kit/document-context';
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

const COLUNAS_DO_MATERIAL: readonly TableColumn[] = [
  { header: 'Item', weight: 0.7, align: 'center' },
  { header: 'Material', weight: 4.2 },
  { header: 'Qtd.', weight: 1, align: 'right' },
  { header: 'Un.', weight: 0.8, align: 'center' },
  { header: 'Origem', weight: 1.6, align: 'center' },
];

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
  equipamentos(document, input, context, theme);
  execucao(document, input, theme);
  checklist(document, input, theme);
  evidencias(document, input, theme);
  pendencias(document, input, theme);
  const garantia = valorDoCampo(input, 'garantia');
  if (garantia) {
    sectionTitle(document, 'Garantia do serviço', theme);
    noteBlock(document, garantia, theme);
  }
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
    { label: 'Início do atendimento', value: operacao?.startedAt },
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
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const lista = context.equipment?.length
    ? context.equipment
    : equipamentosRegistrados(input);
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

/** Snapshots antigos podem conter o equipamento apenas nas respostas. */
function equipamentosRegistrados(input: RenderInput): DocumentEquipment[] {
  return input.sections
    .flatMap((section) => section.fields)
    .flatMap((field) => {
      if (
        field.hidden ||
        !/^equipamento/i.test(field.label) ||
        !Array.isArray(field.value)
      )
        return [];
      return field.value
        .filter(isRecord)
        .map((item) => ({
          name: textoDe(item.nome) || textoDe(item.name),
          manufacturer: textoDe(item.fabricante) || textoDe(item.manufacturer),
          model: textoDe(item.modelo) || textoDe(item.model),
          sector: textoDe(item.local) || textoDe(item.location),
          identifier: [
            textoDe(item.identificador) || textoDe(item.identifier),
            textoDe(item.serie) || textoDe(item.serialNumber),
          ]
            .filter(Boolean)
            .join(' / '),
          capacity: textoDe(item.capacidade) || textoDe(item.capacity),
        }))
        .filter((item) => item.name);
    });
}

/** Procedimentos e materiais — o que de fato foi feito. */
function execucao(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const procedimentos = valorDoCampo(input, 'procedimentos');
  const materiais = valorDoCampo(input, 'materiais');
  const lista = listaDeMateriais(input);
  if (!procedimentos && !materiais && lista.length === 0) return;

  sectionTitle(document, 'Execução', theme);
  if (procedimentos) {
    noteBlock(document, procedimentos, theme, {
      title: 'Procedimentos realizados',
    });
  }
  if (lista.length > 0) {
    tabelaDeMateriais(document, lista, theme);
  } else if (materiais) {
    /* Texto livre: é como o template oficial registra materiais quando quem
       preencheu a OS digitou em vez de registrar item por item. */
    noteBlock(document, materiais, theme, { title: 'Materiais aplicados' });
  }
}

interface LinhaDeMaterial {
  descricao: string;
  quantidade: string;
  unidade: string;
  origem: string;
}

/**
 * Os materiais registrados item por item.
 *
 * ## Por que não é `valorDoCampo('materiais')`
 *
 * A OS congelada em campo guarda os materiais como **lista**, num campo cujo id
 * é gerado (`materiais_1`) dentro da seção `materiais`. `valorDoCampo` procura
 * um campo de id `materiais`, que só existe no template preenchido à mão — então
 * a lista do aplicativo nunca era encontrada, e os materiais do atendimento não
 * saíam no documento. Pior: por não estarem na lista de campos próprios, caíam
 * em "Outras informações registradas" como um objeto serializado.
 */
function listaDeMateriais(input: RenderInput): LinhaDeMaterial[] {
  const secao = input.sections.find((item) => item.id === 'materiais');
  const bruto = secao?.fields.find((item) => Array.isArray(item.value))?.value;
  if (!Array.isArray(bruto)) return [];

  return bruto
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      descricao: textoDe(item.descricao) || textoDe(item.produto),
      quantidade: textoDe(item.quantidade),
      unidade: textoDe(item.unidade) || 'UN',
      origem: textoDe(item.origem) === 'PLANNED' ? 'Previsto' : 'Aplicado',
    }))
    .filter((item) => item.descricao.length > 0);
}

function tabelaDeMateriais(
  document: Doc,
  lista: readonly LinhaDeMaterial[],
  theme: DocumentTheme,
): void {
  table(
    document,
    COLUNAS_DO_MATERIAL,
    lista.map((item, indice) => [
      String(indice + 1).padStart(2, '0'),
      item.descricao,
      item.quantidade,
      item.unidade,
      item.origem,
    ]),
    theme,
    { continuationLabel: '(continuação)' },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textoDe(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : '';
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

function evidencias(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const fotos = input.evidence ?? [];
  if (fotos.length === 0) return;
  sectionTitle(document, 'Evidências do atendimento', theme, {
    espacoMinimo: 200,
  });
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
  /**
   * O que o cliente pediu em campo.
   *
   * Chega como `customerRequests` porque é outra natureza de texto: o técnico
   * marca a nota como pedido, e o pedido é o que justifica o próximo
   * atendimento. Emendado nas observações, virava um parágrafo onde ninguém
   * achava a pendência.
   */
  const pedidos = input.metadata.customerRequests;
  const solicitacoes = typeof pedidos === 'string' ? pedidos.trim() : '';
  const recomendacoes = [
    ...new Set(
      input.sections
        .flatMap((section) => section.fields)
        .filter(
          (field) =>
            !field.hidden &&
            /^recomenda/i.test(field.label) &&
            typeof field.value === 'string',
        )
        .map((field) => answerText(field))
        .filter(
          (value) =>
            value &&
            value !== texto &&
            value !== notas &&
            value !== solicitacoes,
        ),
    ),
  ].join('\n\n');
  if (!texto && !notas && !solicitacoes && !recomendacoes) return;

  sectionTitle(document, 'Pendências e observações', theme);
  if (texto) {
    noteBlock(document, texto, theme, { title: 'Pendências' });
  }
  if (solicitacoes) {
    noteBlock(document, solicitacoes, theme, {
      title: 'Solicitações do cliente',
    });
  }
  if (notas) {
    noteBlock(document, notas, theme, { title: 'Observações da execução' });
  }
  if (recomendacoes)
    noteBlock(document, recomendacoes, theme, { title: 'Recomendações' });
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
