/**
 * Persistência do Inventory Engine.
 *
 * ## O invariante que este arquivo existe para proteger
 *
 * Saldo negativo é impossível, e duas saídas simultâneas não consomem o mesmo
 * estoque. A garantia **não** é uma leitura seguida de uma escrita — entre as
 * duas cabe outra transação, e é exatamente aí que estoque vira negativo em
 * sistemas que "checam antes".
 *
 * A garantia é uma instrução só:
 *
 * ```sql
 * UPDATE inventory_balances
 *    SET on_hand = on_hand - $qtd
 *  WHERE business_unit_id = $u AND catalog_item_id = $i
 *    AND on_hand - reserved >= $qtd
 * RETURNING on_hand
 * ```
 *
 * O predicado é avaliado **sob o bloqueio de linha** que o próprio `UPDATE`
 * adquire. Duas saídas concorrentes serializam: a segunda vê o saldo já
 * descontado e, se não couber, afeta zero linhas — e zero linhas é a recusa.
 * O `CHECK on_hand >= 0` da tabela é a última linha de defesa, para qualquer
 * caminho que venha a escrever ali.
 *
 * ## Movimento e saldo, sempre juntos
 *
 * As duas escritas acontecem na mesma transação RLS. `balanceAfter` vem do
 * `RETURNING` da atualização do saldo: o livro guarda o resultado que a
 * projeção passou a ter, e não uma conta refeita depois.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationHelper, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { DomainEventEmitter } from '../automations/domain-event.emitter';
import type {
  InventoryAnalyticsQueryDto,
  InventoryBalanceQueryDto,
  InventoryMovementQueryDto,
} from './inventory.dto';

const itemView = {
  id: true,
  name: true,
  sku: true,
  unit: true,
  kind: true,
} as const;

const unitView = { id: true, legalName: true, tradeName: true } as const;

const movementView = {
  id: true,
  type: true,
  quantity: true,
  balanceAfter: true,
  reason: true,
  notes: true,
  source: true,
  sourceEntityId: true,
  transferId: true,
  counterpartUnitId: true,
  createdAt: true,
  catalogItem: { select: itemView },
  businessUnit: { select: unitView },
  operation: { select: { id: true, code: true, title: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.InventoryMovementSelect;

const balanceView = {
  id: true,
  onHand: true,
  reserved: true,
  minimumStock: true,
  lastMovementAt: true,
  updatedAt: true,
  catalogItem: { select: itemView },
  businessUnit: { select: unitView },
} satisfies Prisma.InventoryBalanceSelect;

export type MovementRecord = Prisma.InventoryMovementGetPayload<{
  select: typeof movementView;
}>;
export type BalanceRecord = Prisma.InventoryBalanceGetPayload<{
  select: typeof balanceView;
}>;

/** Tipos que somam ao saldo. Os demais subtraem. */
const INBOUND: readonly string[] = [
  'ENTRY',
  'RETURN',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
];

export const isInbound = (type: string): boolean => INBOUND.includes(type);

export interface MovementInput {
  organizationId: string;
  businessUnitId: string;
  catalogItemId: string;
  type: string;
  /** Decimal com três casas, em string. */
  quantity: string;
  reason?: string | null;
  notes?: string | null;
  operationId?: string | null;
  source: string;
  sourceEntityId?: string | null;
  transferId?: string | null;
  counterpartUnitId?: string | null;
  createdById: string;
}

/** Recusa de saída: o saldo não cobre a quantidade pedida. */
export class InsufficientStock extends Error {
  constructor(readonly available: string) {
    super('insufficient stock');
  }
}

