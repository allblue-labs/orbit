/**
 * As regras do domínio PMOC, sem banco e sem framework.
 *
 * ## Três estados diferentes, e é preciso não confundi-los
 *
 * | Estado | Do que fala | Quem decide |
 * | --- | --- | --- |
 * | **do plano** | o compromisso está valendo? | quem administra o plano |
 * | **de conformidade** | a manutenção está em dia? | o calendário |
 * | **da execução** | aquele ciclo foi cumprido? | quem executou |
 *
 * Um plano `ACTIVE` pode estar `OVERDUE`; um plano `SUSPENDED` não está em dia
 * nem atrasado — está fora de avaliação. Misturar os três produziria a pergunta
 * errada: "o plano está vencido?" não tem resposta, porque plano não vence,
 * manutenção vence.
 *
 * ## O que este arquivo **não** faz
 *
 * Não interpreta norma, não conhece a Lei 13.589, não deduz periodicidade legal
 * por tipo de equipamento e não emite parecer. A periodicidade é a que o cliente
 * contratou e alguém digitou; o Orbit a cumpre e registra — não a prescreve.
 */

import {
  PmocComplianceStatus,
  PmocFrequencyUnit,
  PmocPlanStatus,
} from '../../contracts';

/* -------------------------------------------------------------------- */
/* Estado do plano                                                       */
/* -------------------------------------------------------------------- */

/**
 * Os conjuntos fechados moram em `contracts/literals` — são contrato público,
 * sincronizado com os clientes. Aqui fica a forma de lista, que o DTO usa, e
 * as regras que só o servidor aplica.
 */
export const PLAN_STATUSES: readonly PlanStatus[] =
  Object.values(PmocPlanStatus);
export type PlanStatus = PmocPlanStatus;

/**
 * A máquina de estados, explícita.
 *
 * `EXPIRED` não é destino de ninguém: ele não é uma decisão, é a constatação de
 * que a vigência acabou — quem o atribui é o servidor, comparando `endsOn` com
 * a data de hoje. Uma transição manual para "vencido" permitiria dizer que
 * acabou um contrato que ainda vale.
 *
 * `CANCELLED` é terminal. Um plano cancelado que voltasse a valer perderia o
 * significado do cancelamento — quem quer retomar cria outro, e o histórico dos
 * dois fica legível.
 */
export const PLAN_TRANSITIONS: Readonly<
  Record<PlanStatus, readonly PlanStatus[]>
> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  EXPIRED: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: string, to: PlanStatus): boolean {
  return (PLAN_TRANSITIONS[from as PlanStatus] ?? []).includes(to);
}

/** Só rascunho aceita edição de vigência e periodicidade. Ver o serviço. */
export const EDITABLE_STATUSES: readonly string[] = [
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
];

/* -------------------------------------------------------------------- */
/* Periodicidade                                                         */
/* -------------------------------------------------------------------- */

/**
 * Unidades de periodicidade.
 *
 * **Sem expressão cron.** Um campo cron seria uma linguagem dentro do
 * formulário, e a periodicidade de um PMOC é sempre "de N em N" — trimestral,
 * semestral, anual. O que cron acrescentaria ("toda primeira segunda-feira")
 * não é o que um contrato de manutenção diz.
 */
export const FREQUENCY_UNITS: readonly FrequencyUnit[] =
  Object.values(PmocFrequencyUnit);
export type FrequencyUnit = PmocFrequencyUnit;

export interface Frequency {
  amount: number;
  unit: FrequencyUnit;
}

const UNIT_LABELS: Readonly<Record<FrequencyUnit, [string, string]>> = {
  DAYS: ['dia', 'dias'],
  WEEKS: ['semana', 'semanas'],
  MONTHS: ['mês', 'meses'],
  YEARS: ['ano', 'anos'],
};

/** "a cada 6 meses", "a cada 1 ano". */
export function frequencyLabel(frequency: Frequency): string {
  const [singular, plural] = UNIT_LABELS[frequency.unit] ?? [
    'período',
    'períodos',
  ];
  return `a cada ${frequency.amount} ${frequency.amount === 1 ? singular : plural}`;
}

/* -------------------------------------------------------------------- */
/* Conformidade                                                          */
/* -------------------------------------------------------------------- */

/**
 * O estado de conformidade.
 *
 * `NOT_APPLICABLE` existe porque a alternativa seria mentir: um plano em
 * rascunho, suspenso, vencido ou cancelado **não está em dia** — ele está fora
 * de avaliação, e chamá-lo de `UP_TO_DATE` faria um painel dizer que está tudo
 * certo quando ninguém está mantendo nada.
 */
