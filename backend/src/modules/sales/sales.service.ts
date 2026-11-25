import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { ReceiptDeliveryService } from '../financial/receipt-delivery.service';
import { ReceiptService } from '../financial/receipt.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  SALE_PAYMENT_LABELS,
  type CreateSaleDto,
  type SaleProductQueryDto,
} from './sales.dto';

export interface SaleActor {
  organizationId: string;
  businessUnitId: string;
  actorId: string;
  ownOnly: boolean;
}

const saleView = {
  id: true,
  customerId: true,
  customerName: true,
  businessUnitId: true,
  paidOn: true,
  createdAt: true,
  subtotal: true,
  discount: true,
  total: true,
  items: true,
  payments: true,
  notes: true,
  receipt: { select: { code: true, renderStatus: true } },
} satisfies Prisma.ProductSaleSelect;

type SaleRow = Prisma.ProductSaleGetPayload<{ select: typeof saleView }>;
const saleRead = ({ paidOn, createdAt, ...sale }: SaleRow) => ({
  ...sale,
  paidOn: paidOn.toISOString().slice(0, 10),
  createdAt: createdAt.toISOString(),
  subtotal: sale.subtotal.toFixed(2),
  discount: sale.discount.toFixed(2),
  total: sale.total.toFixed(2),
});