@Injectable()
export class InventoryRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly events: DomainEventEmitter,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Escrita — o ledger                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Registra um movimento e atualiza o saldo, atomicamente.
   *
   * Devolve `null` quando a origem já produziu este movimento — repetição de
   * retry, não erro. A unicidade é do banco: índice parcial em
   * `(organização, origem, id de origem, item)`.
   */
  record(input: MovementInput) {
    return this.rls.run((tx) => this.write(tx, input));
  }

  /**
   * As duas pontas de uma transferência, na mesma transação.
   *
   * Não existe meia transferência: se a saída não couber no saldo de origem, a
   * exceção desfaz a entrada junto. A política de RLS exige que **as duas**
   * unidades estejam no escopo da sessão — a inserção do lado de destino passa
   * pelo `WITH CHECK` daquela unidade.
   */
  transfer(input: {
    organizationId: string;
    catalogItemId: string;
    fromBusinessUnitId: string;
    toBusinessUnitId: string;
    quantity: string;
    reason?: string | null;
    notes?: string | null;
    sourceEntityId?: string | null;
    createdById: string;
  }) {
    return this.rls.run(async (tx) => {
      const transferId = generateUuidV7();
      const common = {
        organizationId: input.organizationId,
        catalogItemId: input.catalogItemId,
        quantity: input.quantity,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        source: input.sourceEntityId ? 'SYSTEM' : 'MANUAL',
        sourceEntityId: input.sourceEntityId ?? null,
        transferId,
        createdById: input.createdById,
      };

      /**
       * A saída primeiro.
       *
       * Se o saldo não cobrir, a exceção sobe antes de a entrada existir — e
       * o rollback cuidaria dela de qualquer forma. Fazer a entrada primeiro
       * criaria estoque do nada por um instante dentro da transação, o que
       * confundiria qualquer leitura que rodasse no mesmo escopo.
       */
      const out = await this.write(tx, {
        ...common,
        businessUnitId: input.fromBusinessUnitId,
        counterpartUnitId: input.toBusinessUnitId,
        type: 'TRANSFER_OUT',
      });
      if (!out) return null;

      const into = await this.write(tx, {
        ...common,
        businessUnitId: input.toBusinessUnitId,
        counterpartUnitId: input.fromBusinessUnitId,
        type: 'TRANSFER_IN',
      });
      if (!into) return null;

      await this.audit(
        tx,
        input.organizationId,
        input.fromBusinessUnitId,
        input.createdById,
        'INVENTORY_TRANSFERRED',
        transferId,
        null,
        {
          catalogItemId: input.catalogItemId,
          quantity: input.quantity,
          from: input.fromBusinessUnitId,
          to: input.toBusinessUnitId,
        },
      );

      return { transferId, out, in: into };
    });
  }

  /**
   * O núcleo: saldo primeiro, movimento depois.
   *
   * A ordem importa. O saldo é quem recusa — e recusa **atomicamente**; só
   * depois de ele ceder é que o movimento é gravado, já sabendo o resultado.
   */
  private async write(
    tx: PrismaTransactionClient,
    input: MovementInput,
  ): Promise<MovementRecord | null> {
    if (input.sourceEntityId && input.source !== 'MANUAL') {
      const existing = await tx.inventoryMovement.findFirst({
        where: {
          organizationId: input.organizationId,
          source: input.source,
          sourceEntityId: input.sourceEntityId,
          catalogItemId: input.catalogItemId,
        },
        select: { id: true },
      });
      if (existing) return null;
    }

    const balanceAfter = isInbound(input.type)
      ? await this.increase(tx, input)
      : await this.decrease(tx, input);

    const movement = await tx.inventoryMovement.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        catalogItemId: input.catalogItemId,
        type: input.type,
        quantity: input.quantity,
        balanceAfter,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        operationId: input.operationId ?? null,
        source: input.source,
        sourceEntityId: input.sourceEntityId ?? null,
        transferId: input.transferId ?? null,
        counterpartUnitId: input.counterpartUnitId ?? null,
        createdById: input.createdById,
      },
      select: movementView,
    });

    await this.audit(
      tx,
      input.organizationId,
      input.businessUnitId,
      input.createdById,
      `INVENTORY_${input.type}`,
      movement.id,
      null,
      {
        catalogItemId: input.catalogItemId,
        quantity: input.quantity,
        balanceAfter,
        operationId: input.operationId ?? null,
      },
    );

    if (input.operationId) {
      await tx.operationHistory.create({
        data: {
          operationId: input.operationId,
          userId: input.createdById,
          action: 'FIELD_MATERIAL_REGISTERED',
          details: {
            movementId: movement.id,
            catalogItemId: input.catalogItemId,
            quantity: input.quantity,
            balanceAfter,
            sourceEntityId: input.sourceEntityId ?? null,
          },
        },
      });
    }

    /**
     * Estoque baixo é um evento de **cruzamento**, não de estado.
     *
     * Só é publicado depois de uma saída que deixou o saldo no mínimo ou
     * abaixo. Publicá-lo a cada leitura de um item já baixo encheria a fila de
     * eventos idênticos; publicá-lo na entrada seria anunciar escassez logo
     * depois de repor. O que interessa é o momento em que passou a faltar.
     */
    if (!isInbound(input.type)) {
      await this.emitLowStock(tx, input, balanceAfter);
    }

    return movement;
  }

  /**
   * Publica `inventory.low_stock` quando a saída cruzou o mínimo.
   *
   * O estado vem do banco, não de uma comparação aqui: é o mesmo critério do
   * Read Model — zerado é sempre baixo; com mínimo definido, saldo menor ou
   * igual também. Duplicar a régua faria a automação discordar da tela.
   */
  private async emitLowStock(
    tx: PrismaTransactionClient,
    input: MovementInput,
    balanceAfter: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string; kind: string }[]>`
      SELECT CASE
               WHEN b.on_hand <= 0 THEN 'OUT_OF_STOCK'
               WHEN b.minimum_stock > 0 AND b.on_hand <= b.minimum_stock THEN 'LOW'
               ELSE 'OK'
             END AS status,
             p.kind AS kind
        FROM inventory_balances b
        JOIN products p ON p.id = b.catalog_item_id
       WHERE b.business_unit_id = ${input.businessUnitId}::uuid
         AND b.catalog_item_id = ${input.catalogItemId}::uuid
    `;

    const state = rows[0];
    if (!state || state.status === 'OK') return;

    await this.events.emit(tx, {
      type: 'inventory.low_stock',
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      actorId: input.createdById,
      entityType: 'INVENTORY_BALANCE',
      entityId: input.catalogItemId,
      payload: {
        catalogItemId: input.catalogItemId,
        businessUnitId: input.businessUnitId,
        status: state.status,
        kind: state.kind,
        balanceAfter,
      },
    });
  }

  /**
   * Entrada: cria o saldo se ainda não existir.
   *
   * `ON CONFLICT DO UPDATE` sobre a unicidade `(unidade, item)`: duas entradas
   * simultâneas do mesmo item não criam duas linhas de saldo, e a segunda soma
   * sobre o resultado da primeira.
   */
  private async increase(
    tx: PrismaTransactionClient,
    input: MovementInput,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
      INSERT INTO inventory_balances (
        id, organization_id, business_unit_id, catalog_item_id,
        on_hand, last_movement_at, updated_at
      ) VALUES (
        ${generateUuidV7()}::uuid,
        ${input.organizationId}::uuid,
        ${input.businessUnitId}::uuid,
        ${input.catalogItemId}::uuid,
        ${input.quantity}::decimal,
        now(),
        now()
      )
      ON CONFLICT (business_unit_id, catalog_item_id) DO UPDATE
        SET on_hand = inventory_balances.on_hand + ${input.quantity}::decimal,
            last_movement_at = now(),
            updated_at = now()
      RETURNING on_hand
    `;
    return (rows[0]?.on_hand ?? 0).toString();
  }

  /**
   * Saída: desconta **se couber**, numa instrução.
   *
   * `on_hand - reserved >= quantidade` é o predicado que impede o negativo e
   * resolve a concorrência ao mesmo tempo. Zero linhas afetadas significa
   * "não cabe" — e aí o saldo atual é lido só para dizer quanto havia, o que
   * é informação de erro, não decisão.
   */
  private async decrease(
    tx: PrismaTransactionClient,
    input: MovementInput,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
      UPDATE inventory_balances
         SET on_hand = on_hand - ${input.quantity}::decimal,
             last_movement_at = now(),
             updated_at = now()
       WHERE business_unit_id = ${input.businessUnitId}::uuid
         AND catalog_item_id = ${input.catalogItemId}::uuid
         AND on_hand - reserved >= ${input.quantity}::decimal
      RETURNING on_hand
    `;

    const updated = rows[0];
    if (!updated) {
      const current = await tx.inventoryBalance.findFirst({
        where: {
          businessUnitId: input.businessUnitId,
          catalogItemId: input.catalogItemId,
        },
        select: { onHand: true, reserved: true },
      });
      const available = current
        ? Number(current.onHand) - Number(current.reserved)
        : 0;
      throw new InsufficientStock(available.toFixed(3));
    }

    return updated.on_hand.toString();
  }

  /* ---------------------------------------------------------------- */
  /* Estoque mínimo                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Define o mínimo do par item + unidade.
   *
   * Cria a linha de saldo com `on_hand = 0` quando ela ainda não existe:
   * configurar o mínimo antes da primeira compra é o caso normal, e exigir um
   * movimento antes seria pedir para dar entrada em algo que não chegou.
   * **Não toca em `on_hand`** — mínimo é política, não quantidade.
   */
  setMinimum(input: {
    organizationId: string;
    businessUnitId: string;
    catalogItemId: string;
    minimumStock: string;
    actorId: string;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO inventory_balances (
          id, organization_id, business_unit_id, catalog_item_id,
          minimum_stock, updated_at
        ) VALUES (
          ${generateUuidV7()}::uuid,
          ${input.organizationId}::uuid,
          ${input.businessUnitId}::uuid,
          ${input.catalogItemId}::uuid,
          ${input.minimumStock}::decimal,
          now()
        )
        ON CONFLICT (business_unit_id, catalog_item_id) DO UPDATE
          SET minimum_stock = ${input.minimumStock}::decimal,
              updated_at = now()
      `;

      const balance = await tx.inventoryBalance.findFirstOrThrow({
        where: {
          businessUnitId: input.businessUnitId,
          catalogItemId: input.catalogItemId,
        },
        select: balanceView,
      });

      await this.audit(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.actorId,
        'INVENTORY_MINIMUM_SET',
        balance.id,
        null,
        {
          catalogItemId: input.catalogItemId,
          minimumStock: input.minimumStock,
        },
      );

      return balance;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  listBalances(organizationId: string, query: InventoryBalanceQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.InventoryBalanceWhereInput = {
      organizationId,
      businessUnitId: query.businessUnitId,
      catalogItemId: query.catalogItemId,
      ...(query.search
        ? {
            catalogItem: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    return this.rls.run(async (tx) => {
      /**
       * "Baixo" compara duas colunas, e o Prisma não expressa isso no `where`.
       *
       * O filtro vira SQL cru sobre os ids elegíveis, e a listagem continua
       * paginada pelo banco — trazer tudo para filtrar em memória daria a
       * página errada assim que o estoque crescesse.
       */
      const lowIds = query.lowStock
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM inventory_balances
             WHERE organization_id = ${organizationId}::uuid
               AND (on_hand <= 0 OR (minimum_stock > 0 AND on_hand <= minimum_stock))
          `
        : null;

      const scoped: Prisma.InventoryBalanceWhereInput = lowIds
        ? { ...where, id: { in: lowIds.map((row) => row.id) } }
        : where;

      const data = await tx.inventoryBalance.findMany({
        where: scoped,
        select: balanceView,
        orderBy: [{ catalogItem: { name: 'asc' } }, { id: 'asc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.inventoryBalance.count({ where: scoped });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  findBalance(
    organizationId: string,
    businessUnitId: string,
    catalogItemId: string,
  ) {
    return this.rls.run((tx) =>
      tx.inventoryBalance.findFirst({
        where: { organizationId, businessUnitId, catalogItemId },
        select: balanceView,
      }),
    );
  }

  /** Todos os saldos de um item, unidade a unidade. */
  itemBalances(organizationId: string, catalogItemId: string) {
    return this.rls.run((tx) =>
      tx.inventoryBalance.findMany({
        where: { organizationId, catalogItemId },
        select: balanceView,
        orderBy: { businessUnit: { legalName: 'asc' } },
      }),
    );
  }

  listMovements(organizationId: string, query: InventoryMovementQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.InventoryMovementWhereInput = {
      organizationId,
      type: query.type,
      businessUnitId: query.businessUnitId,
      catalogItemId: query.catalogItemId,
      operationId: query.operationId,
      source: query.source,
      ...(query.from || query.to
        ? { createdAt: { gte: query.from, lte: query.to } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { reason: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
              {
                catalogItem: {
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    return this.rls.run(async (tx) => {
      const data = await tx.inventoryMovement.findMany({
        where,
        select: movementView,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.inventoryMovement.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  /** Contagens de itens controlados, baixos e zerados. */
  stockCounts(organizationId: string, businessUnitId?: string) {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<{ tracked: bigint; low: bigint; out: bigint }[]>`
        SELECT COUNT(*)::bigint AS tracked,
               COUNT(*) FILTER (
                 WHERE on_hand > 0 AND minimum_stock > 0 AND on_hand <= minimum_stock
               )::bigint AS low,
               COUNT(*) FILTER (WHERE on_hand <= 0)::bigint AS out
          FROM inventory_balances
         WHERE organization_id = ${organizationId}::uuid
           ${
             businessUnitId
               ? Prisma.sql`AND business_unit_id = ${businessUnitId}::uuid`
               : Prisma.empty
           }
      `,
    );
  }

  /** Movimentos do período, agrupados por tipo. */
  movementTotals(
    organizationId: string,
    scope: { from: Date; to: Date; businessUnitId?: string },
  ) {
    return this.rls.run((tx) =>
      tx.inventoryMovement.groupBy({
        by: ['type'],
        where: {
          organizationId,
          businessUnitId: scope.businessUnitId,
          createdAt: { gte: scope.from, lte: scope.to },
        },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
    );
  }

  /** Consumo por item no período — o que mais sai da prateleira. */
  consumptionByItem(
    organizationId: string,
    scope: { from: Date; to: Date; businessUnitId?: string },
    take = 10,
  ) {
    return this.rls.run(async (tx) => {
      const grouped = await tx.inventoryMovement.groupBy({
        by: ['catalogItemId'],
        where: {
          organizationId,
          businessUnitId: scope.businessUnitId,
          type: 'CONSUMPTION',
          createdAt: { gte: scope.from, lte: scope.to },
        },
        _sum: { quantity: true },
        _count: { _all: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take,
      });

      const items = await tx.product.findMany({
        where: { id: { in: grouped.map((row) => row.catalogItemId) } },
        select: itemView,
      });

      return { grouped, items };
    });
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

  findCatalogItem(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.product.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, kind: true, name: true, status: true },
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

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private audit(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    action: string,
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
        entityType: 'INVENTORY',
        entityId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

export type { InventoryAnalyticsQueryDto };
