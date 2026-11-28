/**
 * Regras do Inventory Engine.
 *
 * ## O que este domínio não faz
 *
 * Não é WMS. Não tem fornecedor, compra, lote, número de série, validade,
 * inventário físico completo, custo médio, FIFO, LIFO, fiscal, código de
 * barras nem previsão de demanda. Registra o que entrou e o que saiu de cada
 * prateleira, e responde quanto tem.
 *
 * ## Serviço não tem estoque
 *
 * `SERVICE` é recusado na porta. Uma hora de mão de obra não fica na
 * prateleira, e permitir movimentá-la criaria um saldo que nunca corresponde a
 * nada físico — o começo de um estoque em que ninguém confia.
 *
 * ## Correção é movimento novo
 *
 * Não há edição nem exclusão de movimento. Contagem que deu diferença vira
 * ajuste, com motivo obrigatório; o histórico anterior permanece, porque é ele
 * que explica o saldo que alguém já conferiu.
 */
import { Injectable } from '@nestjs/common';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { InventoryMovementType } from '../../contracts';
import type {
  InventoryAdjustmentDto,
  InventoryAnalyticsQueryDto,
  InventoryBalanceQueryDto,
  InventoryConsumptionDto,
  InventoryEntryDto,
  InventoryMinimumDto,
  InventoryMovementQueryDto,
  InventoryReturnDto,
  InventoryTransferDto,
} from './inventory.dto';
import { InventoryMapper } from './inventory.mapper';
import {
  InsufficientStock,
  InventoryRepository,
  type MovementRecord,
} from './inventory.repository';
import type {
  InventoryConsumptionPointReadModel,
  InventorySummaryReadModel,
} from './inventory.read-models';

/** Tipos de item que podem ter estoque. `SERVICE` fica de fora. */
const STOCKABLE: readonly string[] = ['PRODUCT', 'PART'];

