/**
 * PMOC — Relatório de Execução.
 *
 * O documento que sai depois de a manutenção ter sido feita: o que foi
 * conferido em cada equipamento, quem conferiu, com que evidência, e o aceite.
 * É a peça que o cliente guarda para provar conformidade com a Lei 13.589/2018.
 *
 * ## Por que não é a lista de campos do template
 *
 * O Orbit imprimia as seções do template como pares rótulo/valor. Funciona
 * para qualquer formulário e não serve para nenhum: o PMOC tem partes que o
 * formulário não descreve — o timbre de quem emite, a tabela dos equipamentos
 * atendidos, a separação entre evaporadora e condensadora no roteiro.
 *
 * Este compositor conhece o PMOC. As respostas do template continuam saindo,
 * mas **dentro** de uma estrutura que é do documento, não do formulário.
 *
 * ## O roteiro vira tabela de três colunas
 *
 * `PROCEDIMENTO · EXECUTADO · OBSERVAÇÃO` é a forma que o setor reconhece, e
 * é auditável: quem fiscaliza procura a coluna do meio. Uma lista de "Sim"
 * soltos ao lado de rótulos é a mesma informação e não passa em auditoria.
 */
import {
  definitionCard,
  groupLabel,
  noteBlock,
  sectionTitle,
  table,
  type DefinitionItem,
  type TableColumn,
} from '../kit/blocks';
import { photoGrid, signatureBlock } from '../kit/media-blocks';
import type { DocumentContext } from '../kit/document-context';
import type { DocumentTheme } from '../kit/theme';
import type { RenderInput, RenderSectionInput } from '../../artifact-renderer';
import { formatAnswer } from '../../html/html-safe';
import { roleLabel } from './labels';

type Doc = PDFKit.PDFDocument;

const COLUNAS_DO_EQUIPAMENTO: readonly TableColumn[] = [
  { header: 'Item', weight: 0.7, align: 'center' },
  { header: 'Setor', weight: 2 },
  { header: 'Equipamento', weight: 2.6 },
  { header: 'Marca', weight: 1.6 },
  { header: 'Modelo', weight: 1.8 },
  { header: 'Capacidade', weight: 1.4, align: 'right' },
];

const COLUNAS_DO_ROTEIRO: readonly TableColumn[] = [
  { header: 'Procedimento', weight: 5.4 },
  { header: 'Executado', weight: 1.4, align: 'center' },
  { header: 'Observação', weight: 3.2 },
];

/**
 * Uma seção do template é roteiro?
 *
 * Reconhecida pelo **tipo declarado** no template e, como rede, por só conter
 * campos de sim/não. Adivinhar pelo título ("Atividades", "Checklist") daria
 * certo nos nossos templates e erraria no primeiro que a organização criar com
 * outro nome.
 */
function ehRoteiro(secao: RenderSectionInput): boolean {
  if (secao.type === 'CHECKLIST') return true;
  return (
    secao.fields.length > 0 &&
    secao.fields.every((campo) => campo.type === 'BOOLEAN')
  );
}

export function composePmocExecution(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  identificacao(document, input, context, theme);
  dadosOperacionais(document, context, theme);
  equipamentos(document, context, theme);
  roteiro(document, input, theme);
  respostasLivres(document, input, theme);
  observacoes(document, input, theme);
  evidencias(document, input, theme);
  assinaturas(document, input, theme);
  referenciaLegal(document, context, theme);
}

function identificacao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const cliente = context.customer;
  const plano = context.plan;

  const itens: DefinitionItem[] = [
    { label: 'Título', value: input.execution.title },
    { label: 'Número', value: input.execution.code },
    { label: 'Cliente', value: cliente?.name },
    { label: 'Documento do cliente', value: cliente?.document },
    { label: 'Plano', value: plano?.code },
    /*
     * Qual manutenção do equipamento é esta.
     *
     * Fica na identificação, ao lado do plano: é a pergunta que quem recebe o
     * relatório faz primeiro — "esta máquina está em dia?" — e a resposta é a
     * posição dela na vigência, não o número do ciclo, que é igual para todos os
     * aparelhos atendidos no mesmo período.
     */
    { label: 'Manutenção', value: manutencao(context) },
    {
      label: 'Responsável técnico',
      value: context.operation?.technicalResponsible,
    },
    { label: 'Endereço do atendimento', value: cliente?.address, full: true },
  ];

  sectionTitle(document, 'Identificação', theme);
  definitionCard(document, itens, theme);
}

/**
 * "3 de 12", ou apenas "3".
 *
 * Sem total — plano de vigência aberta — imprime só a posição. "3 de 120" por
 * causa do teto interno do gerador de cronograma afirmaria um contrato com dez
 * anos que ninguém assinou.
 */
