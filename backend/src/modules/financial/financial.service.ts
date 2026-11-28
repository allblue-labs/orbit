/**
 * Regras do Financeiro.
 *
 * ## O que este domínio **não** faz
 *
 * Não concilia banco, não apura imposto, não fecha competência contábil, não
 * processa pagamento. Registra que dinheiro entrou ou saiu, quanto, quando, de
 * que categoria e por qual origem — e mantém isso auditável.
 *
 * ## Origem manda mais que edição
 *
 * Um lançamento com `source` diferente de `MANUAL` foi derivado de outro
 * registro do sistema. Editá-lo faria o Financeiro e o documento de origem
 * discordarem sem que nada dissesse qual está certo, então a edição é
 * recusada. Confirmar e cancelar continuam permitidos: são atos financeiros
 * legítimos sobre um valor que existe.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { SlugHelper } from '../../helpers';
import {
  FinancialEntrySource,
  FinancialEntryStatus,
  FinancialEntryType,
} from '../../contracts';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from './financial.constants';
import type {
  CancelFinancialEntryDto,
  ConfirmFinancialEntryDto,
  CreateFinancialCategoryDto,
  CreateFinancialEntryDto,
  FinancialAnalyticsQueryDto,
  FinancialEntryQueryDto,
  UpdateFinancialCategoryDto,
  UpdateFinancialEntryDto,
  UpdateFinancialSettingsDto,
} from './financial.dto';
import { FinancialMapper } from './financial.mapper';
import type {
  FinancialCategoryBreakdownReadModel,
  FinancialSummaryReadModel,
  FinancialTimelinePointReadModel,
  FinancialTotalsReadModel,
} from './financial.read-models';
import {
  FinancialRepository,
  type AnalyticsScope,
  type FinancialEntryRecord,
} from './financial.repository';

/** Lançamento derivado de outro registro do sistema. */
export interface RecordFromSourceInput {
  organizationId: string;
  businessUnitId: string;
  source: string;
  sourceEntityId: string;
  amount: string;
  currency: string;
  description: string;
  competenceDate: Date;
  customerId?: string | null;
  operationId?: string | null;
  metadata?: Record<string, unknown>;
  actorId: string;
  /**
   * Sentido. `INCOME` por padrão — as duas origens automáticas de hoje,
   * recibo e orçamento, são dinheiro entrando.
   */
  type?: string;
  /**
   * Situação inicial.
   *
   * `CONFIRMED` por padrão, que é o caso do **recibo**: o documento comprova
   * dinheiro que já entrou. Um **orçamento aprovado** passa `PENDING` — é
   * expectativa, e tratá-la como caixa inflaria o realizado com trabalho que
   * ainda nem começou.
   */
  status?: string;
  /** Vencimento previsto, quando a origem o conhece. */
  dueDate?: Date | null;
}