const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class InventoryService {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly mapper: InventoryMapper,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  balances(organizationId: string, query: InventoryBalanceQueryDto) {
    return this.repository.listBalances(organizationId, query);
  }

  async movements(organizationId: string, query: InventoryMovementQueryDto) {
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationException('The period starts after it ends');
    }
    return this.repository.listMovements(organizationId, query);
  }

  /**
   * Visão de um item: onde ele está, e quanto.
   *
   * Devolve os saldos por unidade. Não soma o total da organização — somar
   * quilos de gás de três filiais dá um número que não corresponde a nenhuma
   * prateleira, e é o tipo de total que leva alguém a prometer uma peça que
   * está a duzentos quilômetros.
   */
  async item(organizationId: string, catalogItemId: string) {
    const product = await this.requireStockable(organizationId, catalogItemId);
    const balances = await this.repository.itemBalances(
      organizationId,
      catalogItemId,
    );
    return { product, balances };
  }

  /* ---------------------------------------------------------------- */
  /* Movimentos                                                        */
  /* ---------------------------------------------------------------- */

  entry(
    organizationId: string,
    fallbackUnitId: string | null,
    actorId: string,
    input: InventoryEntryDto,
  ) {
    return this.move(organizationId, fallbackUnitId, actorId, {
      ...input,
      type: InventoryMovementType.ENTRY,
    });
  }

  /**
   * Consumo em campo.
   *
   * O vínculo com a operação é informativo e verificado: a operação precisa
   * existir na organização. **Nada é deduzido de orçamento** — proposta é
   * intenção comercial, e o que se usa na visita costuma diferir do que foi
   * orçado.
   */
  async consumption(
    organizationId: string,
    fallbackUnitId: string | null,
    actorId: string,
    input: InventoryConsumptionDto,
  ) {
    if (input.operationId) {
      const operation = await this.repository.findOperation(
        input.operationId,
        organizationId,
      );
      if (!operation) {
        throw new EntityNotFoundException('Operation', input.operationId);
      }
    }
    return this.move(organizationId, fallbackUnitId, actorId, {
      ...input,
      type: InventoryMovementType.CONSUMPTION,
    });
  }

  sale(
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    input: Pick<
      InventoryConsumptionDto,
      'catalogItemId' | 'quantity' | 'sourceEntityId'
    >,
  ) {
    return this.move(organizationId, businessUnitId, actorId, {
      ...input,
      type: InventoryMovementType.SALE,
      reason: 'Venda de produto',
    });
  }

  async return(
    organizationId: string,
    fallbackUnitId: string | null,
    actorId: string,
    input: InventoryReturnDto,
  ) {
    if (input.operationId) {
      const operation = await this.repository.findOperation(
        input.operationId,
        organizationId,
      );
      if (!operation) {
        throw new EntityNotFoundException('Operation', input.operationId);
      }
    }
    return this.move(organizationId, fallbackUnitId, actorId, {
      ...input,
      type: InventoryMovementType.RETURN,
    });
  }

  adjustment(
    organizationId: string,
    fallbackUnitId: string | null,
    actorId: string,
    input: InventoryAdjustmentDto,
  ) {
    return this.move(organizationId, fallbackUnitId, actorId, {
      ...input,
      type:
        input.direction === 'IN'
          ? InventoryMovementType.ADJUSTMENT_IN
          : InventoryMovementType.ADJUSTMENT_OUT,
    });
  }

  /**
   * Transferência entre unidades.
   *
   * As duas pontas na mesma transação. Origem e destino precisam ser
   * diferentes e ambas da organização; o acesso às duas é verificado pela RLS,
   * que recusa a inserção do lado que estiver fora do escopo da sessão.
   */
  async transfer(
    organizationId: string,
    actorId: string,
    input: InventoryTransferDto,
  ) {
    if (input.fromBusinessUnitId === input.toBusinessUnitId) {
      throw new ValidationException(
        'Origin and destination must be different business units',
      );
    }
    await this.requireStockable(organizationId, input.catalogItemId);
    await this.requireUnit(organizationId, input.fromBusinessUnitId);
    await this.requireUnit(organizationId, input.toBusinessUnitId);

    try {
      const result = await this.repository.transfer({
        organizationId,
        catalogItemId: input.catalogItemId,
        fromBusinessUnitId: input.fromBusinessUnitId,
        toBusinessUnitId: input.toBusinessUnitId,
        quantity: input.quantity.toFixed(3),
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        createdById: actorId,
      });
      /** `null` = a origem já produziu esta transferência. */
      return result;
    } catch (error) {
      this.rethrowInsufficient(error);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Estoque mínimo                                                    */
  /* ---------------------------------------------------------------- */

  async setMinimum(
    organizationId: string,
    fallbackUnitId: string | null,
    actorId: string,
    input: InventoryMinimumDto,
  ) {
    const businessUnitId = await this.resolveUnit(
      organizationId,
      input.businessUnitId ?? fallbackUnitId,
    );
    await this.requireStockable(organizationId, input.catalogItemId);

    return this.repository.setMinimum({
      organizationId,
      businessUnitId,
      catalogItemId: input.catalogItemId,
      minimumStock: input.minimumStock.toFixed(3),
      actorId,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Panorama do estoque.
   *
   * Contagens e somas de **quantidade**. Nenhum valor monetário: `costPrice`
   * do Catálogo é o preço de hoje, não o custo das unidades que estão lá, e
   * sem FIFO ou custo médio qualquer valoração seria um número inventado com
   * aparência de contabilidade.
   */
  async summary(
    organizationId: string,
    query: InventoryAnalyticsQueryDto,
  ): Promise<InventorySummaryReadModel> {
    const scope = this.scope(query);
    const [counts, totals] = await Promise.all([
      this.repository.stockCounts(organizationId, scope.businessUnitId),
      this.repository.movementTotals(organizationId, scope),
    ]);

    const row = counts[0];
    const pick = (types: readonly string[]) => {
      const rows = totals.filter((entry) => types.includes(entry.type));
      return {
        count: rows.reduce((total, entry) => total + entry._count._all, 0),
        quantity: this.mapper.quantity(
          rows.reduce(
            (total, entry) => total + Number(entry._sum.quantity ?? 0),
            0,
          ),
        ),
      };
    };

    const transfers = totals.filter((entry) =>
      ['TRANSFER_IN', 'TRANSFER_OUT'].includes(entry.type),
    );
    const adjustments = totals.filter((entry) =>
      ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'].includes(entry.type),
    );

    return {
      period: {
        from: scope.from.toISOString(),
        to: scope.to.toISOString(),
      },
      trackedItems: Number(row?.tracked ?? 0),
      lowStockItems: Number(row?.low ?? 0),
      outOfStockItems: Number(row?.out ?? 0),
      movements: {
        entries: pick(['ENTRY', 'RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN']),
        exits: pick(['CONSUMPTION', 'SALE', 'ADJUSTMENT_OUT', 'TRANSFER_OUT']),
        consumption: pick(['CONSUMPTION']),
        /**
         * Transferência conta **um** movimento por par, não dois.
         *
         * As duas pontas são o mesmo fato visto de dois lados; contá-las
         * separadamente dobraria o número de "movimentações" do período sem
         * que nada a mais tivesse acontecido.
         */
        transfers: {
          count: Math.floor(
            transfers.reduce((total, entry) => total + entry._count._all, 0) /
              2,
          ),
        },
        adjustments: {
          count: adjustments.reduce(
            (total, entry) => total + entry._count._all,
            0,
          ),
        },
      },
    };
  }

  async consumptionByItem(
    organizationId: string,
    query: InventoryAnalyticsQueryDto,
  ): Promise<InventoryConsumptionPointReadModel[]> {
    const scope = this.scope(query);
    const { grouped, items } = await this.repository.consumptionByItem(
      organizationId,
      scope,
    );
    const byId = new Map(items.map((item) => [item.id, item]));

    return grouped.flatMap((row) => {
      const item = byId.get(row.catalogItemId);
      if (!item) return [];
      return [
        {
          item: this.mapper.itemRef(item),
          quantity: this.mapper.quantity(row._sum.quantity ?? 0),
          movements: row._count._all,
        },
      ];
    });
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private async move(
    organizationId: string,
    fallbackUnitId: string | null,
    actorId: string,
    input: {
      catalogItemId: string;
      businessUnitId?: string;
      quantity: number;
      type: string;
      reason?: string;
      notes?: string;
      operationId?: string;
      sourceEntityId?: string;
    },
  ): Promise<MovementRecord | null> {
    const businessUnitId = await this.resolveUnit(
      organizationId,
      input.businessUnitId ?? fallbackUnitId,
    );
    await this.requireStockable(organizationId, input.catalogItemId);

    try {
      return await this.repository.record({
        organizationId,
        businessUnitId,
        catalogItemId: input.catalogItemId,
        type: input.type,
        quantity: input.quantity.toFixed(3),
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        operationId: input.operationId ?? null,
        /**
         * A procedência acompanha a identidade.
         *
         * Com `operationId`, o movimento veio de uma ordem de serviço; com
         * `sourceEntityId` sem operação, veio de outro registro do sistema.
         * Sem nenhum dos dois, alguém digitou — e digitação não é idempotente,
         * porque duas entradas iguais são dois fatos.
         */
        source: input.sourceEntityId
          ? input.operationId
            ? 'OPERATION'
            : 'SYSTEM'
          : 'MANUAL',
        sourceEntityId: input.sourceEntityId ?? null,
        createdById: actorId,
      });
    } catch (error) {
      this.rethrowInsufficient(error);
    }
  }

  /**
   * Converte a recusa do banco em recusa de negócio.
   *
   * `InsufficientStock` vem da instrução que não afetou linha nenhuma. Ela
   * carrega o disponível para que a mensagem diga **quanto havia**, e não
   * apenas que não deu.
   */
  private rethrowInsufficient(error: unknown): never {
    if (error instanceof InsufficientStock) {
      throw new ConflictException(
        `Insufficient stock: ${error.available} available in this business unit`,
      );
    }
    throw error;
  }

  private async resolveUnit(
    organizationId: string,
    candidate: string | null | undefined,
  ): Promise<string> {
    if (!candidate) {
      throw new ValidationException(
        'A business unit is required: stock belongs to a unit',
      );
    }
    return this.requireUnit(organizationId, candidate);
  }

  private async requireUnit(
    organizationId: string,
    id: string,
  ): Promise<string> {
    const unit = await this.repository.findBusinessUnit(id, organizationId);
    if (!unit) throw new EntityNotFoundException('BusinessUnit', id);
    return unit.id;
  }

  /**
   * O item existe e pode ter estoque.
   *
   * Serviço é recusado com 422, não 404: ele existe, mas não é estocável — e
   * dizer "não encontrado" mandaria alguém procurar um cadastro que está lá.
   */
  private async requireStockable(organizationId: string, id: string) {
    const product = await this.repository.findCatalogItem(id, organizationId);
    if (!product) throw new EntityNotFoundException('CatalogItem', id);
    if (!STOCKABLE.includes(product.kind)) {
      throw new ValidationException(
        `Items of kind ${product.kind} do not have stock; only PRODUCT and PART do`,
      );
    }
    return product;
  }

  /** Últimos 30 dias quando o período é omitido. */
  private scope(query: InventoryAnalyticsQueryDto) {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 30 * DAY_MS);
    if (from > to) {
      throw new ValidationException('The period starts after it ends');
    }
    return { from, to, businessUnitId: query.businessUnitId };
  }
}
