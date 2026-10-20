/**
 * RVT — Relatório de Visita Técnica.
 *
 * ## O que uma visita técnica precisa provar
 *
 * Três coisas, nesta ordem: **por que** alguém foi até lá, **o que** encontrou
 * e **o que precisa ser feito**. O motivo justifica a visita, a constatação é
 * o laudo, e o encaminhamento é o que o cliente vai decidir em cima.
 *
 * Por isso a constatação e a recomendação saem como texto corrido em destaque,
 * e não como mais um par rótulo/valor no meio de uma grade. Um parecer técnico
 * espremido numa célula de formulário deixa de ser lido.
 *
 * ## A próxima visita é informação comercial
 *
 * `Próxima visita sugerida` fecha o documento em destaque próprio. É o campo
 * que transforma um relatório entregue num próximo atendimento agendado, e
 * enterrá-lo entre as respostas do template o desperdiça.
 *
 * ## O que este compositor não faz
 *
 * Não emite parecer, não classifica gravidade e não decide se o equipamento
 * pode operar. Imprime o que o técnico registrou. Um gerador de PDF que
 * concluísse qualquer coisa estaria assinando no lugar de quem assina.
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
import { roleLabel } from './labels';
import { checkState } from './check-state';

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

/**
 * Os campos que este documento imprime em lugar próprio.
 *
 * Ficam fora da varredura genérica do fim para não sair duas vezes. A chave é
 * o `id` do campo no template oficial; um template da organização que use
 * outros ids continua saindo inteiro pela varredura — que é o comportamento
 * certo, porque o template é de quem o configurou.
 */
const CAMPOS_PROPRIOS = new Set([
  'motivo',
  'constatacoes',
  'recomendacoes',
  'proxima_visita',
  'acompanhante',
  'fotos',
  'cliente',
  'documento',
  'endereco',
  'contato',
  'data',
]);

export function composeRvt(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  identificacao(document, input, context, theme);
  cliente(document, context, theme);
  aVisita(document, input, context, theme);
  equipamentos(document, context, theme);
  servicosExecutados(document, input, theme);
  constatacoes(document, input, theme);
  encaminhamentos(document, input, theme);
  respostasLivres(document, input, theme);
  observacoes(document, input, theme);
  evidencias(document, input, theme);
  assinaturas(document, input, theme);
}

function identificacao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const operacao = context.operation;

  /* O atendimento não guarda responsável técnico — quem o nomeia é a
     assinatura, que é onde o nome aparece com o registro profissional junto.
     Ler dali é ler a fonte; repetir um campo que o modelo não tem seria
     imprimir vazio. */
  const responsavel = signatarioPor(input, 'TECHNICAL_RESPONSIBLE');
  const campoTecnico = signatarioPor(input, 'FIELD_TECHNICIAN');

  const itens: DefinitionItem[] = [
    { label: 'Número', value: input.execution.code },
    { label: 'Situação', value: situacao(input.execution.status) },
    /* O título da execução traz o contrato de origem. Sai do cabeçalho, onde
       ocupava duas linhas, e volta aqui, onde é o dado certo. */
    { label: 'Contrato', value: input.execution.title },
    { label: 'Responsável técnico', value: responsavel?.signerName },
    {
      label: 'Registro profissional',
      value: responsavel?.professionalCredential,
    },
    {
      label: 'Técnico em campo',
      value: operacao?.fieldTechnician ?? campoTecnico?.signerName,
    },
    { label: 'Referência operacional', value: operacao?.code },
    { label: 'Realizada em', value: operacao?.completedAt },
  ];

  sectionTitle(document, 'Identificação do relatório', theme);
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
 * Motivo, acompanhante e janela de execução.
 *
 * O motivo sai como texto em quadro, e não como valor de rótulo: é a parte que
 * explica a visita inteira, e costuma ter duas ou três frases.
 */
function aVisita(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const motivo = valorDoCampo(input, 'motivo');
  const acompanhante = valorDoCampo(input, 'acompanhante');
  const operacao = context.operation;

  const itens: DefinitionItem[] = [
    { label: 'Início', value: operacao?.startedAt },
    { label: 'Conclusão', value: operacao?.completedAt },
    { label: 'Acompanhado por', value: acompanhante },
    { label: 'Setor', value: operacao?.sector },
  ];
  const temGrade = itens.some((item) => item.value);
  if (!motivo && !temGrade) return;

  sectionTitle(document, 'A visita', theme);
  if (temGrade) definitionCard(document, itens, theme);
  if (motivo) noteBlock(document, motivo, theme, { title: 'Motivo da visita' });
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

/**
 * O roteiro que a visita percorreu, com caixas marcadas.
 *
 * Só seções de verificação entram aqui — declaradas como `CHECKLIST` ou com
 * todos os campos de sim/não. Adivinhar pelo título ("Serviços", "Rotina")
 * acertaria nos nossos templates e erraria no primeiro que a organização
 * criasse com outro nome.
 */
function servicosExecutados(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const secoes = secoesDeVerificacao(input);
  if (secoes.length === 0) return;

  sectionTitle(document, 'Serviços executados', theme, { espacoMinimo: 120 });

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

function constatacoes(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = valorDoCampo(input, 'constatacoes');
  if (!texto) return;
  sectionTitle(document, 'Constatações', theme);
  noteBlock(document, texto, theme);
}

/**
 * Recomendações e a próxima visita.
 *
 * Saem juntas porque são lidas juntas: a recomendação diz o que fazer, a data
 * diz quando. Separá-las em duas seções faria a data aparecer sem o motivo.
 */
function encaminhamentos(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const recomendacoes = valorDoCampo(input, 'recomendacoes');
  const proxima = valorDoCampo(input, 'proxima_visita');
  if (!recomendacoes && !proxima) return;

  sectionTitle(document, 'Encaminhamentos', theme);
  if (recomendacoes) {
    noteBlock(document, recomendacoes, theme, { title: 'Recomendações' });
  }
  if (proxima) {
    noteBlock(document, proxima, theme, { title: 'Próxima visita sugerida' });
  }
}

/**
 * O que o template pediu e este compositor não colocou em lugar próprio.
 *
 * Continua saindo. O template é de quem o configurou, e omitir um campo porque
 * o desenho do documento não o previu faria a folha mentir por omissão.
 */
function respostasLivres(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const verificacao = new Set(secoesDeVerificacao(input).map((s) => s.id));

  /**
   * Tudo num bloco só, e **não** repetindo o título da seção de origem.
   *
   * "Encaminhamentos" já saiu acima com as recomendações; reabrir uma seção
   * com o mesmo nome logo abaixo, só para mostrar o campo que sobrou, faz o
   * documento parecer ter duas seções iguais e quem lê procura a diferença
   * que não existe. O que sobra é resíduo do template — e é assim que sai.
   */
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

function observacoes(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = input.metadata.executionNotes;
  if (typeof texto !== 'string' || !texto.trim()) return;
  sectionTitle(document, 'Observações', theme);
  noteBlock(document, texto.trim(), theme);
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

function assinaturas(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  if (input.signatures.length === 0) return;
  sectionTitle(document, 'Assinaturas', theme, { espacoMinimo: 130 });
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

/** A assinatura de um papel, quando o documento a prevê. */
function signatarioPor(input: RenderInput, papel: string) {
  return input.signatures.find((assinatura) => assinatura.signerRole === papel);
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

/** Situação em português; o código do enum não é para o cliente ler. */
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

/** Data e hora legíveis; ISO cru num documento impresso é defeito. */
function formatDateTime(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Recife',
  }).format(data);
}