function manutencao(context: DocumentContext): string | undefined {
  const dados = context.maintenance;
  if (!dados?.sequence) return undefined;
  return dados.total
    ? `${dados.sequence} de ${dados.total}`
    : String(dados.sequence);
}

function dadosOperacionais(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const operacao = context.operation;
  const plano = context.plan;
  if (!operacao && !plano) return;

  const itens: DefinitionItem[] = [
    { label: 'Atendimento', value: operacao?.code },
    { label: 'Execução prevista', value: operacao?.scheduledFor },
    { label: 'Início', value: operacao?.startedAt },
    { label: 'Conclusão', value: operacao?.completedAt },
    { label: 'Técnico em campo', value: operacao?.fieldTechnician },
    { label: 'Contato do cliente', value: context.customer?.contactPhone },
    {
      label: 'Vigência do plano',
      value:
        plano?.coverageStart && plano?.coverageEnd
          ? `${plano.coverageStart} a ${plano.coverageEnd}`
          : plano?.coverageStart,
    },
    { label: 'Periodicidade', value: plano?.cadence },
    {
      label: 'Tipos de serviço',
      value: plano?.serviceTypes?.length
        ? plano.serviceTypes.join(', ')
        : undefined,
      full: true,
    },
  ];

  sectionTitle(document, 'Dados operacionais', theme);
  definitionCard(document, itens, theme);
}

function equipamentos(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const lista = context.equipment ?? [];
  if (lista.length === 0) return;

  sectionTitle(document, 'Equipamentos', theme);
  table(
    document,
    COLUNAS_DO_EQUIPAMENTO,
    lista.map((item, indice) => [
      String(indice + 1).padStart(2, '0'),
      item.sector,
      item.name,
      item.manufacturer,
      item.model,
      item.capacity,
    ]),
    theme,
    { continuationLabel: '(continuação)' },
  );
}

function roteiro(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const secoes = [...input.sections]
    .sort((esquerda, direita) => esquerda.order - direita.order)
    .filter(ehRoteiro);
  if (secoes.length === 0) return;

  sectionTitle(document, 'Checklist do procedimento', theme);

  for (const secao of secoes) {
    /* O título do grupo só aparece quando há mais de um: com um roteiro só,
       repetir o nome da seção logo abaixo do título da seção é ruído. */
    if (secoes.length > 1) groupLabel(document, secao.title, theme);

    table(
      document,
      COLUNAS_DO_ROTEIRO,
      [...secao.fields]
        .sort((esquerda, direita) => esquerda.order - direita.order)
        .map((campo) => [
          campo.label,
          formatAnswer(campo.value),
          campo.notes ?? '—',
        ]),
      theme,
      { continuationLabel: '(continuação)' },
    );
  }
}

/**
 * O que o template pediu e não é roteiro.
 *
 * Medições, textos livres, seleções. Continuam saindo — o template é de quem
 * configurou, e omitir um campo porque este compositor não o previu faria o
 * documento mentir por omissão.
 */
function respostasLivres(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const secoes = [...input.sections]
    .sort((esquerda, direita) => esquerda.order - direita.order)
    .filter((secao) => !ehRoteiro(secao) && secao.fields.length > 0);

  for (const secao of secoes) {
    const itens: DefinitionItem[] = secao.fields
      .filter((campo) => !campo.hidden)
      .sort((esquerda, direita) => esquerda.order - direita.order)
      .map((campo) => {
        /* A largura é decidida pelo texto que vai ser impresso, e não pelo
           valor cru — um objeto respondido vira JSON longo, e medir o objeto
           daria "[object Object]". */
        const texto = formatAnswer(campo.value);
        return {
          label: campo.unit ? `${campo.label} (${campo.unit})` : campo.label,
          value: texto,
          full: texto.length > 60,
        };
      });
    if (itens.length === 0) continue;

    sectionTitle(document, secao.title, theme);
    if (secao.description) {
      document.y -= 4;
      noteBlock(document, secao.description, theme);
    }
    definitionCard(document, itens, theme);
  }
}

function observacoes(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = input.metadata.executionNotes;
  if (typeof texto !== 'string' || !texto.trim()) return;
  sectionTitle(document, 'Observações e conclusão', theme);
  noteBlock(document, texto.trim(), theme);
}

function evidencias(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const fotos = input.evidence ?? [];
  if (fotos.length === 0) return;
  sectionTitle(document, 'Evidências fotográficas', theme, {
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

function referenciaLegal(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  if (!context.legalReference) return;
  noteBlock(document, context.legalReference, theme, {
    title: 'Referência do plano',
  });
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
