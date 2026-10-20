/**
 * O cálculo da comissão, sem banco.
 *
 * ## Por que é uma função pura
 *
 * É a parte que erra em silêncio. Uma comissão calculada com o percentual do
 * papel errado, ou com a janela de fechamento deslocada por um dia, sai como um
 * número plausível — ninguém desconfia de R$ 240,00. Fora da transação, cada
 * regra se testa com um caso que a descreve.
 *
 * ## O que é comissionável
 *
 * Atendimento **concluído**, do tipo elegível, e — quando a política exige —
 * com receita confirmada. Atendimento em andamento não gera comissão porque o
 * serviço ainda pode não acontecer; atendimento sem receita confirmada só gera
 * quando a organização escolhe pagar pelo serviço feito, e não pelo recebido.
 *
 * ## Papéis
 *
 * `PRIMARY` é o técnico responsável (`responsibleFieldTechnicianId`);
 * `ASSISTANT` é cada auxiliar ativo (`OperationAuxiliaryTechnician` sem
 * `removedAt`). São valores diferentes porque é combinação diferente — e a mesma
 * pessoa pode ser responsável num atendimento e auxiliar em outro.
 */

/* O vocabulário vem do contrato publicado: é o que o cliente lê, e uma segunda
   declaração aqui sairia de sincronia com ele. */
export {
  COMMISSION_MODES,
  COMMISSION_PERIODS,
  COMMISSION_ROLES,
  type CommissionMode,
  type CommissionPeriod,
  type CommissionRole,
} from './commission.read-models';
import type {
  CommissionMode,
  CommissionPeriod,
  CommissionRole,
} from './commission.read-models';

export interface CommissionPolicySource {
  readonly period: CommissionPeriod;
  readonly mode: CommissionMode;
  /** Reais por atendimento ou percentual sobre a receita, conforme `mode`. */
  readonly primaryValue: number;
  readonly assistantValue: number;
  /** Vazio significa todos os tipos. */
  readonly eligibleKinds: readonly string[];
  readonly requiresConfirmedRevenue: boolean;
  readonly active: boolean;
}

/** O atendimento como o cálculo precisa vê-lo. */
export interface CommissionOperationSource {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly completedAt: Date | null;
  readonly customerName: string | null;
  readonly primaryUserId: string | null;
  readonly assistantUserIds: readonly string[];
  /** Receita confirmada do atendimento, já somada. */
  readonly confirmedRevenue: number;
}

export interface CommissionLine {
  readonly operationId: string;
  readonly operationCode: string;
  readonly operationTitle: string;
  readonly customerName: string | null;
  readonly completedAt: Date | null;
  readonly userId: string;
  readonly role: CommissionRole;
  readonly mode: CommissionMode;
  readonly rate: number;
  /** Receita considerada; `null` quando o valor é fixo. */
  readonly baseAmount: number | null;
  readonly amount: number;
}

/** Centavos, sempre — `0.1 + 0.2` não é o que se paga a ninguém. */
function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rateFor(policy: CommissionPolicySource, role: CommissionRole): number {
  return role === 'PRIMARY' ? policy.primaryValue : policy.assistantValue;
}

/**
 * O atendimento gera comissão?
 *
 * Exportada porque a recusa precisa ser explicável na tela: "não concluído" e
 * "sem receita confirmada" mandam a pessoa a lugares diferentes.
 */
export function isCommissionable(
  operation: CommissionOperationSource,
  policy: CommissionPolicySource,
): boolean {
  if (!policy.active) return false;
  if (operation.status !== 'COMPLETED') return false;
  if (
    policy.eligibleKinds.length > 0 &&
    !policy.eligibleKinds.includes(operation.kind)
  ) {
    return false;
  }
  /* Percentual sem base é zero — e uma linha de R$ 0,00 na lista de comissões a
     pagar é ruído que a pessoa confere uma vez e desconfia sempre. */
  if (policy.mode === 'PERCENTAGE' && operation.confirmedRevenue <= 0) {
    return false;
  }
  if (policy.requiresConfirmedRevenue && operation.confirmedRevenue <= 0) {
    return false;
  }
  return true;
}

