/**
 * Contratos da comissão de técnicos.
 *
 * Os Read Models vêm do backend por `contracts:sync`. O que se escreve aqui são
 * as **entradas** — o que cada rota aceita —, espelhando os DTOs do servidor.
 * Nenhuma delas tem valor: o cliente escolhe quais comissões pagar, e quem
 * calcula quanto é o servidor.
 */
export type {
  CommissionMode,
  CommissionOverviewReadModel as CommissionOverview,
  CommissionPaymentItemReadModel as CommissionPaymentItem,
  CommissionPaymentMethod,
  CommissionPaymentReadModel as CommissionPayment,
  CommissionPeriod,
  CommissionPolicyReadModel as CommissionPolicy,
  CommissionReadModel as Commission,
  CommissionRole,
  CommissionStatus,
  CommissionSummaryReadModel as CommissionSummary,
  CommissionWindowReadModel as CommissionWindow,
} from "./contracts/modules/commissions/commission.read-models";

export {
  COMMISSION_MODES,
  COMMISSION_PAYMENT_METHODS,
  COMMISSION_PERIODS,
  COMMISSION_ROLES,
  COMMISSION_STATUSES,
} from "./contracts/modules/commissions/commission.read-models";

import type {
  CommissionMode,
  CommissionPeriod,
  CommissionRole,
  CommissionStatus,
  CommissionPaymentMethod,
} from "./contracts/modules/commissions/commission.read-models";

/** `PUT /commissions/policy` (`SaveCommissionPolicyDto`). */
export interface SaveCommissionPolicyInput {
  period: CommissionPeriod;
  mode: CommissionMode;
  /** Reais por atendimento ou percentual, conforme `mode`. */
  primaryValue: number;
  assistantValue: number;
  /** Vazio significa todos os tipos de atendimento. */
  eligibleKinds?: string[];
  requiresConfirmedRevenue: boolean;
  active: boolean;
}

/** `GET /commissions`, `/overview` (`CommissionQueryDto`). */
export interface CommissionQuery {
  from?: string;
  to?: string;
  userId?: string;
  businessUnitId?: string;
}

/** `GET /commissions` (`CommissionListQueryDto`). */
export interface CommissionListQuery extends CommissionQuery {
  /** Ausente devolve as três situações. */
  status?: CommissionStatus;
}

/** `POST /commissions/cancellations` e `/revocations` (`CancelCommissionDto`). */
export interface CancelCommissionInput {
  operationId: string;
  userId: string;
  role: CommissionRole;
  /** Por que não vai ser paga — é o que se lê meses depois. */
  reason?: string;
}

/** `GET /commissions/payments` (`CommissionPaymentQueryDto`). */
export interface CommissionPaymentQuery extends CommissionQuery {
  limit?: number;
}

/** `POST /commissions/payments` (`PayCommissionsDto`). */
export interface PayCommissionsInput {
  userId: string;
  /** Ausente, paga todas as pendentes da janela. */
  selection?: readonly { operationId: string; role: CommissionRole }[];
  from?: string;
  to?: string;
  method?: CommissionPaymentMethod;
  notes?: string;
}

export const COMMISSION_PERIOD_LABELS: Readonly<
  Record<CommissionPeriod, string>
> = {
  WEEKLY: "Semanal",
  BIWEEKLY: "Quinzenal",
  MONTHLY: "Mensal",
};

export const COMMISSION_MODE_LABELS: Readonly<Record<CommissionMode, string>> =
  {
    FIXED: "Valor fixo por atendimento",
    PERCENTAGE: "Percentual da receita",
  };

export const COMMISSION_ROLE_LABELS: Readonly<Record<CommissionRole, string>> =
  {
    PRIMARY: "Responsável",
    ASSISTANT: "Auxiliar",
  };

export const COMMISSION_METHOD_LABELS: Readonly<
  Record<CommissionPaymentMethod, string>
> = {
  PIX: "PIX",
  TRANSFER: "Transferência",
  CASH: "Dinheiro",
  PAYROLL: "Folha de pagamento",
  OTHER: "Outro",
};

export const COMMISSION_STATUS_LABELS: Readonly<
  Record<CommissionStatus, string>
> = {
  PENDING: "A pagar",
  PAID: "Paga",
  CANCELLED: "Cancelada",
};