export function saleTotals(
  input: Pick<CreateSaleDto, 'items' | 'payments' | 'discount'>,
) {
  const lines = input.items.map((item) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const price = new Prisma.Decimal(item.unitPrice);
    if (quantity.lte(0))
      throw new ValidationException('Informe uma quantidade maior que zero.');
    return {
      productId: item.productId,
      quantity: quantity.toFixed(3),
      unitPrice: price.toFixed(2),
      total: quantity
        .times(price)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    };
  });
  if (new Set(lines.map((line) => line.productId)).size !== lines.length)
    throw new ValidationException(
      'Adicione cada produto uma vez e ajuste sua quantidade.',
    );
  const subtotal = lines.reduce(
    (sum, item) => sum.plus(item.total),
    new Prisma.Decimal(0),
  );
  const discount = new Prisma.Decimal(input.discount ?? '0');
  const total = subtotal.minus(discount);
  if (subtotal.gte('1000000000000') || total.lte(0))
    throw new ValidationException(
      'O total após o desconto deve ser positivo e caber no limite da venda.',
    );
  const payments = input.payments.map((payment) => {
    const amount = new Prisma.Decimal(payment.amount);
    if (amount.lte(0))
      throw new ValidationException(
        'Informe valores positivos para os pagamentos.',
      );
    if (payment.installments && payment.method !== 'CREDIT_CARD')
      throw new ValidationException(
        'Informe parcelas apenas para cartão de crédito.',
      );
    return {
      method: payment.method,
      amount: amount.toFixed(2),
      ...(payment.installments ? { installments: payment.installments } : {}),
    };
  });
  if (
    !payments
      .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0))
      .equals(total)
  )
    throw new ValidationException(
      'A soma dos pagamentos deve ser igual ao total da venda.',
      undefined,
      'SALE_PAYMENT_TOTAL_MISMATCH',
    );
  return { lines, subtotal, discount, total, payments };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly inventory: InventoryService,
    private readonly receipts: ReceiptService,
    private readonly delivery: ReceiptDeliveryService,
  ) {}

  list(actor: SaleActor, page: number, limit: number) {
    return this.rls.run(async (tx) => {
      const where = this.scope(actor);
      const data = await tx.productSale.findMany({
        where,
        select: saleView,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.productSale.count({ where });
      return {
        data: data.map(saleRead),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  products(actor: SaleActor, { page, limit, search }: SaleProductQueryDto) {
    return this.rls.run(async (tx) => {
      const where = {
        organizationId: actor.organizationId,
        status: 'ACTIVE',
        deletedAt: null,
        kind: { in: ['PRODUCT', 'PART'] },
        OR: [
          { businessUnitId: null },
          { businessUnitId: actor.businessUnitId },
        ],
        ...(search?.trim()
          ? {
              AND: [
                {
                  OR: [
                    {
                      name: {
                        contains: search.trim(),
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      sku: {
                        contains: search.trim(),
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      } satisfies Prisma.ProductWhereInput;
      const data = await tx.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          salePrice: true,
          inventoryBalances: {
            where: { businessUnitId: actor.businessUnitId },
            select: { onHand: true, reserved: true },
            take: 1,
          },
        },
      });
      const total = await tx.product.count({ where });
      return {
        data: data.map(
          ({ inventoryBalances: [balance], salePrice, ...product }) => ({
            ...product,
            salePrice: salePrice?.toFixed(2) ?? null,
            available: balance
              ? balance.onHand.minus(balance.reserved).toFixed(3)
              : '0.000',
          }),
        ),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async get(actor: SaleActor, id: string) {
    return saleRead(await this.find(actor, id));
  }

  async create(actor: SaleActor, input: CreateSaleDto) {
    const calculated = saleTotals(input);
    const { organizationId, businessUnitId, actorId } = actor;
    const notes = input.notes?.trim() || null;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          businessUnitId,
          customerId: input.customerId,
          paidOn: input.paidOn,
          notes,
          discount: calculated.discount.toFixed(2),
          lines: calculated.lines,
          payments: calculated.payments,
        }),
      )
      .digest('hex');

    return this.rls.runAmbient(
      async (tx) => {
        const requestKey = `sale:${organizationId}:${actorId}:${input.requestId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))::text`;
        const previous = await tx.productSale.findFirst({
          where: {
            organizationId,
            createdById: actorId,
            requestId: input.requestId,
          },
          select: { ...saleView, requestHash: true },
        });
        if (previous) {
          const { requestHash: previousHash, ...sale } = previous;
          if (previousHash !== requestHash)
            throw new ConflictException(
              'Os dados desta confirmação mudaram. Consulte a venda anterior.',
              'SALE_CONFIRMATION_CHANGED',
            );
          return saleRead(sale);
        }
        const unit = await tx.businessUnit.findFirst({
          where: {
            id: businessUnitId,
            organizationId,
            status: 'ACTIVE',
            deletedAt: null,
          },
          select: { id: true, timezone: true },
        });
        if (!unit) throw new EntityNotFoundException('Unidade ativa');
        const dateParts = new Intl.DateTimeFormat('en', {
          timeZone: unit.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date());
        const today = ['year', 'month', 'day']
          .map((type) => dateParts.find((part) => part.type === type)!.value)
          .join('-');
        if (input.paidOn > today)
          throw new ValidationException(
            'O pagamento deve ter sido recebido.',
            undefined,
            'SALE_RECEIPT_DATE_INVALID',
          );
        const customer = await tx.customer.findFirst({
          where: {
            id: input.customerId,
            organizationId,
            deletedAt: null,
            status: 'ACTIVE',
          },
          select: { id: true, legalName: true, documentNumber: true },
        });
        if (!customer) throw new EntityNotFoundException('Cliente ativo');

        const products = await tx.product.findMany({
          where: {
            id: { in: calculated.lines.map((line) => line.productId) },
            organizationId,
            deletedAt: null,
            status: 'ACTIVE',
            kind: { in: ['PRODUCT', 'PART'] },
            OR: [{ businessUnitId: null }, { businessUnitId }],
          },
          select: { id: true, sku: true, name: true, unit: true },
        });
        const productsById = new Map(
          products.map((product) => [product.id, product]),
        );
        const items = calculated.lines.map((line) => {
          const product = productsById.get(line.productId);
          if (!product)
            throw new ValidationException(
              'Um produto foi desativado ou não está disponível nesta unidade.',
            );
          return {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            unit: product.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            total: line.total.toFixed(2),
          };
        });
        const id = generateUuidV7();
        // Mantém a mesma ordem de locks de estoque quando duas vendas compartilham produtos.
        for (const item of [...items].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        )) {
          try {
            await this.inventory.sale(organizationId, businessUnitId, actorId, {
              catalogItemId: item.productId,
              quantity: Number(item.quantity),
              sourceEntityId: id,
            });
          } catch (error) {
            if (error instanceof ConflictException)
              throw new ConflictException(
                `Estoque insuficiente para ${item.name} nesta unidade.`,
                'SALE_STOCK_INSUFFICIENT',
              );
            throw error;
          }
        }

        const money = new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        const payments = calculated.payments.map(
          (payment) =>
            `${SALE_PAYMENT_LABELS[payment.method]}${payment.installments && payment.installments > 1 ? ` (${payment.installments} parcelas)` : ''} — ${money.format(Number(payment.amount))}`,
        );
        const referring = [
          'Venda de produtos',
          ...items.map(
            (item) =>
              `${new Prisma.Decimal(item.quantity).toString().replace('.', ',')} ${item.unit} · ${item.name} — ${money.format(Number(item.total))}`,
          ),
          ...(calculated.discount.gt(0)
            ? [`Desconto: ${money.format(calculated.discount.toNumber())}`]
            : []),
          `Pagamento: ${payments.join(' / ')}`,
          ...(notes ? [`Observações: ${notes}`] : []),
        ].join('\n');
        const method =
          calculated.payments.length === 1
            ? SALE_PAYMENT_LABELS[calculated.payments[0]!.method]
            : 'Pagamento combinado';
        const receipt = await this.receipts.create(
          organizationId,
          businessUnitId,
          actorId,
          {
            customerId: customer.id,
            businessUnitId,
            payer: customer.legalName.slice(0, 180),
            payerDocument: customer.documentNumber ?? undefined,
            paidOn: input.paidOn,
            amount: calculated.total.toFixed(2),
            referring,
            paymentMethod: method,
          },
        );
        await this.delivery.render(receipt.id, this.receiptActor(actor));
        const sale = await tx.productSale.create({
          data: {
            id,
            organizationId,
            businessUnitId,
            customerId: customer.id,
            customerName: customer.legalName,
            createdById: actorId,
            requestId: input.requestId,
            requestHash,
            receiptId: receipt.id,
            paidOn: new Date(input.paidOn),
            subtotal: calculated.subtotal,
            discount: calculated.discount,
            total: calculated.total,
            items,
            payments: calculated.payments,
            notes,
          },
          select: saleView,
        });
        return saleRead(sale);
      },
      { timeout: 30_000 },
    );
  }

  async retryReceipt(actor: SaleActor, id: string) {
    return this.rls.runAmbient(async (tx) => {
      const key = `sale-receipt:${actor.organizationId}:${id}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
      const sale = await this.find(actor, id);
      if (
        !['READY', 'PENDING', 'RENDERING'].includes(
          sale.receipt.renderStatus ?? '',
        )
      )
        await this.delivery.render(sale.receiptId, this.receiptActor(actor));
      return this.get(actor, id);
    });
  }

  async download(actor: SaleActor, id: string) {
    const sale = await this.find(actor, id);
    return this.delivery.download(sale.receiptId, this.receiptActor(actor));
  }

  private async find(actor: SaleActor, id: string) {
    const sale = await this.rls.run((tx) =>
      tx.productSale.findFirst({
        where: { ...this.scope(actor), id },
        select: { ...saleView, receiptId: true },
      }),
    );
    if (!sale) throw new EntityNotFoundException('Venda');
    return sale;
  }

  private scope({
    organizationId,
    businessUnitId,
    ownOnly,
    actorId,
  }: SaleActor) {
    return {
      organizationId,
      businessUnitId,
      ...(ownOnly ? { createdById: actorId } : {}),
    };
  }

  private receiptActor(actor: SaleActor) {
    return { ...actor, unitIds: [actor.businessUnitId] };
  }
}