export const COMPLIANCE_STATUSES: readonly ComplianceStatus[] =
  Object.values(PmocComplianceStatus);
export type ComplianceStatus = PmocComplianceStatus;

export interface ComplianceInput {
  planStatus: string;
  /** Próximo vencimento, em dia. `null` quando o plano nunca foi ativado. */
  nextDueOn: Date | null;
  /** Antecedência do aviso, em dias. */
  dueSoonDays: number;
  /** Hoje, **pelo relógio do servidor**. */
  today: Date;
}

export interface ComplianceResult {
  status: ComplianceStatus;
  /** Negativo quando já venceu. `null` sem vencimento definido. */
  daysUntilDue: number | null;
  overdue: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A fórmula, e ela é toda a fórmula.
 *
 * ```
 * dias = próximo vencimento − hoje
 *
 * dias <  0                → OVERDUE
 * dias <= antecedência     → DUE_SOON
 * caso contrário           → UP_TO_DATE
 * ```
 *
 * Não há score, peso nem média: um número entre 0 e 100 que resume conformidade
 * esconde exatamente o que importa — **qual** plano venceu e **há quantos
 * dias**. Um painel com "87% de conformidade" não diz a ninguém o que fazer
 * amanhã de manhã.
 *
 * A antecedência é do plano (`dueSoonDays`, 15 por padrão) e não uma constante
 * global: avisar com trinta dias faz sentido num plano anual e é ruído num
 * plano semanal.
 *
 * A comparação é **por dia**, não por instante: manutenção vence no dia, e uma
 * comparação por hora faria o mesmo plano parecer vencido de manhã e em dia à
 * tarde conforme o fuso de quem consulta.
 */
export function evaluateCompliance(input: ComplianceInput): ComplianceResult {
  if (input.planStatus !== 'ACTIVE' || !input.nextDueOn) {
    return { status: 'NOT_APPLICABLE', daysUntilDue: null, overdue: false };
  }

  const due = startOfDay(input.nextDueOn);
  const today = startOfDay(input.today);
  const daysUntilDue = Math.round(
    (due.getTime() - today.getTime()) / MS_PER_DAY,
  );

  if (daysUntilDue < 0) {
    return { status: 'OVERDUE', daysUntilDue, overdue: true };
  }
  if (daysUntilDue <= input.dueSoonDays) {
    return { status: 'DUE_SOON', daysUntilDue, overdue: false };
  }
  return { status: 'UP_TO_DATE', daysUntilDue, overdue: false };
}

/** Meia-noite UTC do dia — a coluna é `DATE`, e o dia é a unidade. */
function startOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/** `YYYY-MM-DD`, que é como uma coluna `DATE` deve viajar. */
export function toDateOnly(value: Date): string {
  return startOfDay(value).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Elegibilidade de execução por equipamento                           */
/* ------------------------------------------------------------------ */

/**
 * O que impede este equipamento de iniciar a execução do ciclo.
 *
 * A regra vivia escrita duas vezes: uma na preparação, que devolve os motivos
 * para a tela, e outra no comando de início, que os transforma em recusa. A
 * lista do ciclo precisava dos mesmos motivos e não os tinha — cada linha
 * pedia a preparação inteira só para saber se podia começar, o que dava uma
 * requisição por equipamento. Agora a regra é uma função só, e quem lê e quem
 * escreve consultam a mesma.
 *
 * Quatro dos cinco motivos são do plano e do ciclo, não do equipamento: uma
 * lista inteira os calcula uma vez. Só `EQUIPMENT_INACTIVE` varia por linha.
 */
export interface ExecutionEligibilityInput {
  readonly planStatus: string;
  readonly cycleStatus: string;
  readonly equipmentStatus: string;
  readonly technicalResponsibleUserId: string | null;
  /** O que a workforce respondeu sobre o responsável técnico do plano. */
  readonly technicalResponsible: {
    readonly eligible: boolean;
    readonly blockedReason: string | null;
  } | null;
}

export interface ExecutionEligibility {
  readonly ready: boolean;
  readonly blockedReasons: readonly string[];
}

export function executionEligibility(
  input: ExecutionEligibilityInput,
): ExecutionEligibility {
  const blockedReasons: string[] = [];

  if (input.planStatus !== 'ACTIVE') blockedReasons.push('PLAN_NOT_ACTIVE');
  if (input.cycleStatus !== 'PENDING') blockedReasons.push('CYCLE_NOT_PENDING');
  if (input.equipmentStatus !== 'ACTIVE')
    blockedReasons.push('EQUIPMENT_INACTIVE');

  if (!input.technicalResponsibleUserId) {
    blockedReasons.push('TECHNICAL_RESPONSIBLE_MISSING');
  } else if (!input.technicalResponsible?.eligible) {
    blockedReasons.push(
      input.technicalResponsible?.blockedReason ??
        'TECHNICAL_RESPONSIBLE_INELIGIBLE',
    );
  }

  return { ready: blockedReasons.length === 0, blockedReasons };
}

/* ------------------------------------------------------------------ */
/* Código sugerido do plano                                            */
/* ------------------------------------------------------------------ */

/**
 * O nome do cliente, reduzido ao que cabe num código.
 *
 * Acentos viram a letra base, o resto vira hífen, e sobra só `A-Z`, `0-9` e
 * separador. É previsível de propósito: quem digita `PMOC-CLINICA-SAO-JOSE` na
 * busca precisa achar o plano de `Clínica São José LTDA`.
 *
 * O nome **não** é identidade — continua sendo o UUID. Isto aqui é a metade
 * legível do código, e nada mais depende dela.
 */
export function customerSlug(name: string, maxLength = 28): string {
  const semAcento = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  const bruto = semAcento.replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  if (bruto.length <= maxLength) return bruto;

  /**
   * Corta em palavra inteira quando dá. `CLINICA-SANTA-MAR` é pior que
   * `CLINICA-SANTA` para quem lê e para quem busca.
   */
  const cortado = bruto.slice(0, maxLength);
  const ultimoSeparador = cortado.lastIndexOf('-');
  return ultimoSeparador > maxLength / 2
    ? cortado.slice(0, ultimoSeparador)
    : cortado.replace(/-+$/, '');
}

/** O formato do código sugerido: `PMOC-{CLIENTE}-{NNN}`. */
export function buildSuggestedCode(
  customerName: string,
  sequence: number,
): string {
  const slug = customerSlug(customerName);
  const numero = String(sequence).padStart(3, '0');
  const base = slug ? `PMOC-${slug}-${numero}` : `PMOC-${numero}`;

  /**
   * A coluna tem 60 caracteres. O corte tira do **nome**, nunca do número:
   * um código sem sequência colidiria com o próximo.
   */
  if (base.length <= 60) return base;
  const excedente = base.length - 60;
  return `PMOC-${customerSlug(customerName, slug.length - excedente)}-${numero}`;
}

/**
 * Um código digitado à mão serve?
 *
 * Não exigimos o formato sugerido — o produto permite código próprio. Exigimos
 * o que o banco e a busca exigem: tamanho, alfabeto previsível e nada de
 * espaço no meio, que quebraria a leitura de qualquer relatório.
 */
export function normalizeCustomCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '-');
}

