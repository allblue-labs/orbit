/**
 * A frequência do PMOC em nomes de contrato, não em números soltos.
 *
 * ## O que estava difícil
 *
 * O formulário pedia um número e uma unidade — "3" e "mês(es)" —, que é
 * literalmente "de três em três meses". Mas ninguém lê assim: lido rápido,
 * "frequência 1 mês(es)" parece *quantas vezes* no mês, e quem queria trimestral
 * não encontrava onde dizer isso. O contrato de manutenção fala em mensal,
 * trimestral, semestral; o formulário obrigava a traduzir de cabeça.
 *
 * As cadências abaixo são as do mercado, e cada uma é só um atalho para o par que o
 * contrato já aceita. A unidade de medida continua sendo a do servidor — nada aqui
 * inventa periodicidade nova.
 *
 * ## Personalizada continua existindo
 *
 * Porque contrato é contrato: existe "a cada 45 dias", e tirar o par cru tornaria
 * esse caso impossível de escrever. O que ele deixa de ser é o **único** caminho.
 *
 * ## Quantas execuções vão existir não se decide aqui
 *
 * A cadência diz o intervalo; o número de execuções depende dele **e** da vigência,
 * e é o `POST /pmoc/plans/preview` que responde. Meses e anos têm semântica de
 * calendário — seis meses depois de 31 de agosto é 28 de fevereiro —, e essa
 * aritmética mora no domínio e no banco. Uma estimativa calculada aqui divergiria na
 * primeira virada de mês, e divergiria calada.
 */
import { PmocFrequencyUnit } from "@/types/contracts";

export type CadenciaKey =
  | "SEMANAL"
  | "QUINZENAL"
  | "MENSAL"
  | "BIMESTRAL"
  | "TRIMESTRAL"
  | "QUADRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL"
  | "PERSONALIZADA";

export interface Cadencia {
  readonly key: CadenciaKey;
  readonly label: string;
  /** Como a periodicidade se lê em voz alta, para a tela não deixar dúvida. */
  readonly descricao: string;
  readonly amount: number;
  readonly unit: PmocFrequencyUnit;
}

/**
 * As cadências na ordem do mais frequente para o menos.
 *
 * É a ordem em que quem monta um contrato pensa — "é mensal? trimestral?" — e não a
 * alfabética, que colocaria Anual no topo da lista de uma periodicidade curta.
 */
export const CADENCIAS: readonly Cadencia[] = [
  {
    key: "SEMANAL",
    label: "Semanal",
    descricao: "uma vez por semana",
    amount: 1,
    unit: PmocFrequencyUnit.WEEKS,
  },
  {
    key: "QUINZENAL",
    label: "Quinzenal",
    descricao: "a cada duas semanas",
    amount: 2,
    unit: PmocFrequencyUnit.WEEKS,
  },
  {
    key: "MENSAL",
    label: "Mensal",
    descricao: "uma vez por mês",
    amount: 1,
    unit: PmocFrequencyUnit.MONTHS,
  },
  {
    key: "BIMESTRAL",
    label: "Bimestral",
    descricao: "a cada dois meses",
    amount: 2,
    unit: PmocFrequencyUnit.MONTHS,
  },
  {
    key: "TRIMESTRAL",
    label: "Trimestral",
    descricao: "a cada três meses",
    amount: 3,
    unit: PmocFrequencyUnit.MONTHS,
  },
  {
    key: "QUADRIMESTRAL",
    label: "Quadrimestral",
    descricao: "a cada quatro meses",
    amount: 4,
    unit: PmocFrequencyUnit.MONTHS,
  },
  {
    key: "SEMESTRAL",
    label: "Semestral",
    descricao: "a cada seis meses",
    amount: 6,
    unit: PmocFrequencyUnit.MONTHS,
  },
  {
    key: "ANUAL",
    label: "Anual",
    descricao: "uma vez por ano",
    amount: 1,
    unit: PmocFrequencyUnit.YEARS,
  },
];

/** O par que a cadência manda ao servidor. */
export function intervaloDaCadencia(
  key: CadenciaKey,
): { amount: number; unit: PmocFrequencyUnit } | null {
  const cadencia = CADENCIAS.find((item) => item.key === key);
  return cadencia ? { amount: cadencia.amount, unit: cadencia.unit } : null;
}

/**
 * Qual cadência corresponde a um par já gravado.
 *
 * Serve para abrir o formulário no nome certo em vez de em "Personalizada": um plano
 * trimestral existente é `3 MONTHS`, e mostrá-lo como personalizado faria o nome da
 * periodicidade desaparecer de quem só quis conferir.
 *
 * Sem correspondência é `PERSONALIZADA` — "a cada 45 dias" é um par legítimo que
 * nenhum nome do mercado descreve.
 */
export function cadenciaDoIntervalo(
  amount: number,
  unit: PmocFrequencyUnit,
): CadenciaKey {
  const encontrada = CADENCIAS.find(
    (item) => item.amount === amount && item.unit === unit,
  );
  return encontrada?.key ?? "PERSONALIZADA";
}

/** Como a periodicidade se lê, para a tela confirmar o que foi escolhido. */
export function descricaoDaCadencia(
  key: CadenciaKey,
  amount: number,
  unit: PmocFrequencyUnit,
): string {
  const cadencia = CADENCIAS.find((item) => item.key === key);
  if (cadencia) return cadencia.descricao;
  return descricaoDoIntervalo(amount, unit);
}

const UNIDADE_SINGULAR: Readonly<Record<PmocFrequencyUnit, string>> = {
  DAYS: "dia",
  WEEKS: "semana",
  MONTHS: "mês",
  YEARS: "ano",
};

const UNIDADE_PLURAL: Readonly<Record<PmocFrequencyUnit, string>> = {
  DAYS: "dias",
  WEEKS: "semanas",
  MONTHS: "meses",
  YEARS: "anos",
};

/**
 * "a cada 45 dias", "a cada 1 dia".
 *
 * Concordância de número porque a frase aparece na tela e no resumo: "a cada 1 dias"
 * é o tipo de detalhe que faz uma tela parecer rascunho.
 */
export function descricaoDoIntervalo(
  amount: number,
  unit: PmocFrequencyUnit,
): string {
  if (!Number.isFinite(amount) || amount < 1) return "intervalo não definido";
  const nome = amount === 1 ? UNIDADE_SINGULAR[unit] : UNIDADE_PLURAL[unit];
  return `a cada ${amount} ${nome}`;
}
