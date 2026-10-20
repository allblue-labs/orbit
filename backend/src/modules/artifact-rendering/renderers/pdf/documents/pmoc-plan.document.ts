/**
 * PMOC — Documento do Plano.
 *
 * ## Por que existem dois PMOCs
 *
 * O que o Orbit emitia até aqui é o **relatório de execução**: o registro do
 * que foi feito numa visita. Mas a Lei 13.589/2018 não pede só o registro da
 * manutenção — ela pede que o estabelecimento **tenha um plano**, por escrito,
 * dizendo quais equipamentos são atendidos, com que periodicidade, sob
 * responsabilidade de quem.
 *
 * É esse o documento que o fiscal pede na porta, e que o síndico arquiva. Sem
 * ele, a empresa tem doze relatórios de execução e nenhuma prova de que existe
 * um plano — que é exatamente a não-conformidade que a lei descreve.
 *
 * ## Não é uma execução
 *
 * Este documento não nasce de `ArtifactExecution`: não há respostas de campo,
 * não há evidência fotográfica, não há aceite do cliente. Ele descreve o plano
 * **como está configurado agora**, e por isso carrega a data de emissão com
 * destaque — um plano impresso em março não descreve o plano de dezembro.
 */
import {
  definitionCard,
  noteBlock,
  sectionTitle,
  table,
  type DefinitionItem,
  type TableColumn,
} from '../kit/blocks';
import { signatureBlock } from '../kit/media-blocks';
import type { DocumentTheme } from '../kit/theme';

type Doc = PDFKit.PDFDocument;

/** O que o documento do plano precisa saber. Montado pelo serviço de PMOC. */
export interface PmocPlanDocumentInput {
  readonly plan: {
    readonly code: string;
    readonly name: string;
    readonly status?: string;
    readonly coverageStart?: string;
    readonly coverageEnd?: string;
    readonly cadence?: string;
    readonly serviceTypes?: readonly string[];
    readonly notes?: string;
    readonly technicalResponsible?: string;
    readonly technicalResponsibleCredential?: string;
    /**
     * A assinatura do Responsável Técnico, em bytes.
     *
     * O bloco de assinatura sempre desenhou imagem quando recebia uma — e ninguém
     * passava: a linha do responsável saía em branco mesmo com assinatura
     * cadastrada. É ela que dá valor ao documento que o fiscal pede.
     *
     * Ausente continua valendo: o plano costuma ser impresso e assinado à mão, e a
     * linha em branco é o lugar disso.
     */
    readonly technicalResponsibleSignature?: Buffer;
    readonly technicalResponsibleSignatureMimeType?: string;
    readonly fieldTechnician?: string;
    readonly nextDueOn?: string;
    readonly lastExecutedAt?: string;
  };
  readonly customer: {
    readonly name?: string;
    readonly document?: string;
    readonly address?: string;
    readonly contactName?: string;
    readonly contactPhone?: string;
    /**
     * A assinatura do contratante, coletada pelo link público.
     *
     * Ausente, a linha sai em branco para assinar à mão — que é como o contrato
     * sempre funcionou e continua funcionando.
     */
    readonly signature?: Buffer;
    readonly signatureMimeType?: string;
    /** Quem declarou assinar, e quando. Substitui o nome do cliente na linha. */
    readonly signedBy?: string;
    readonly signedAtLabel?: string;
  };
  readonly equipment: readonly {
    readonly sector?: string;
    readonly name?: string;
    readonly manufacturer?: string;
    readonly model?: string;
    readonly capacity?: string;
    readonly identifier?: string;
    readonly coverageStart?: string;
  }[];
  /** Os ambientes declarados no plano, quando a organização os usa. */
  readonly units: readonly {
    readonly name: string;
    readonly checklist?: string;
  }[];
  /** O roteiro que cada visita vai percorrer, por grupo. */
  readonly procedure: readonly {
    readonly group: string;
    readonly items: readonly string[];
  }[];
  readonly legalReference?: string;
}

/**
 * A capacidade tem peso alto para o que mostra ("36.000 BTU/h", uma linha
 * curta): abaixo disso ela quebra em "36.000 BTU/" + "h" em toda linha da
 * tabela. Setor e equipamento cedem o espaço porque são os que já quebram em
 * duas linhas de qualquer jeito — e quebram bem.
 */
const COLUNAS_DO_EQUIPAMENTO: readonly TableColumn[] = [
  { header: 'Item', weight: 0.7, align: 'center' },
  { header: 'Setor', weight: 1.8 },
  { header: 'Equipamento', weight: 2.2 },
  { header: 'Marca', weight: 1.4 },
  { header: 'Modelo', weight: 1.6 },
  { header: 'Identificação', weight: 1.8, mono: true },
  { header: 'Capacidade', weight: 1.8, align: 'right' },
];

export function composePmocPlan(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  identificacao(document, input, theme);
  regimeDeManutencao(document, input, theme);
  ambientes(document, input, theme);
  equipamentos(document, input, theme);
  roteiroPrevisto(document, input, theme);
  observacoes(document, input, theme);
  responsabilidade(document, input, theme);
  referenciaLegal(document, input, theme);
}