export const CUSTOM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{2,59}$/;

export function isValidPlanCode(value: string): boolean {
  return CUSTOM_CODE_PATTERN.test(value);
}

/* ------------------------------------------------------------------ */
/* Projeção da programação                                             */
/* ------------------------------------------------------------------ */

/**
 * Quantos atendimentos este plano terá, e quando.
 *
 * ## Por que isto é projeção, e não leitura
 *
 * Os ciclos do PMOC são **rolantes**: ativar o plano cria o primeiro, e cada
 * conclusão cria o seguinte a partir da data em que o trabalho foi de fato
 * feito. É o desenho certo — a próxima manutenção conta a partir da última
 * real, não de um calendário que ninguém cumpriu.
 *
 * O efeito colateral é que nada no sistema respondia *"quantas visitas este
 * plano vai ter"* antes da primeira ser executada. Esta função responde, sem
 * escrever nada: é o calendário ideal, aquele em que todo ciclo acontece no
 * dia previsto.
 *
 * A aritmética de mês é de calendário e satura no fim: 31/01 mais um mês é
 * 28/02, e não 03/03. É a mesma política de `nextDueOn` do banco, que usa
 * `make_interval` — o PostgreSQL satura do mesmo jeito.
 */
export interface SchedulePreviewInput {
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly frequencyAmount: number;
  readonly frequencyUnit: FrequencyUnit;
  /** Teto de segurança para planos sem fim de vigência. */
  readonly maxCycles?: number;
}

export interface SchedulePreview {
  readonly cycles: readonly {
    readonly sequence: number;
    readonly dueOn: string;
  }[];
  /** `true` quando a vigência é aberta e a lista foi truncada pelo teto. */
  readonly truncated: boolean;
}

