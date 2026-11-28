/**
 * Read Models do Financeiro.
 *
 * ## Dinheiro viaja como string
 *
 * `amount` é `string`, nunca `number`. `Decimal(14,2)` não cabe em ponto
 * flutuante sem risco de arredondamento, e um centavo perdido em serialização
 * é um centavo que ninguém consegue explicar depois. O cliente formata a
 * string; não faz aritmética com ela.
 *
 * ## O que é fato e o que é previsão
 *
 * Todo total publicado aqui declara a que estado pertence. Não existe campo
 * "saldo" que misture `PENDING` com `CONFIRMED`: previsão e realizado são
 * grandezas diferentes, e somá-las às cegas produz um número que parece caixa
 * e não é.
 */

import type {
  FinancialEntrySource,
  FinancialEntryStatus,
  FinancialEntryType,
} from '../../contracts';

export interface FinancialCategoryReadModel {
  id: string;
  type: FinancialEntryType;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  /** Semeada pelo Orbit na abertura do módulo; não pode ser removida. */
  isSystem: boolean;
  sortOrder: number;
  /** Lançamentos vivos que a usam — o que impede a remoção. */
  entryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialActorReadModel {
  id: string;
  displayName: string;
}

/** Vínculo com o registro que originou um lançamento automático. */
export interface FinancialOriginReadModel {
  source: FinancialEntrySource;
  /** `null` em lançamento manual. */
  entityId: string | null;
}

export interface FinancialEntryReadModel {
  id: string;
  type: FinancialEntryType;
  status: FinancialEntryStatus;
  origin: FinancialOriginReadModel;
  /** Decimal com duas casas, em string. Nunca `number`. */
  amount: string;
  currency: string;
  description: string;
  notes: string | null;
  /** `YYYY-MM-DD` — quando o fato aconteceu. */
  competenceDate: string;
  /** `YYYY-MM-DD` — vencimento previsto, quando existe. */
  dueDate: string | null;
  /**
   * Vencido: `PENDING` cuja data de vencimento já passou.
   *
   * Calculado **no servidor**, contra o relógio do servidor. Um navegador com
   * a data errada não decide o que está atrasado.
   */
  isOverdue: boolean;
  category: {
    id: string;
    name: string;
    slug: string;
    color: string | null;
  } | null;
  businessUnit: { id: string; name: string };
  customer: { id: string; displayName: string } | null;
  operation: { id: string; code: string; title: string } | null;
  createdBy: FinancialActorReadModel;
  confirmedBy: FinancialActorReadModel | null;
  confirmedAt: string | null;
  cancelledBy: FinancialActorReadModel | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /**
   * Edição manual é permitida.
   *
   * `false` em lançamento de origem automática: o valor dele é o do recibo, e
   * mudá-lo aqui faria os dois documentos discordarem sem que nada registrasse
   * qual está certo. O cliente usa isto para desabilitar o formulário — mas
   * quem recusa a escrita é o servidor.
   */
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialSettingsReadModel {
  /**
   * Recibo oficialmente emitido vira receita confirmada.
   *
   * Desligar **não apaga** o que já foi lançado, e religar **não recupera** o
   * período desligado: o passado não é reescrito por uma configuração.
   */
  autoRecordReceipts: boolean;
  defaultCurrency: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------- */
/* Analytics                                                             */
/* -------------------------------------------------------------------- */

/**
 * Totais de um recorte, separados por natureza.
 *
 * `confirmed` é caixa; `pending` é expectativa; `cancelled` é o que deixou de
 * valer e existe aqui apenas para que a diferença entre o que foi lançado e o
 * que vale seja explicável.
 */
export interface FinancialTotalsReadModel {
  confirmed: string;
  pending: string;
  cancelled: string;
  count: number;
}

export interface FinancialSummaryReadModel {
  /** Recorte pedido, ecoado — o cliente não recalcula o período. */
  period: { from: string; to: string };
  currency: string;
  income: FinancialTotalsReadModel;
  expense: FinancialTotalsReadModel;
  /** `income.confirmed - expense.confirmed`. Somente realizado. */
  netConfirmed: string;
  /** `income.pending - expense.pending`. Somente previsto. */
  netPending: string;
  /** `PENDING` com vencimento anterior a hoje — entradas e saídas juntas. */
  overdue: FinancialTotalsReadModel;
  /** Entradas vencidas: a cobrar. */
  overdueIncome: FinancialTotalsReadModel;
  /** Saídas vencidas: contas atrasadas. */
  overdueExpense: FinancialTotalsReadModel;
}

export interface FinancialCategoryBreakdownReadModel {
  categoryId: string | null;
  /** `"Sem categoria"` quando o lançamento não tem categoria. */
  categoryName: string;
  color: string | null;
  type: FinancialEntryType;
  confirmed: string;
  pending: string;
  count: number;
}

/**
 * Um ponto da série. `period` é `YYYY-MM` (mensal) ou `YYYY-MM-DD` (diária);
 * `month` é sempre o mês do ponto.
 */
export interface FinancialTimelinePointReadModel {
  period: string;
  month: string;
  incomeConfirmed: string;
  incomePending: string;
  expenseConfirmed: string;
  expensePending: string;
  netConfirmed: string;
}
