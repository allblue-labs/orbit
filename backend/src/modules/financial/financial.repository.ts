/**
 * Persistência do Financeiro.
 *
 * ## Nada sai daqui sem passar pela RLS
 *
 * Toda leitura e escrita roda em `RlsTransaction`. A política de
 * `financial_entries` exige organização **e** unidade: um `where` esquecido no
 * TypeScript não abre o caixa de outra filial, porque o Postgres não devolve a
 * linha.
 *
 * ## Auditoria na mesma transação
 *
 * Confirmar, cancelar e editar gravam `AuditLog` junto com a mudança. Um
 * registro financeiro alterado sem rastro é exatamente o que ninguém consegue
 * explicar em uma conferência de caixa.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationHelper, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import type { FinancialEntryQueryDto } from './financial.dto';
import { DEFAULT_CATEGORIES } from './financial.constants';

const actor = { select: { id: true, displayName: true } } as const;

const categoryView = {
  id: true,
  type: true,
  name: true,
  slug: true,
  description: true,
  color: true,
  isSystem: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { entries: { where: { deletedAt: null } } } },
} satisfies Prisma.FinancialCategorySelect;

const entryView = {
  id: true,
  type: true,
  status: true,
  source: true,
  sourceEntityId: true,
  amount: true,
  currency: true,
  description: true,
  notes: true,
  competenceDate: true,
  dueDate: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true, color: true } },
  businessUnit: { select: { id: true, legalName: true, tradeName: true } },
  customer: { select: { id: true, legalName: true, tradeName: true } },
  operation: { select: { id: true, code: true, title: true } },
  createdBy: actor,
  confirmedBy: actor,
  cancelledBy: actor,
} satisfies Prisma.FinancialEntrySelect;

export type FinancialEntryRecord = Prisma.FinancialEntryGetPayload<{
  select: typeof entryView;
}>;

export type FinancialCategoryRecord = Prisma.FinancialCategoryGetPayload<{
  select: typeof categoryView;
}>;

export interface CreateEntryData {
  organizationId: string;
  businessUnitId: string;
  categoryId?: string | null;
  type: string;
  status: string;
  source: string;
  sourceEntityId?: string | null;
  amount: string;
  currency: string;
  description: string;
  notes?: string | null;
  competenceDate: Date;
  dueDate?: Date | null;
  customerId?: string | null;
  operationId?: string | null;
  metadata?: Record<string, unknown>;
  createdById: string;
  confirmedAt?: Date | null;
  confirmedById?: string | null;
}

export interface AnalyticsScope {
  organizationId: string;
  businessUnitId?: string;
  from: Date;
  to: Date;
}

@Injectable()
export class FinancialRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /* ---------------------------------------------------------------- */
  /* Configuração                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Devolve a configuração, criando-a na primeira visita.
   *
   * Preguiçosa de propósito: o cadastro de organização não conhece o
   * Financeiro, e acrescentar uma escrita lá para um módulo que a organização
   * pode nunca abrir acopla dois domínios sem necessidade. `upsert` torna a
   * primeira visita idempotente mesmo sob concorrência.
   */
  ensureSettings(organizationId: string) {
    return this.rls.run(async (tx) => {
      const settings = await tx.financialSettings.upsert({
        where: { organizationId },
        update: {},
        create: { id: generateUuidV7(), organizationId },
      });
      await this.seedCategories(tx, organizationId);
      return settings;
    });
  }

  updateSettings(
    organizationId: string,
    data: Prisma.FinancialSettingsUpdateInput,
    actorId: string,
    before: Record<string, unknown>,
  ) {
    return this.rls.run(async (tx) => {
      const settings = await tx.financialSettings.update({
        where: { organizationId },
        data,
      });
      await this.audit(
        tx,
        organizationId,
        null,
        actorId,
        'FINANCIAL_SETTINGS_UPDATED',
        'FINANCIAL_SETTINGS',
        settings.id,
        before,
        {
          autoRecordReceipts: settings.autoRecordReceipts,
          defaultCurrency: settings.defaultCurrency,
        },
      );
      return settings;
    });
  }

  /**
   * Semeia as categorias padrão.
   *
   * `skipDuplicates` sobre a unicidade `(organização, tipo, slug)`: rodar de
   * novo não duplica nada, e uma categoria que a organização apagou **não
   * volta** — o soft delete mantém a linha, então a chave continua ocupada.
   * Ressuscitar o que alguém removeu de propósito seria desfazer uma decisão.
   */
  private async seedCategories(
    tx: PrismaTransactionClient,
    organizationId: string,
  ): Promise<void> {
    await tx.financialCategory.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({
        id: generateUuidV7(),
        organizationId,
        type: category.type,
        name: category.name,
        slug: category.slug,
        color: category.color,
        sortOrder: category.sortOrder,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Categorias                                                        */
  /* ---------------------------------------------------------------- */

  listCategories(organizationId: string, type?: string) {
    return this.rls.run((tx) =>
      tx.financialCategory.findMany({
        where: { organizationId, type, deletedAt: null },
        select: categoryView,
        orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  findCategory(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.financialCategory.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: categoryView,
      }),
    );
  }

  createCategory(data: Prisma.FinancialCategoryUncheckedCreateInput) {
    return this.rls.run((tx) =>
      tx.financialCategory.create({
        data: { id: generateUuidV7(), ...data },
        select: categoryView,
      }),
    );
  }

  updateCategory(id: string, data: Prisma.FinancialCategoryUpdateInput) {
    return this.rls.run((tx) =>
      tx.financialCategory.update({
        where: { id },
        data,
        select: categoryView,
      }),
    );
  }

  softDeleteCategory(id: string): Promise<void> {
    return this.rls
      .run((tx) =>
        tx.financialCategory.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* Lançamentos                                                       */
  /* ---------------------------------------------------------------- */

  list(organizationId: string, query: FinancialEntryQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where = this.entryWhere(organizationId, query);

    return this.rls.run(async (tx) => {
      const data = await tx.financialEntry.findMany({
        where,
        select: entryView,
        orderBy: [{ competenceDate: 'desc' }, { id: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.financialEntry.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.financialEntry.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: entryView,
      }),
    );
  }

  create(data: CreateEntryData, actorId: string) {
    return this.rls.run(async (tx) => {
      const entry = await tx.financialEntry.create({
        data: {
          id: generateUuidV7(),
          ...data,
          metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        },
        select: entryView,
      });
      await this.audit(
        tx,
        data.organizationId,
        data.businessUnitId,
        actorId,
        'FINANCIAL_ENTRY_CREATED',
        'FINANCIAL_ENTRY',
        entry.id,
        null,
        {
          type: entry.type,
          status: entry.status,
          source: entry.source,
          amount: entry.amount.toString(),
          currency: entry.currency,
        },
      );
      return entry;
    });
  }

  update(
    id: string,
    organizationId: string,
    businessUnitId: string,
    data: Prisma.FinancialEntryUpdateInput,
    actorId: string,
    before: Record<string, unknown>,
    action = 'FINANCIAL_ENTRY_UPDATED',
  ) {
    return this.rls.run(async (tx) => {
      const entry = await tx.financialEntry.update({
        where: { id },
        data,
        select: entryView,
      });
      await this.audit(
        tx,
        organizationId,
        businessUnitId,
        actorId,
        action,
        'FINANCIAL_ENTRY',
        entry.id,
        before,
        {
          status: entry.status,
          amount: entry.amount.toString(),
          competenceDate: entry.competenceDate.toISOString(),
          categoryId: entry.category?.id ?? null,
          cancelReason: entry.cancelReason,
        },
      );
      return entry;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Origem automática                                                 */
  /* ---------------------------------------------------------------- */

  /** O lançamento já gerado por este registro de origem, se existir. */
  findBySource(organizationId: string, source: string, sourceEntityId: string) {
    return this.rls.run((tx) =>
      tx.financialEntry.findFirst({
        where: { organizationId, source, sourceEntityId },
        select: entryView,
      }),
    );
  }

  /**
   * Cria o lançamento derivado, ou desiste em silêncio se já existir.
   *
   * `ON CONFLICT DO NOTHING` sobre o índice único parcial de origem: duas
   * tentativas simultâneas do mesmo recibo produzem **um** lançamento, e a
   * segunda não levanta erro nem aborta a transação. É a idempotência exigida,
   * decidida pelo banco — nenhuma checagem prévia no serviço poderia garanti-la
   * sob concorrência.
   *
   * Devolve `null` quando nada foi inserido. Quem chamou entende isso como
   * "outro já fez", que é o resultado certo.
   */
  createFromSource(data: CreateEntryData, actorId: string) {
    return this.rls.run(async (tx) => {
      const id = generateUuidV7();
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO financial_entries (
          id, organization_id, business_unit_id, category_id, type, status,
          source, source_entity_id, amount, currency, description, notes,
          competence_date, due_date, confirmed_at, confirmed_by_id,
          customer_id, operation_id, metadata, created_by_id, updated_at
        ) VALUES (
          ${id}::uuid,
          ${data.organizationId}::uuid,
          ${data.businessUnitId}::uuid,
          ${data.categoryId ?? null}::uuid,
          ${data.type},
          ${data.status},
          ${data.source},
          ${data.sourceEntityId ?? null}::uuid,
          ${data.amount}::decimal,
          ${data.currency},
          ${data.description},
          ${data.notes ?? null},
          ${data.competenceDate}::date,
          ${data.dueDate ?? null}::date,
          ${data.confirmedAt ?? null}::timestamptz,
          ${data.confirmedById ?? null}::uuid,
          ${data.customerId ?? null}::uuid,
          ${data.operationId ?? null}::uuid,
          ${JSON.stringify(data.metadata ?? {})}::jsonb,
          ${data.createdById}::uuid,
          now()
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;

      if (!inserted[0]) return null;

      const entry = await tx.financialEntry.findFirstOrThrow({
        where: { id },
        select: entryView,
      });

      await this.audit(
        tx,
        data.organizationId,
        data.businessUnitId,
        actorId,
        'FINANCIAL_ENTRY_CREATED',
        'FINANCIAL_ENTRY',
        entry.id,
        null,
        {
          source: entry.source,
          sourceEntityId: entry.sourceEntityId,
          amount: entry.amount.toString(),
          currency: entry.currency,
          status: entry.status,
        },
      );

      return entry;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  /** Totais por tipo e situação no recorte. */
  totals(scope: AnalyticsScope) {
    return this.rls.run((tx) =>
      tx.financialEntry.groupBy({
        by: ['type', 'status'],
        where: this.scopeWhere(scope),
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );
  }

  /**
   * Vencidos: `PENDING` com vencimento anterior a hoje, no recorte — por tipo.
   * Receita vencida é dinheiro a cobrar; despesa vencida, conta atrasada.
   * Somar as duas num número só não dizia nenhuma das coisas.
   */
  overdue(scope: AnalyticsScope, reference: Date) {
    return this.rls.run((tx) =>
      tx.financialEntry.groupBy({
        by: ['type'],
        where: {
          ...this.scopeWhere(scope),
          status: 'PENDING',
          dueDate: { lt: reference },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );
  }

  byCategory(scope: AnalyticsScope) {
    return this.rls.run(async (tx) => {
      const grouped = await tx.financialEntry.groupBy({
        by: ['categoryId', 'type', 'status'],
        where: { ...this.scopeWhere(scope), status: { not: 'CANCELLED' } },
        _sum: { amount: true },
        _count: { _all: true },
      });
      const categories = await tx.financialCategory.findMany({
        where: { organizationId: scope.organizationId },
        select: { id: true, name: true, color: true },
      });
      return { grouped, categories };
    });
  }

  /**
   * Série mensal.
   *
   * `date_trunc` no banco: agrupar mês em JavaScript exigiria trazer todos os
   * lançamentos do período para a memória do processo, e um ano de operação
   * são milhares de linhas para produzir doze números.
   */
  timeline(scope: AnalyticsScope, granularity: 'DAY' | 'MONTH' = 'MONTH') {
    const unit = granularity === 'DAY' ? 'day' : 'month';
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<
          {
            month: Date;
            type: string;
            status: string;
            total: Prisma.Decimal;
          }[]
        >`
        SELECT date_trunc(${unit}, competence_date)::date AS month,
               type,
               status,
               SUM(amount) AS total
          FROM financial_entries
         WHERE organization_id = ${scope.organizationId}::uuid
           AND deleted_at IS NULL
           AND competence_date >= ${scope.from}::date
           AND competence_date <= ${scope.to}::date
           AND status <> 'CANCELLED'
           ${
             scope.businessUnitId
               ? Prisma.sql`AND business_unit_id = ${scope.businessUnitId}::uuid`
               : Prisma.empty
           }
         GROUP BY 1, 2, 3
         ORDER BY 1 ASC
      `,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Referências                                                       */
  /* ---------------------------------------------------------------- */

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.customer.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  findOperation(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, businessUnitId: true },
      }),
    );
  }

  /**
   * O documento emitido, do ponto de vista do Financeiro.
   *
   * Leitura direta das tabelas do Document Center — na direção certa: o
   * consumidor conhece o produtor, e o produtor não sabe que existe
   * Financeiro. Publicar um método com forma financeira no serviço de
   * documentos inverteria isso.
   *
   * Traz só o necessário para decidir se há dinheiro aqui: o tipo do artefato,
   * o contexto da execução e as respostas — de onde sai o valor.
   */
  findIssuedDocument(manifestId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.artifactManifest.findFirst({
        where: { id: manifestId, organizationId, deletedAt: null },
        select: {
          id: true,
          status: true,
          issuedAt: true,
          issuedById: true,
          businessUnitId: true,
          snapshot: { select: { artifactType: true, templateName: true } },
          execution: {
            select: {
              id: true,
              code: true,
              title: true,
              customerId: true,
              operationId: true,
              businessUnitId: true,
              responses: {
                select: {
                  sectionId: true,
                  fieldId: true,
                  value: true,
                  valueType: true,
                  unit: true,
                },
              },
            },
          },
        },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private entryWhere(
    organizationId: string,
    query: FinancialEntryQueryDto,
  ): Prisma.FinancialEntryWhereInput {
    const competence =
      query.from || query.to ? { gte: query.from, lte: query.to } : undefined;

    return {
      organizationId,
      deletedAt: null,
      type: query.type,
      status: query.status,
      source: query.source,
      sourceEntityId: query.sourceEntityId,
      categoryId: query.categoryId,
      businessUnitId: query.businessUnitId,
      customerId: query.customerId,
      operationId: query.operationId,
      competenceDate: competence,
      ...(query.overdue
        ? { status: 'PENDING', dueDate: { lt: this.today() } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private scopeWhere(scope: AnalyticsScope): Prisma.FinancialEntryWhereInput {
    return {
      organizationId: scope.organizationId,
      businessUnitId: scope.businessUnitId,
      deletedAt: null,
      competenceDate: { gte: scope.from, lte: scope.to },
    };
  }

  /** Hoje à meia-noite UTC — a granularidade de uma coluna `DATE`. */
  private today(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private audit(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string | null,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        businessUnitId,
        userId: actorId,
        action,
        entityType,
        entityId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