@Injectable()
export class FinancialService {
  constructor(
    private readonly repository: FinancialRepository,
    private readonly mapper: FinancialMapper,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Configuração                                                      */
  /* ---------------------------------------------------------------- */

  settings(organizationId: string) {
    return this.repository.ensureSettings(organizationId);
  }

  /**
   * Altera a configuração.
   *
   * Desligar `autoRecordReceipts` **não apaga** os lançamentos já criados: eles
   * são fatos, e o recibo que os originou continua existindo. Religar **não
   * recupera** o período desligado — o gatilho é o evento de emissão, e eventos
   * passados não são reemitidos. Uma configuração que reescrevesse o histórico
   * dos dois lados faria o caixa depender de quando alguém mexeu no botão.
   */
  async updateSettings(
    organizationId: string,
    actorId: string,
    input: UpdateFinancialSettingsDto,
  ) {
    const current = await this.repository.ensureSettings(organizationId);
    if (
      input.defaultCurrency &&
      !SUPPORTED_CURRENCIES.includes(input.defaultCurrency)
    ) {
      throw new ValidationException('Unsupported currency');
    }
    return this.repository.updateSettings(
      organizationId,
      {
        autoRecordReceipts: input.autoRecordReceipts,
        defaultCurrency: input.defaultCurrency,
      },
      actorId,
      {
        autoRecordReceipts: current.autoRecordReceipts,
        defaultCurrency: current.defaultCurrency,
      },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Categorias                                                        */
  /* ---------------------------------------------------------------- */

  async listCategories(organizationId: string, type?: string) {
    await this.repository.ensureSettings(organizationId);
    return this.repository.listCategories(organizationId, type);
  }

  async createCategory(
    organizationId: string,
    input: CreateFinancialCategoryDto,
  ) {
    try {
      return await this.repository.createCategory({
        organizationId,
        type: input.type,
        name: input.name,
        slug: SlugHelper.create(input.name),
        description: input.description,
        color: input.color,
        sortOrder: input.sortOrder ?? 50,
      });
    } catch (error) {
      this.rethrowConflict(error, 'A category with this name already exists');
    }
  }

  async updateCategory(
    id: string,
    organizationId: string,
    input: UpdateFinancialCategoryDto,
  ) {
    await this.requireCategory(id, organizationId);
    try {
      return await this.repository.updateCategory(id, {
        name: input.name,
        description: input.description,
        color: input.color,
        sortOrder: input.sortOrder,
        ...(input.name ? { slug: SlugHelper.create(input.name) } : {}),
      });
    } catch (error) {
      this.rethrowConflict(error, 'A category with this name already exists');
    }
  }

  /**
   * Remove uma categoria.
   *
   * Recusa enquanto houver lançamento vivo usando-a: relatório de período
   * fechado deixaria de bater se a categoria sumisse por baixo dele. Categoria
   * do sistema não é removível — quem não a quer, some com ela da tela
   * renomeando; o que não pode é o padrão de outra organização desaparecer por
   * engano.
   */
  async removeCategory(id: string, organizationId: string): Promise<void> {
    const category = await this.requireCategory(id, organizationId);
    if (category.isSystem) {
      throw new ConflictException('System categories cannot be removed');
    }
    if (category._count.entries > 0) {
      throw new ConflictException('Category is still used by entries');
    }
    await this.repository.softDeleteCategory(id);
  }

  /* ---------------------------------------------------------------- */
  /* Lançamentos                                                       */
  /* ---------------------------------------------------------------- */

  /** `async` para que a recusa de filtro chegue como promessa rejeitada, e não como exceção síncrona no meio do controller. */
  async list(organizationId: string, query: FinancialEntryQueryDto) {
    if (
      query.overdue &&
      query.status &&
      query.status !== FinancialEntryStatus.PENDING
    ) {
      throw new ValidationException(
        'Overdue entries are pending by definition; drop the status filter',
      );
    }
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationException('The period starts after it ends');
    }
    return this.repository.list(organizationId, query);
  }

  async get(id: string, organizationId: string) {
    const entry = await this.repository.find(id, organizationId);
    if (!entry) throw new EntityNotFoundException('FinancialEntry', id);
    return entry;
  }

  async create(
    organizationId: string,
    fallbackBusinessUnitId: string | null,
    actorId: string,
    input: CreateFinancialEntryDto,
  ) {
    const businessUnitId = await this.resolveBusinessUnit(
      organizationId,
      input.businessUnitId ?? fallbackBusinessUnitId,
    );
    await this.validateReferences(
      organizationId,
      input.categoryId,
      input.type,
      input.customerId,
      input.operationId,
    );

    const status = input.status ?? FinancialEntryStatus.PENDING;
    const confirmed = status === FinancialEntryStatus.CONFIRMED;
    const currency = input.currency ?? DEFAULT_CURRENCY;
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new ValidationException('Unsupported currency');
    }

    return this.repository.create(
      {
        organizationId,
        businessUnitId,
        categoryId: input.categoryId ?? null,
        type: input.type,
        status,
        source: FinancialEntrySource.MANUAL,
        sourceEntityId: null,
        amount: input.amount.toFixed(2),
        currency,
        description: input.description,
        notes: input.notes ?? null,
        competenceDate: this.dateOnly(input.competenceDate ?? new Date()),
        dueDate: input.dueDate ? this.dateOnly(input.dueDate) : null,
        customerId: input.customerId ?? null,
        operationId: input.operationId ?? null,
        createdById: actorId,
        confirmedAt: confirmed ? new Date() : null,
        confirmedById: confirmed ? actorId : null,
      },
      actorId,
    );
  }

  /**
   * Edita um lançamento manual.
   *
   * Origem e identidade não estão em jogo: o DTO não os aceita, e lançamento
   * de origem automática é recusado inteiro. Cancelado também é recusado —
   * editar o que já não vale reabriria uma decisão que foi registrada com
   * motivo e autor.
   */
  async update(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateFinancialEntryDto,
  ) {
    const current = await this.get(id, organizationId);
    this.requireManual(current);
    if (current.status === FinancialEntryStatus.CANCELLED) {
      throw new ConflictException('Cancelled entries cannot be edited');
    }
    await this.validateReferences(
      organizationId,
      input.categoryId,
      current.type,
      input.customerId,
      input.operationId,
    );

    return this.repository.update(
      id,
      organizationId,
      current.businessUnit.id,
      {
        category:
          input.categoryId === undefined
            ? undefined
            : { connect: { id: input.categoryId } },
        amount:
          input.amount === undefined ? undefined : input.amount.toFixed(2),
        description: input.description,
        notes: input.notes,
        competenceDate: input.competenceDate
          ? this.dateOnly(input.competenceDate)
          : undefined,
        dueDate: input.dueDate ? this.dateOnly(input.dueDate) : undefined,
        customer:
          input.customerId === undefined
            ? undefined
            : { connect: { id: input.customerId } },
        operation:
          input.operationId === undefined
            ? undefined
            : { connect: { id: input.operationId } },
      },
      actorId,
      {
        amount: current.amount.toString(),
        description: current.description,
        competenceDate: current.competenceDate.toISOString(),
        dueDate: current.dueDate?.toISOString() ?? null,
        categoryId: current.category?.id ?? null,
      },
    );
  }

  /** Confirma o recebimento ou o pagamento. Só faz sentido a partir de `PENDING`. */
  async confirm(
    id: string,
    organizationId: string,
    actorId: string,
    input: ConfirmFinancialEntryDto,
  ) {
    const current = await this.get(id, organizationId);
    if (current.status !== FinancialEntryStatus.PENDING) {
      throw new ConflictException(
        `Only pending entries can be confirmed (current: ${current.status})`,
      );
    }
    return this.repository.update(
      id,
      organizationId,
      current.businessUnit.id,
      {
        status: FinancialEntryStatus.CONFIRMED,
        confirmedAt: input.confirmedAt ?? new Date(),
        confirmedBy: { connect: { id: actorId } },
      },
      actorId,
      { status: current.status },
      'FINANCIAL_ENTRY_CONFIRMED',
    );
  }

  /**
   * Cancela.
   *
   * **Não apaga.** O lançamento continua na base, com motivo, autor e data —
   * um valor que sumiu do caixa sem explicação é a pergunta que ninguém
   * responde três meses depois. Cancelar um lançamento de recibo é permitido:
   * o recibo pode ter sido estornado, e negar isso deixaria receita falsa no
   * caixa. O recibo emitido continua existindo, e o índice de origem impede
   * que ele gere um segundo lançamento.
   */
  async cancel(
    id: string,
    organizationId: string,
    actorId: string,
    input: CancelFinancialEntryDto,
  ) {
    const current = await this.get(id, organizationId);
    if (current.status === FinancialEntryStatus.CANCELLED) {
      throw new ConflictException('Entry is already cancelled');
    }
    return this.repository.update(
      id,
      organizationId,
      current.businessUnit.id,
      {
        status: FinancialEntryStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: { connect: { id: actorId } },
        cancelReason: input.reason,
      },
      actorId,
      { status: current.status, amount: current.amount.toString() },
      'FINANCIAL_ENTRY_CANCELLED',
    );
  }

  /* ---------------------------------------------------------------- */
  /* Origem automática                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Registra receita vinda de um documento emitido.
   *
   * Idempotente pelo banco: `createFromSource` devolve `null` quando o índice
   * único de origem já cobre este registro, e aqui isso é sucesso, não erro.
   * Repetição de job, retry após queda e emissão concorrente convergem para um
   * lançamento só.
   */
  async recordFromSource(input: RecordFromSourceInput) {
    const settings = await this.repository.ensureSettings(input.organizationId);
    const type = input.type ?? FinancialEntryType.INCOME;
    const status = input.status ?? FinancialEntryStatus.CONFIRMED;
    const categories = await this.repository.listCategories(
      input.organizationId,
      type,
    );
    /** Primeira categoria do lado correspondente — sugestão, não regra. */
    const category = categories[0]?.id ?? null;
    const confirmed = status === FinancialEntryStatus.CONFIRMED;

    const created = await this.repository.createFromSource(
      {
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        categoryId: category,
        type,
        status,
        source: input.source,
        sourceEntityId: input.sourceEntityId,
        amount: input.amount,
        currency: input.currency || settings.defaultCurrency,
        description: input.description,
        competenceDate: this.dateOnly(input.competenceDate),
        dueDate: input.dueDate ? this.dateOnly(input.dueDate) : null,
        customerId: input.customerId ?? null,
        operationId: input.operationId ?? null,
        metadata: input.metadata,
        createdById: input.actorId,
        /** Carimbo só existe quando de fato houve confirmação. */
        confirmedAt: confirmed ? new Date() : null,
        confirmedById: confirmed ? input.actorId : null,
      },
      input.actorId,
    );

    return created;
  }

  /**
   * Cancela o lançamento derivado de um registro, se existir e ainda valer.
   *
   * É a compensação de uma origem que deixou de valer — um orçamento aprovado
   * e depois cancelado. **Não apaga**: o lançamento permanece com motivo,
   * autor e data, porque a previsão existiu e alguém a viu. Devolve `null`
   * quando não há nada a cancelar, e isso é sucesso: repetir o evento não pode
   * falhar.
   */
  async cancelFromSource(input: {
    organizationId: string;
    source: string;
    sourceEntityId: string;
    reason: string;
    actorId: string;
  }) {
    const entry = await this.repository.findBySource(
      input.organizationId,
      input.source,
      input.sourceEntityId,
    );
    if (!entry || entry.status === FinancialEntryStatus.CANCELLED) return null;

    return this.repository.update(
      entry.id,
      input.organizationId,
      entry.businessUnit.id,
      {
        status: FinancialEntryStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: { connect: { id: input.actorId } },
        cancelReason: input.reason,
      },
      input.actorId,
      { status: entry.status, amount: entry.amount.toString() },
      'FINANCIAL_ENTRY_CANCELLED',
    );
  }

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Resumo do período.
   *
   * Realizado e previsto saem **separados**, e não existe campo que os some.
   * Um "saldo" que misturasse `CONFIRMED` com `PENDING` pareceria caixa e não
   * seria: a diferença entre os dois é justamente o que ainda pode não
   * acontecer.
   */
  async summary(
    organizationId: string,
    query: FinancialAnalyticsQueryDto,
  ): Promise<FinancialSummaryReadModel> {
    const scope = this.scope(organizationId, query);
    const settings = await this.repository.ensureSettings(organizationId);
    const [totals, overdue] = await Promise.all([
      this.repository.totals(scope),
      this.repository.overdue(scope, this.dateOnly(new Date())),
    ]);

    const bucket = (type: string): FinancialTotalsReadModel => {
      const rows = totals.filter((row) => row.type === type);
      const at = (status: string) =>
        this.mapper.money(
          rows.find((row) => row.status === status)?._sum.amount ?? 0,
        );
      return {
        confirmed: at(FinancialEntryStatus.CONFIRMED),
        pending: at(FinancialEntryStatus.PENDING),
        cancelled: at(FinancialEntryStatus.CANCELLED),
        count: rows.reduce((total, row) => total + row._count._all, 0),
      };
    };

    const income = bucket(FinancialEntryType.INCOME);
    const expense = bucket(FinancialEntryType.EXPENSE);
    const late = (type?: string): FinancialTotalsReadModel => {
      const rows = overdue.filter((row) => !type || row.type === type);
      return {
        confirmed: '0.00',
        pending: this.mapper.money(
          rows.reduce(
            (total, row) => total.plus(row._sum.amount ?? 0),
            new Prisma.Decimal(0),
          ),
        ),
        cancelled: '0.00',
        count: rows.reduce((total, row) => total + row._count._all, 0),
      };
    };

    return {
      period: {
        from: this.mapper.day(scope.from),
        to: this.mapper.day(scope.to),
      },
      currency: settings.defaultCurrency,
      income,
      expense,
      netConfirmed: this.subtract(income.confirmed, expense.confirmed),
      netPending: this.subtract(income.pending, expense.pending),
      overdue: late(),
      overdueIncome: late(FinancialEntryType.INCOME),
      overdueExpense: late(FinancialEntryType.EXPENSE),
    };
  }

  async byCategory(
    organizationId: string,
    query: FinancialAnalyticsQueryDto,
  ): Promise<FinancialCategoryBreakdownReadModel[]> {
    const scope = this.scope(organizationId, query);
    const { grouped, categories } = await this.repository.byCategory(scope);
    const names = new Map(categories.map((row) => [row.id, row]));

    const merged = new Map<string, FinancialCategoryBreakdownReadModel>();
    for (const row of grouped) {
      const key = `${row.categoryId ?? 'none'}:${row.type}`;
      const known = row.categoryId ? names.get(row.categoryId) : undefined;
      const current =
        merged.get(key) ??
        ({
          categoryId: row.categoryId,
          categoryName: known?.name ?? 'Sem categoria',
          color: known?.color ?? null,
          type: row.type,
          confirmed: '0.00',
          pending: '0.00',
          count: 0,
        } satisfies FinancialCategoryBreakdownReadModel);

      const amount = this.mapper.money(row._sum.amount ?? 0);
      merged.set(key, {
        ...current,
        confirmed:
          row.status === FinancialEntryStatus.CONFIRMED
            ? this.add(current.confirmed, amount)
            : current.confirmed,
        pending:
          row.status === FinancialEntryStatus.PENDING
            ? this.add(current.pending, amount)
            : current.pending,
        count: current.count + row._count._all,
      });
    }

    return [...merged.values()].sort(
      (a, b) => Number(b.confirmed) - Number(a.confirmed),
    );
  }

  async timeline(
    organizationId: string,
    query: FinancialAnalyticsQueryDto,
  ): Promise<FinancialTimelinePointReadModel[]> {
    const scope = this.scope(organizationId, query);
    const daily = query.granularity === 'DAY';
    const rows = await this.repository.timeline(scope, daily ? 'DAY' : 'MONTH');

    const months = new Map<string, FinancialTimelinePointReadModel>();
    for (const row of rows) {
      const day = this.mapper.day(row.month);
      const period = daily ? day : day.slice(0, 7);
      const month = day.slice(0, 7);
      const current =
        months.get(period) ??
        ({
          period,
          month,
          incomeConfirmed: '0.00',
          incomePending: '0.00',
          expenseConfirmed: '0.00',
          expensePending: '0.00',
          netConfirmed: '0.00',
        } satisfies FinancialTimelinePointReadModel);

      const amount = this.mapper.money(row.total);
      const income = row.type === FinancialEntryType.INCOME;
      const confirmed = row.status === FinancialEntryStatus.CONFIRMED;

      const next: FinancialTimelinePointReadModel = {
        ...current,
        incomeConfirmed:
          income && confirmed
            ? this.add(current.incomeConfirmed, amount)
            : current.incomeConfirmed,
        incomePending:
          income && !confirmed
            ? this.add(current.incomePending, amount)
            : current.incomePending,
        expenseConfirmed:
          !income && confirmed
            ? this.add(current.expenseConfirmed, amount)
            : current.expenseConfirmed,
        expensePending:
          !income && !confirmed
            ? this.add(current.expensePending, amount)
            : current.expensePending,
        netConfirmed: current.netConfirmed,
      };

      months.set(period, {
        ...next,
        netConfirmed: this.subtract(
          next.incomeConfirmed,
          next.expenseConfirmed,
        ),
      });
    }

    return [...months.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private scope(
    organizationId: string,
    query: FinancialAnalyticsQueryDto,
  ): AnalyticsScope {
    const now = new Date();
    const from =
      query.from ??
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to =
      query.to ??
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    if (from > to) {
      throw new ValidationException('The period starts after it ends');
    }
    return {
      organizationId,
      businessUnitId: query.businessUnitId,
      from: this.dateOnly(from),
      to: this.dateOnly(to),
    };
  }

  private async resolveBusinessUnit(
    organizationId: string,
    candidate: string | null | undefined,
  ): Promise<string> {
    if (!candidate) {
      throw new ValidationException(
        'A business unit is required: money is counted per unit',
      );
    }
    const unit = await this.repository.findBusinessUnit(
      candidate,
      organizationId,
    );
    if (!unit) throw new EntityNotFoundException('BusinessUnit', candidate);
    return unit.id;
  }

  /**
   * Confere referências.
   *
   * A categoria precisa ser do **mesmo lado** do lançamento: uma despesa
   * categorizada como receita produziria um relatório que soma o que não deve.
   */
  private async validateReferences(
    organizationId: string,
    categoryId: string | undefined,
    type: string,
    customerId: string | undefined,
    operationId: string | undefined,
  ): Promise<void> {
    if (categoryId) {
      const category = await this.repository.findCategory(
        categoryId,
        organizationId,
      );
      if (!category) {
        throw new EntityNotFoundException('FinancialCategory', categoryId);
      }
      if (category.type !== type) {
        throw new ValidationException(
          `Category belongs to ${category.type}, not ${type}`,
        );
      }
    }
    if (customerId) {
      const customer = await this.repository.findCustomer(
        customerId,
        organizationId,
      );
      if (!customer) throw new EntityNotFoundException('Customer', customerId);
    }
    if (operationId) {
      const operation = await this.repository.findOperation(
        operationId,
        organizationId,
      );
      if (!operation) {
        throw new EntityNotFoundException('Operation', operationId);
      }
    }
  }

  private async requireCategory(id: string, organizationId: string) {
    const category = await this.repository.findCategory(id, organizationId);
    if (!category) throw new EntityNotFoundException('FinancialCategory', id);
    return category;
  }

  private requireManual(entry: FinancialEntryRecord): void {
    if (entry.source !== FinancialEntrySource.MANUAL) {
      throw new ConflictException(
        `Entries created from ${entry.source} cannot be edited; cancel them instead`,
      );
    }
  }

  /** Meia-noite UTC: a coluna é `DATE`, e hora só criaria diferença por fuso. */
  private dateOnly(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  /** Soma em centavos, para não somar float. */
  private add(left: string, right: string): string {
    return ((this.cents(left) + this.cents(right)) / 100).toFixed(2);
  }

  private subtract(left: string, right: string): string {
    return ((this.cents(left) - this.cents(right)) / 100).toFixed(2);
  }

  private cents(value: string): number {
    return Math.round(Number(value) * 100);
  }

  private rethrowConflict(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
    throw error;
  }
}