/** Uma linha por pessoa envolvida no atendimento. */
export function linesFor(
  operation: CommissionOperationSource,
  policy: CommissionPolicySource,
): CommissionLine[] {
  if (!isCommissionable(operation, policy)) return [];

  const linhas: CommissionLine[] = [];

  const acrescentar = (userId: string, role: CommissionRole) => {
    const rate = rateFor(policy, role);
    const amount =
      policy.mode === 'FIXED'
        ? round(rate)
        : round((operation.confirmedRevenue * rate) / 100);

    /* Linha de zero não entra. Cobre dois casos com a mesma regra: o papel sem
       valor configurado — quem pôs 0 para auxiliar decidiu que auxiliar não
       recebe — e o percentual que arredonda para nada sobre uma receita
       mínima. Uma lista de comissões com R$ 0,00 pede conferência a cada
       fechamento. */
    if (amount <= 0) return;

    linhas.push({
      operationId: operation.id,
      operationCode: operation.code,
      operationTitle: operation.title,
      customerName: operation.customerName,
      completedAt: operation.completedAt,
      userId,
      role,
      mode: policy.mode,
      rate,
      baseAmount:
        policy.mode === 'PERCENTAGE' ? operation.confirmedRevenue : null,
      amount,
    });
  };

  if (operation.primaryUserId) acrescentar(operation.primaryUserId, 'PRIMARY');

  /* Duplicidade é possível no dado: a mesma pessoa listada duas vezes como
     auxiliar produziria duas comissões pelo mesmo papel no mesmo atendimento, e
     o índice único do pagamento recusaria a segunda — depois de o valor já ter
     aparecido somado na tela. */
  for (const userId of new Set(operation.assistantUserIds)) {
    /* Responsável que também consta como auxiliar recebe uma vez, pelo papel
       que paga mais. */
    if (userId === operation.primaryUserId) continue;
    acrescentar(userId, 'ASSISTANT');
  }

  return linhas;
}

export interface DayWindow {
  /** Instante inicial, inclusivo. */
  readonly from: Date;
  /** Instante final, inclusivo. */
  readonly to: Date;
}

/**
 * A janela de fechamento vigente.
 *
 * `WEEKLY` é segunda a domingo; `BIWEEKLY` é a quinzena brasileira — dia 1 ao 15
 * e 16 ao fim do mês, e não "quinze dias para trás", que faria o fechamento
 * andar de lugar a cada mês; `MONTHLY` é o mês civil.
 *
 * Tudo em UTC, como o resto do sistema: o fechamento não pode mudar de dia
 * conforme o fuso de quem abre a tela.
 */
export function currentWindow(
  period: CommissionPeriod,
  now = new Date(),
): DayWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  if (period === 'MONTHLY') {
    return {
      from: new Date(Date.UTC(year, month, 1)),
      to: endOfDay(new Date(Date.UTC(year, month + 1, 0))),
    };
  }

  if (period === 'BIWEEKLY') {
    return day <= 15
      ? {
          from: new Date(Date.UTC(year, month, 1)),
          to: endOfDay(new Date(Date.UTC(year, month, 15))),
        }
      : {
          from: new Date(Date.UTC(year, month, 16)),
          to: endOfDay(new Date(Date.UTC(year, month + 1, 0))),
        };
  }

  /* Segunda como início da semana: `getUTCDay` devolve 0 para domingo, que
     nesta conta é o último dia, não o primeiro. */
  const weekday = now.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(Date.UTC(year, month, day - offset));
  return {
    from: monday,
    to: endOfDay(new Date(monday.getTime() + 6 * 86_400_000)),
  };
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

/** Soma de linhas, em centavos arredondados uma vez só no fim. */
export function sumAmounts(lines: readonly { amount: number }[]): number {
  return round(lines.reduce((total, line) => total + line.amount, 0));
}