export const PREVIEW_MAX_CYCLES = 120;

function addCalendar(
  base: Date,
  amount: number,
  unit: FrequencyUnit,
  steps: number,
): Date {
  const total = amount * steps;
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth();
  const dia = base.getUTCDate();

  if (unit === 'DAYS' || unit === 'WEEKS') {
    const dias = unit === 'WEEKS' ? total * 7 : total;
    return new Date(Date.UTC(ano, mes, dia + dias));
  }

  const mesesAdiante = unit === 'YEARS' ? total * 12 : total;
  const alvoAno = ano + Math.floor((mes + mesesAdiante) / 12);
  const alvoMes = (((mes + mesesAdiante) % 12) + 12) % 12;

  /**
   * Satura no último dia do mês de destino. 31/01 + 1 mês = 28/02 (ou 29 em
   * ano bissexto), que é a política de calendário já usada pelo banco.
   */
  const ultimoDia = new Date(Date.UTC(alvoAno, alvoMes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(alvoAno, alvoMes, Math.min(dia, ultimoDia)));
}

export function previewSchedule(input: SchedulePreviewInput): SchedulePreview {
  const teto = input.maxCycles ?? PREVIEW_MAX_CYCLES;
  const inicio = new Date(`${input.startsOn}T00:00:00.000Z`);
  const fim = input.endsOn ? new Date(`${input.endsOn}T00:00:00.000Z`) : null;

  if (Number.isNaN(inicio.getTime())) return { cycles: [], truncated: false };
  if (fim && !Number.isNaN(fim.getTime()) && fim < inicio) {
    return { cycles: [], truncated: false };
  }

  const cycles: { sequence: number; dueOn: string }[] = [];
  for (let passo = 0; passo < teto; passo += 1) {
    const data = addCalendar(
      inicio,
      input.frequencyAmount,
      input.frequencyUnit,
      passo,
    );
    if (fim && data > fim) break;
    cycles.push({ sequence: passo + 1, dueOn: toDateOnly(data) });
  }

  return { cycles, truncated: !fim && cycles.length === teto };
}

/**
 * Quantas manutenções a vigência prevê.
 *
 * ## Para que serve
 *
 * O relatório de execução afirma "manutenção 3 de 12". O 3 é a contagem do
 * equipamento; o 12 é isto — e ele não está em coluna nenhuma, porque é
 * consequência da vigência e da periodicidade. Guardá-lo ficaria errado no dia
 * em que alguém corrigisse a data final do plano.
 *
 * ## Plano sem prazo final não tem total
 *
 * Devolve `null`, e o documento imprime "manutenção 3" sem o "de". Inventar um
 * teto — o de `PREVIEW_MAX_CYCLES`, por exemplo — faria o relatório afirmar
 * "3 de 120" para um contrato que ninguém disse que acaba.
 */
export function plannedExecutionCount(input: {
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly frequencyAmount: number;
  readonly frequencyUnit: FrequencyUnit;
}): number | null {
  /*
   * Sem prazo final não há total, e é esta linha que diz isso.
   *
   * Havia também uma guarda contra `truncated`, que `previewSchedule` só levanta
   * quando a vigência é aberta — ou seja, exatamente o caso que esta linha já
   * resolve. Duas guardas para uma regra significam que uma é morta: mutar a
   * primeira não reprovava nenhum teste, porque a segunda a cobria.
   */
  if (!input.endsOn) return null;

  const { cycles } = previewSchedule(input);
  return cycles.length > 0 ? cycles.length : null;
}

/**
 * O fim da vigência, a partir da duração.
 *
 * ## A conta que quase todo mundo erra
 *
 * Uma vigência de seis meses que começa em 08/09 termina em **07/03**, não em
 * 08/03 — senão são seis meses e um dia, e o plano ganha um sétimo atendimento
 * que ninguém contratou. O dia inicial conta; o mesmo dia do sétimo mês, não.
 *
 * É por isso que a duração existe como conceito separado de `endsOn`: a tela
 * pergunta *"vigência"*, que é duração, e o banco guarda uma data. Deixar o
 * usuário calcular a data à mão é como o sétimo ciclo aparece.
 */
export function coverageEndFromDuration(
  startsOn: string,
  amount: number,
  unit: FrequencyUnit,
): string {
  const inicio = new Date(`${startsOn}T00:00:00.000Z`);
  if (Number.isNaN(inicio.getTime()) || amount < 1) return startsOn;
  const limite = addCalendar(inicio, amount, unit, 1);
  return toDateOnly(new Date(limite.getTime() - 86_400_000));
}
