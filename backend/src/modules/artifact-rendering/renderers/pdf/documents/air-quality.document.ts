/**
 * Relatório de Análise da Qualidade do Ar.
 *
 * ## O número sozinho não informa
 *
 * O template mede seis parâmetros. Impressos como pares rótulo/valor — "Fungos
 * 820 UFC/m³" — eles exigem que quem lê conheça a RE nº 9/2003 para saber se
 * aquilo é bom ou ruim. O síndico que recebe o relatório não conhece, e é ele
 * quem decide se contrata a correção.
 *
 * Por isso a tabela traz **medido, referência e situação** lado a lado, e por
 * isso há um resumo antes dela dizendo quantos parâmetros ficaram acima: quem
 * abre o documento precisa saber em cinco segundos se tem problema.
 *
 * ## Comparar não é emitir parecer
 *
 * A distinção que sustenta este documento inteiro: dizer que 820 é maior que
 * 750 é aritmética; dizer que o ambiente está conforme é juízo técnico. A
 * coluna de situação fala de **referencial** ("Acima do VMR"), nunca de
 * conformidade, e o parecer continua sendo o texto que o responsável técnico
 * escreveu. Um gerador de PDF que concluísse conformidade estaria assinando no
 * lugar de quem assina.
 *
 * ## A ressalva sazonal sai impressa
 *
 * Temperatura e umidade têm faixas diferentes para verão e inverno, e o
 * documento não sabe em que estação a medição foi feita. A avaliação usa a
 * envoltória das duas faixas — fora dela está fora em qualquer estação — e a
 * folha diz isso, em vez de deixar a leitura mais forte que o dado sustenta.
 */
import {
  definitionCard,
  noteBlock,
  sectionTitle,
  statementBlock,
  table,
  type DefinitionItem,
  type TableColumn,
} from '../kit/blocks';
import { photoGrid, signatureBlock } from '../kit/media-blocks';
import type { DocumentContext } from '../kit/document-context';
import type { DocumentTheme } from '../kit/theme';
import type { RenderFieldInput, RenderInput } from '../../artifact-renderer';
import { answerText } from './answer-text';
import {
  AIR_QUALITY_LIMITS,
  RE9_SOURCE,
  evaluateLimit,
  verdictLabel,
  type AirQualityLimit,
  type LimitVerdict,
} from './air-quality-limits';
import { roleLabel } from './labels';

type Doc = PDFKit.PDFDocument;

const COLUNAS_DOS_PARAMETROS: readonly TableColumn[] = [
  { header: 'Parâmetro', weight: 3.4 },
  { header: 'Medido', weight: 1.6, align: 'right' },
  { header: 'Unidade', weight: 1.4 },
  { header: 'Referência', weight: 1.8, align: 'right' },
  { header: 'Situação', weight: 2.2 },
];

const CAMPOS_PROPRIOS = new Set([
  'local',
  'area',
  'ocupacao',
  'equipamento_medicao',
  'parecer',
  'recomendacoes',
  'cliente',
  'documento',
  'endereco',
  'contato',
  'data',
  ...AIR_QUALITY_LIMITS.map((limite) => limite.field),
]);

export function composeAirQuality(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const leituras = medicoes(input);

  identificacao(document, input, context, theme);
  ambiente(document, input, context, theme);
  resumo(document, leituras, theme);
  parametros(document, leituras, theme);
  parecer(document, input, theme);
  recomendacoes(document, input, theme);
  respostasLivres(document, input, theme);
  evidencias(document, input, theme);
  responsabilidadeTecnica(document, input, theme);
  fundamentoLegal(document, leituras, theme);
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
    { label: 'Data da medição', value: context.operation?.completedAt },
    { label: 'Atendimento relacionado', value: context.operation?.code },
    { label: 'Responsável técnico', value: responsavel?.signerName },
    {
      label: 'Registro profissional',
      value: responsavel?.professionalCredential,
    },
  ];

  sectionTitle(document, 'Identificação do relatório', theme);
  definitionCard(document, itens, theme);
}

function ambiente(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const cliente = context.customer;

  const itens: DefinitionItem[] = [
    { label: 'Contratante', value: cliente?.name },
    { label: 'Documento', value: cliente?.document },
    { label: 'Ambiente avaliado', value: valorDoCampo(input, 'local') },
    { label: 'Área', value: comUnidade(input, 'area') },
    { label: 'Ocupação média', value: comUnidade(input, 'ocupacao') },
    {
      label: 'Equipamento de medição',
      value: valorDoCampo(input, 'equipamento_medicao'),
    },
    { label: 'Endereço', value: cliente?.address, full: true },
  ];
  if (!itens.some((item) => item.value)) return;

  sectionTitle(document, 'Ambiente avaliado', theme);
  definitionCard(document, itens, theme);
}

/**
 * Quantos parâmetros ficaram fora, antes da tabela.
 *
 * Quem abre um relatório de qualidade do ar quer saber em cinco segundos se
 * tem problema. Obrigar a varrer seis linhas para descobrir é perder a única
 * pergunta que o documento existe para responder.
 */