function identificacao(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  const itens: DefinitionItem[] = [
    { label: 'Plano', value: input.plan.code },
    { label: 'Denominação', value: input.plan.name },
    { label: 'Contratante', value: input.customer.name },
    { label: 'Documento do contratante', value: input.customer.document },
    { label: 'Contato', value: input.customer.contactName },
    { label: 'Telefone', value: input.customer.contactPhone },
    {
      label: 'Endereço da instalação',
      value: input.customer.address,
      full: true,
    },
  ];

  sectionTitle(document, 'Identificação do plano', theme);
  definitionCard(document, itens, theme);
}

function regimeDeManutencao(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  const plano = input.plan;
  const itens: DefinitionItem[] = [
    { label: 'Periodicidade', value: plano.cadence },
    {
      label: 'Vigência',
      value:
        plano.coverageStart && plano.coverageEnd
          ? `${plano.coverageStart} a ${plano.coverageEnd}`
          : plano.coverageStart,
    },
    { label: 'Próxima visita prevista', value: plano.nextDueOn },
    { label: 'Última execução', value: plano.lastExecutedAt },
    {
      label: 'Tipos de serviço',
      value: plano.serviceTypes?.length
        ? plano.serviceTypes.join(', ')
        : undefined,
      full: true,
    },
  ];

  sectionTitle(document, 'Regime de manutenção', theme);
  definitionCard(document, itens, theme);
}

function ambientes(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  if (input.units.length === 0) return;
  sectionTitle(document, 'Ambientes atendidos', theme);
  table(
    document,
    [
      { header: 'Ambiente', weight: 3 },
      { header: 'Roteiro aplicado', weight: 3 },
    ],
    input.units.map((unidade) => [unidade.name, unidade.checklist ?? '—']),
    theme,
    { continuationLabel: '(continuação)' },
  );
}

function equipamentos(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  if (input.equipment.length === 0) {
    /* Um plano sem equipamento é um plano que não cobre nada — dizer isso é
       mais útil que omitir a seção e deixar quem lê supor que faltou imprimir. */
    sectionTitle(document, 'Equipamentos cobertos', theme);
    noteBlock(
      document,
      'Nenhum equipamento está coberto por este plano. Um PMOC sem parque declarado não atende ao que a Lei 13.589/2018 exige.',
      theme,
    );
    return;
  }

  sectionTitle(document, 'Equipamentos cobertos', theme);
  table(
    document,
    COLUNAS_DO_EQUIPAMENTO,
    input.equipment.map((item, indice) => [
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

function roteiroPrevisto(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  if (input.procedure.length === 0) return;

  sectionTitle(document, 'Roteiro previsto por visita', theme);
  for (const grupo of input.procedure) {
    table(
      document,
      [{ header: grupo.group, weight: 1 }],
      grupo.items.map((item) => [item]),
      theme,
      { continuationLabel: '(continuação)' },
    );
  }
}

function observacoes(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  if (!input.plan.notes?.trim()) return;
  sectionTitle(document, 'Observações do plano', theme);
  noteBlock(document, input.plan.notes.trim(), theme);
}

/**
 * Quem responde tecnicamente pelo plano.
 *
 * A lei atribui o PMOC a um responsável técnico identificável — sem nome e
 * registro, o documento não cumpre a função dele. A linha de assinatura sai
 * mesmo sem assinatura digital: o plano costuma ser impresso e assinado.
 */
function responsabilidade(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  sectionTitle(document, 'Responsabilidade técnica', theme, {
    espacoMinimo: 150,
  });

  definitionCard(
    document,
    [
      { label: 'Responsável técnico', value: input.plan.technicalResponsible },
      { label: 'Registro', value: input.plan.technicalResponsibleCredential },
      { label: 'Técnico designado', value: input.plan.fieldTechnician },
    ],
    theme,
  );

  signatureBlock(
    document,
    [
      {
        label: 'Responsável técnico',
        signerName: input.plan.technicalResponsible,
        roleLabel: 'Responsável técnico',
        credential: input.plan.technicalResponsibleCredential,
        image: input.plan.technicalResponsibleSignature,
        imageMimeType: input.plan.technicalResponsibleSignatureMimeType,
      },
      {
        label: 'Contratante',
        /* Quem assinou de fato vence o contato cadastrado: o documento deve nomear a
           pessoa que apertou "assinar", não a que estava no cadastro. */
        signerName:
          input.customer.signedBy ??
          input.customer.contactName ??
          input.customer.name,
        roleLabel: 'Contratante',
        signedAtLabel: input.customer.signedAtLabel,
        image: input.customer.signature,
        imageMimeType: input.customer.signatureMimeType,
      },
    ],
    theme,
  );
}

function referenciaLegal(
  document: Doc,
  input: PmocPlanDocumentInput,
  theme: DocumentTheme,
): void {
  if (!input.legalReference) return;
  noteBlock(document, input.legalReference, theme, {
    title: 'Fundamento legal',
  });
}
