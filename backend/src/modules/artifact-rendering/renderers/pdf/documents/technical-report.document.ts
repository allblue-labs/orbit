/**
 * Laudo Técnico.
 *
 * ## O que faz um laudo ser um laudo
 *
 * Três coisas, e nenhuma delas é o layout: um **objeto** delimitado (o que foi
 * examinado, e só isso), uma **metodologia** declarada (como se chegou lá) e
 * uma **conclusão** assinada por quem tem registro profissional para
 * sustentá-la. Sem as três, o papel é um relatório de visita com outro nome.
 *
 * Por isso a conclusão sai em destaque, e por isso a responsabilidade técnica
 * tem seção própria com o registro impresso ao lado do nome: é o registro que
 * dá valor ao documento, e escondê-lo na linha da assinatura o desperdiça.
 *
 * ## As ressalvas não são letra miúda
 *
 * Um laudo honesto diz o que **não** pôde verificar — o que estava inacessível,
 * o que dependia de ensaio não realizado, o que ficou fora do escopo. Quando o
 * template registra isso, sai em bloco próprio e visível. Esconder limitação é
 * o que transforma um laudo em problema depois.
 *
 * ## O que este compositor não faz
 *
 * Não conclui nada. Não classifica gravidade, não decide se algo está
 * conforme e não recomenda por conta própria. Imprime o que o responsável
 * técnico escreveu — quem assina é quem conclui.
 */
import {
  definitionCard,
  noteBlock,
  sectionTitle,
  statementBlock,
  type DefinitionItem,
} from '../kit/blocks';
import { photoGrid, signatureBlock } from '../kit/media-blocks';
import type { DocumentContext } from '../kit/document-context';
import type { DocumentTheme } from '../kit/theme';
import type { RenderFieldInput, RenderInput } from '../../artifact-renderer';
import { answerText } from './answer-text';
import { roleLabel } from './labels';

type Doc = PDFKit.PDFDocument;

const CAMPOS_PROPRIOS = new Set([
  'objeto',
  'metodologia',
  'normas',
  'constatacoes',
  'conclusao',
  'ressalvas',
  'limitacoes',
  'evidencias',
  'cliente',
  'documento',
  'endereco',
  'contato',
  'data',
]);

export function composeTechnicalReport(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  identificacao(document, input, context, theme);
  solicitante(document, context, theme);
  objeto(document, input, theme);
  metodologia(document, input, theme);
  constatacoes(document, input, theme);
  conclusao(document, input, theme);
  ressalvas(document, input, theme);
  respostasLivres(document, input, theme);
  evidencias(document, input, theme);
  responsabilidadeTecnica(document, input, theme);
}

function identificacao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const responsavel = responsavelTecnico(input);

  const itens: DefinitionItem[] = [
    { label: 'Número', value: input.execution.code },
    { label: 'Situação', value: situacao(input.execution.status) },
    { label: 'Emitido em', value: context.operation?.completedAt },
    { label: 'Atendimento relacionado', value: context.operation?.code },
    { label: 'Responsável técnico', value: responsavel?.signerName },
    {
      label: 'Registro profissional',
      value: responsavel?.professionalCredential,
    },
    { label: 'Assunto', value: input.execution.title, full: true },
  ];

  sectionTitle(document, 'Identificação do laudo', theme);
  definitionCard(document, itens, theme);
}

function solicitante(
  document: Doc,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const dados = context.customer;
  if (!dados) return;

  const itens: DefinitionItem[] = [
    { label: 'Solicitante', value: dados.name },
    { label: 'Razão social', value: dados.legalName },
    { label: 'Documento', value: dados.document },
    { label: 'Contato', value: dados.contactPhone ?? dados.contactName },
    { label: 'Local vistoriado', value: dados.address, full: true },
  ];

  sectionTitle(document, 'Solicitante e local', theme);
  definitionCard(document, itens, theme);
}

/** O objeto delimita o laudo: o que está fora dele não foi examinado. */
function objeto(document: Doc, input: RenderInput, theme: DocumentTheme): void {
  const texto = valorDoCampo(input, 'objeto');
  if (!texto) return;
  sectionTitle(document, 'Objeto do laudo', theme);
  noteBlock(document, texto, theme);
}

function metodologia(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const metodo = valorDoCampo(input, 'metodologia');
  const normas = valorDoCampo(input, 'normas');
  if (!metodo && !normas) return;

  sectionTitle(document, 'Metodologia', theme);
  if (metodo) {
    noteBlock(document, metodo, theme, { title: 'Método aplicado' });
  }
  if (normas) {
    noteBlock(document, normas, theme, { title: 'Normas de referência' });
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
 * A conclusão, em destaque.
 *
 * Tudo acima dela existe para sustentá-la, e é ela que quem recebe o laudo
 * procura antes de ler o resto.
 */
function conclusao(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = valorDoCampo(input, 'conclusao');
  if (!texto) return;
  sectionTitle(document, 'Conclusão', theme, { espacoMinimo: 140 });
  statementBlock(document, texto, theme, { title: 'Parecer técnico' });
}

/** O que o laudo não alcançou. Visível, e não em letra miúda. */
function ressalvas(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto =
    valorDoCampo(input, 'ressalvas') ?? valorDoCampo(input, 'limitacoes');
  if (!texto) return;
  sectionTitle(document, 'Ressalvas e limitações', theme);
  noteBlock(document, texto, theme);
}

function respostasLivres(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const itens: DefinitionItem[] = [...input.sections]
    .sort((esquerda, direita) => esquerda.order - direita.order)
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
 * A responsabilidade técnica.
 *
 * Seção própria, e não só uma linha de assinatura no pé: é o registro
 * profissional que dá validade ao laudo, e um número de CREA impresso em corpo
 * 7 ao lado do nome é fácil demais de não ver.
 */
function responsabilidadeTecnica(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  if (input.signatures.length === 0) return;

  sectionTitle(document, 'Responsabilidade técnica', theme, {
    espacoMinimo: 150,
  });

  const responsavel = responsavelTecnico(input);
  if (responsavel?.professionalCredential) {
    definitionCard(
      document,
      [
        { label: 'Responsável técnico', value: responsavel.signerName },
        {
          label: 'Registro profissional',
          value: responsavel.professionalCredential,
        },
      ],
      theme,
    );
  }

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

/** Quem responde pelo laudo — pelo papel declarado na assinatura. */
function responsavelTecnico(input: RenderInput) {
  return (
    input.signatures.find(
      (assinatura) =>
        assinatura.signerRole === 'TECHNICAL_MANAGER' ||
        assinatura.signerRole === 'TECHNICAL_RESPONSIBLE',
    ) ?? input.signatures[0]
  );
}

function campoPorId(
  input: RenderInput,
  id: string,
): RenderFieldInput | undefined {
  for (const secao of input.sections) {
    const achado = secao.fields.find((item) => item.id === id);
    if (achado) return achado;
  }
  return undefined;
}

function valorDoCampo(input: RenderInput, id: string): string | undefined {
  const encontrado = campoPorId(input, id);
  if (!encontrado || encontrado.hidden) return undefined;
  const texto = answerText(encontrado);
  return texto.length > 0 ? texto : undefined;
}

function situacao(status: string): string {
  const rotulos: Readonly<Record<string, string>> = {
    DRAFT: 'Rascunho',
    IN_PROGRESS: 'Em elaboração',
    COMPLETED: 'Emitido',
    CANCELLED: 'Cancelado',
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