function resumo(
  document: Doc,
  leituras: readonly Leitura[],
  theme: DocumentTheme,
): void {
  const medidos = leituras.filter((leitura) => leitura.verdict !== 'UNKNOWN');
  if (medidos.length === 0) return;

  const fora = medidos.filter((leitura) => leitura.verdict !== 'WITHIN');
  const texto =
    fora.length === 0
      ? `Os ${medidos.length} parâmetros medidos ficaram dentro dos valores de referência da RE nº 9/2003.`
      : `${fora.length} de ${medidos.length} parâmetros medidos ficaram fora dos valores de referência da RE nº 9/2003: ${fora
          .map((leitura) => leitura.limit.label.toLowerCase())
          .join(', ')}.`;

  sectionTitle(document, 'Resultado da medição', theme);
  statementBlock(document, texto, theme, {
    title: 'Comparação com os valores de referência',
  });
}

function parametros(
  document: Doc,
  leituras: readonly Leitura[],
  theme: DocumentTheme,
): void {
  if (leituras.length === 0) return;

  sectionTitle(document, 'Parâmetros medidos', theme);
  table(
    document,
    COLUNAS_DOS_PARAMETROS,
    leituras.map((leitura) => [
      leitura.limit.label,
      leitura.medido ?? '—',
      leitura.limit.unit,
      leitura.limit.reference,
      verdictLabel(leitura.verdict),
    ]),
    theme,
    { continuationLabel: '(continuação)' },
  );

  if (leituras.some((leitura) => leitura.limit.seasonal)) {
    noteBlock(
      document,
      'Temperatura e umidade relativa têm faixas distintas para verão e ' +
        'inverno. A comparação acima usa a envoltória das duas faixas: um ' +
        'valor fora dela está fora em qualquer estação, e um valor dentro ' +
        'dela pode ainda estar fora da faixa da estação em que a medição foi ' +
        'feita.',
      theme,
      { title: 'Ressalva sobre temperatura e umidade' },
    );
  }
}

/** O parecer é de quem assina, e sai como ele escreveu. */
function parecer(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = valorDoCampo(input, 'parecer');
  if (!texto) return;
  sectionTitle(document, 'Parecer técnico', theme, { espacoMinimo: 140 });
  statementBlock(document, texto, theme);
}

function recomendacoes(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const texto = valorDoCampo(input, 'recomendacoes');
  if (!texto) return;
  sectionTitle(document, 'Recomendações', theme);
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

function responsabilidadeTecnica(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  if (input.signatures.length === 0) return;
  sectionTitle(document, 'Responsabilidade técnica', theme, {
    espacoMinimo: 130,
  });
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

/**
 * De onde vêm os referenciais.
 *
 * Sem a citação, a coluna "Referência" é um número que o sistema afirma sem
 * dizer com que autoridade — e quem quiser conferir não sabe onde procurar.
 */
function fundamentoLegal(
  document: Doc,
  leituras: readonly Leitura[],
  theme: DocumentTheme,
): void {
  if (leituras.length === 0) return;
  noteBlock(document, RE9_SOURCE, theme, {
    title: 'Fundamento dos valores de referência',
  });
}

/* ------------------------------------------------------------------ */
/* Leitura das medições                                                */
/* ------------------------------------------------------------------ */

interface Leitura {
  readonly limit: AirQualityLimit;
  /** Já formatado em pt-BR; `undefined` quando não houve medição. */
  readonly medido?: string;
  readonly verdict: LimitVerdict;
}

/**
 * As medições, na ordem dos referenciais.
 *
 * A ordem é a do arquivo de limites — contaminantes primeiro, conforto depois
 * — e não a do template: é a ordem em que um laudo de qualidade do ar é lido,
 * e ela não deve mudar porque alguém reordenou campos no editor.
 */
function medicoes(input: RenderInput): readonly Leitura[] {
  return AIR_QUALITY_LIMITS.map((limit) => {
    const campo = campoPorId(input, limit.field);
    const valor = campo && !campo.hidden ? numero(campo.value) : undefined;
    return {
      limit,
      medido: valor === undefined ? undefined : formatarNumero(valor),
      verdict: evaluateLimit(limit, valor),
    };
  }).filter(
    /* Parâmetro que o template não tem some da tabela; parâmetro que o
       template tem e ninguém mediu fica, marcado como não medido — a
       ausência da medição é informação. */
    (leitura) => campoPorId(input, leitura.limit.field) !== undefined,
  );
}

function numero(valor: unknown): number | undefined {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : undefined;
  }
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.replace(/[^\d.,-]/g, '').trim();
  if (limpo === '') return undefined;
  const ultimoSeparador = Math.max(
    limpo.lastIndexOf(','),
    limpo.lastIndexOf('.'),
  );
  const normalizado =
    ultimoSeparador === -1
      ? limpo
      : `${limpo.slice(0, ultimoSeparador).replace(/[.,]/g, '')}.${limpo.slice(ultimoSeparador + 1)}`;
  const resultado = Number(normalizado);
  return Number.isFinite(resultado) ? resultado : undefined;
}

function formatarNumero(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(valor);
}

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

function comUnidade(input: RenderInput, id: string): string | undefined {
  const campo = campoPorId(input, id);
  const texto = valorDoCampo(input, id);
  if (!texto) return undefined;
  return campo?.unit ? `${texto} ${campo.unit}` : texto;
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
