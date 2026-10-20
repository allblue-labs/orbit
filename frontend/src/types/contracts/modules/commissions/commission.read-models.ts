/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * Contratos de leitura da comissão.
 *
 * Números vão como `number` em reais, já arredondados em centavo pelo servidor.
 * `Decimal` do Prisma não atravessa JSON de forma previsível, e string obrigaria
 * cada tela a converter — duas conversões e duas chances de arredondar diferente
 * do que foi pago.
 */
/**
 * O vocabulário da comissão mora aqui, e não no cálculo.
 *
 * Este arquivo é contrato publicado — o frontend o recebe por
 * `contracts:sync`, e o guarda de fronteira recusa que ele importe de fora do
 * limite sincronizado. Declarar as listas aqui põe a definição no lugar onde o
 * cliente a lê, e o cálculo as importa deste arquivo.
 */
export const COMMISSION_PERIODS = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type CommissionPeriod = (typeof COMMISSION_PERIODS)[number];

export const COMMISSION_MODES = ['FIXED', 'PERCENTAGE'] as const;
export type CommissionMode = (typeof COMMISSION_MODES)[number];

export const COMMISSION_ROLES = ['PRIMARY', 'ASSISTANT'] as const;
export type CommissionRole = (typeof COMMISSION_ROLES)[number];

export const COMMISSION_STATUSES = ['PENDING', 'PAID', 'CANCELLED'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const COMMISSION_PAYMENT_METHODS = [
  'PIX',
  'TRANSFER',
  'CASH',
  'PAYROLL',
  'OTHER',
] as const;
export type CommissionPaymentMethod =
  (typeof COMMISSION_PAYMENT_METHODS)[number];

export interface CommissionPolicyReadModel {
  /** `false` quando a organização nunca salvou política: a tela pede a primeira. */
  readonly configured: boolean;
  readonly active: boolean;
  readonly period: CommissionPeriod;
  readonly mode: CommissionMode;
  readonly primaryValue: number;
  readonly assistantValue: number;
  readonly eligibleKinds: readonly string[];
  readonly requiresConfirmedRevenue: boolean;
  readonly updatedAt: string | null;
}

/** Uma comissão: o atendimento, a pessoa, o papel e a situação. */
export interface CommissionReadModel {
  readonly operationId: string;
  readonly operationCode: string;
  readonly operationTitle: string;
  readonly customerName: string | null;
  readonly completedAt: string | null;
  readonly userId: string;
  readonly userName: string | null;
  readonly role: CommissionRole;
  readonly mode: CommissionMode;
  readonly rate: number;
  readonly baseAmount: number | null;
  readonly amount: number;
  /**
   * `PENDING`, `PAID` ou `CANCELLED`.
   *
   * Não há estado intermediário: a comissão existe e espera, foi paga, ou a
   * organização decidiu não pagar. "Aprovada" seria um estado que nada no
   * sistema consulta.
   */
  readonly status: CommissionStatus;
  readonly paidAt: string | null;
  readonly paymentId: string | null;
  /** Preenchidos quando `CANCELLED`. */
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
}

/** O que a linha de um técnico mostra na tabela da Equipe. */
export interface CommissionSummaryReadModel {
  readonly userId: string;
  readonly userName: string | null;
  readonly email: string | null;
  readonly roleName: string | null;
  readonly membershipStatus: string | null;
  /** Comissão a pagar na janela. */
  readonly pendingAmount: number;
  readonly pendingCount: number;
  /** Já paga na janela — o que o fechamento anterior fechou. */
  readonly paidAmount: number;
  readonly paidCount: number;
  /** O que foi decidido não pagar na janela. */
  readonly cancelledAmount: number;
  readonly cancelledCount: number;
  readonly assignedOperations: number;
  readonly operationsInProgress: number;
  readonly executionsResponsible: number;
  readonly executionsInProgress: number;
}

export interface CommissionWindowReadModel {
  readonly from: string;
  readonly to: string;
  readonly period: CommissionPeriod;
}

export interface CommissionOverviewReadModel {
  readonly window: CommissionWindowReadModel;
  readonly policy: CommissionPolicyReadModel;
  /** Por que não há nada a mostrar, quando é o caso. */
  readonly inactiveReason: string | null;
  readonly technicians: readonly CommissionSummaryReadModel[];
  readonly pendingTotal: number;
  readonly paidTotal: number;
}

export interface CommissionPaymentItemReadModel {
  readonly id: string;
  readonly operationId: string;
  readonly operationCode: string | null;
  readonly operationTitle: string | null;
  readonly role: CommissionRole;
  readonly mode: CommissionMode;
  readonly rate: number;
  readonly baseAmount: number | null;
  readonly amount: number;
}

export interface CommissionPaymentReadModel {
  readonly id: string;
  readonly userId: string;
  readonly amount: number;
  readonly currency: string;
  /** A lista é fechada pelo `CHECK` do banco, e o cliente a usa para rotular. */
  readonly method: CommissionPaymentMethod | null;
  readonly notes: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly paidAt: string;
  readonly createdBy: {
    readonly id: string;
    readonly displayName: string;
  } | null;
  readonly items: readonly CommissionPaymentItemReadModel[];
}
