import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import {
  Prisma,
  type BillingPromotion,
  type CorporatePromotionCommand,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { ConflictException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import {
  BILLING_PROVIDER,
  type BillingProvider,
  type PromotionPrice,
} from '../billing/billing.types';
import { BillingNotConfiguredException } from '../billing/billing.errors';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';
import { CommercialPlanService } from '../subscription-plans/catalog/commercial-plan.service';
import type { CorporateAuditReference } from '../platform-administration/corporate-organization.read-model';
import type { CorporateCall } from './corporate-access.guard';
import type {
  CreatePromotionDto,
  PromotionListDto,
  PromotionTermsDto,
  PromotionVersionDto,
  RedemptionListDto,
  UpdatePromotionDto,
} from './corporate-promotions.dto';
import { authorizedCorporateReference } from './corporate-request';
import {
  PROMOTIONS_READ,
  PROMOTIONS_CREATE,
  PROMOTIONS_UPDATE,
  PROMOTIONS_ACTIVATE,
  PROMOTIONS_DEACTIVATE,
} from './technical-credential.service';

export type PromotionWrite =
  | { operation: 'CREATE'; input: CreatePromotionDto }
  | { operation: 'UPDATE'; id: string; input: UpdatePromotionDto }
  | {
      operation: 'ACTIVATE' | 'DEACTIVATE';
      id: string;
      input: PromotionVersionDto;
    };

const grants = {
  CREATE: PROMOTIONS_CREATE,
  UPDATE: PROMOTIONS_UPDATE,
  ACTIVATE: PROMOTIONS_ACTIVATE,
  DEACTIVATE: PROMOTIONS_DEACTIVATE,
} as const;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const WRITE_WINDOW_MS = 20 * 60 * 60_000;
const MIN_CHECKOUT_MS = 31 * 60_000;
const pageOf = (query: { page?: string; pageSize?: string }) => ({
  page: Number(query.page ?? 1),
  pageSize: Number(query.pageSize ?? 25),
});
const redemptionFilters = {
  RESERVED: ['CREATING', 'OPEN'],
  CONFIRMED: ['COMPLETED'],
  RELEASED: ['EXPIRED', 'FAILED'],
};

function promotionView(row: BillingPromotion) {
  const now = Date.now();
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    version: row.version,
    providerMode: row.mode,
    status: row.status,
    availability:
      row.status !== 'ACTIVE'
        ? 'UNAVAILABLE'
        : row.endsAt.getTime() <= now
          ? 'EXPIRED'
          : row.startsAt.getTime() > now
            ? 'SCHEDULED'
            : 'AVAILABLE',
    terms: {
      percentOff: row.percentOff,
      amountOffMinor: row.amountOffMinor,
      currency: row.currency,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      planCodes: row.planCodes,
      billingIntervals: row.billingIntervals,
      totalLimit: row.totalLimit,
      customerLimit: row.customerLimit,
      audience: row.audience,
      durationMonths: row.durationMonths,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Result = {
  operationId: string;
  promotion: ReturnType<typeof promotionView>;
  pending: boolean;
};
type Receipt = Result & { replayed: boolean };

type Sync = {
  command: CorporatePromotionCommand;
  row: BillingPromotion;
  replayed: boolean;
};

@Injectable()
export class CorporatePromotionsService {
  private readonly logger = new Logger(CorporatePromotionsService.name);

  constructor(
    private readonly rls: RlsTransaction,
    private readonly catalog: CommercialPlanService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  list(call: CorporateCall, reference: unknown, query: PromotionListDto) {
    return this.read(call, reference, 'LIST', null, async (tx) => {
      const { page, pageSize } = pageOf(query);
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.code
          ? { code: { startsWith: query.code.toUpperCase() } }
          : {}),
      };
      const rows = await tx.billingPromotion.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return {
        items: rows.map(promotionView),
        total: await tx.billingPromotion.count({ where }),
        page,
        pageSize,
      };
    });
  }

  detail(call: CorporateCall, reference: unknown, id: string) {
    return this.read(call, reference, 'DETAIL', id, (_, row) =>
      promotionView(row!),
    );
  }

  redemptions(
    call: CorporateCall,
    reference: unknown,
    id: string,
    query: RedemptionListDto,
  ) {
    return this.read(call, reference, 'REDEMPTIONS', id, async (tx) => {
      const { page, pageSize } = pageOf(query);
      const where = {
        promotionId: id,
        ...(query.status
          ? { status: { in: redemptionFilters[query.status] } }
          : {}),
      };
      const rows = await tx.billingCheckoutAttempt.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          organizationId: true,
          planCode: true,
          billingInterval: true,
          mode: true,
          status: true,
          promotionOriginalMinor: true,
          promotionDiscountMinor: true,
          promotionCheckoutExpiresAt: true,
          createdAt: true,
          completedAt: true,
        },
      });
      return {
        items: rows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          planCode: row.planCode,
          billingInterval: row.billingInterval,
          mode: row.mode,
          currency: 'BRL',
          status:
            row.status === 'COMPLETED'
              ? 'CONFIRMED'
              : ['CREATING', 'OPEN'].includes(row.status)
                ? 'RESERVED'
                : 'RELEASED',
          originalMinor: row.promotionOriginalMinor,
          discountMinor: row.promotionDiscountMinor,
          expiresAt: row.promotionCheckoutExpiresAt,
          createdAt: row.createdAt,
          confirmedAt: row.completedAt,
        })),
        total: await tx.billingCheckoutAttempt.count({ where }),
        page,
        pageSize,
      };
    });
  }

  redemptionSummary(
    call: CorporateCall,
    reference: unknown,
    id: string,
    mode: 'TEST' | 'LIVE',
  ) {
    return this.read(
      call,
      reference,
      'REDEMPTION_SUMMARY',
      id,
      async (tx) => {
        const [row] = await tx.$queryRaw<
          {
            reserved: number;
            confirmed: number;
            released: number;
            confirmedWithoutDiscount: number;
            confirmedDiscountMinor: string;
          }[]
        >`
        SELECT count(*) FILTER (WHERE status IN (${Prisma.join(redemptionFilters.RESERVED)}))::int AS reserved,
          count(*) FILTER (WHERE status = 'COMPLETED')::int AS confirmed,
          count(*) FILTER (WHERE status IN (${Prisma.join(redemptionFilters.RELEASED)}))::int AS released,
          count(*) FILTER (WHERE status = 'COMPLETED' AND promotion_discount_minor IS NULL)::int AS "confirmedWithoutDiscount",
          coalesce(sum(promotion_discount_minor) FILTER (WHERE status = 'COMPLETED'), 0)::text AS "confirmedDiscountMinor"
        FROM public.billing_checkout_attempts
        WHERE promotion_id = ${id}::uuid AND mode = ${mode} AND provider = 'STRIPE'
      `;
        return {
          promotionId: id,
          mode,
          currency: 'BRL',
          coverage: 'ORBIT_CHECKOUT_ATTEMPTS' as const,
          ...row,
        };
      },
      mode,
    );
  }

  async write(
    call: CorporateCall,
    reference: unknown,
    key: unknown,
    command: PromotionWrite,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      grants[command.operation],
      true,
    );
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,120}$/.test(key))
      throw new BadRequestException(
        'Informe uma chave de idempotência válida.',
      );
    const keyHash = hash(key);
    const id = 'id' in command ? command.id : null;
    const fields = {
      reason: command.input.reason,
      ...('expectedVersion' in command.input
        ? { expectedVersion: command.input.expectedVersion }
        : {}),
    };
    await this.scope(audit, (tx) =>
      this.audit(
        tx,
        audit,
        id,
        'ATTEMPT',
        command.operation,
        'STARTED',
        fields,
      ),
    );
    try {
      const terms =
        'terms' in command.input && command.input.terms
          ? this.terms(command.input.terms)
          : undefined;
      const code =
        'code' in command.input ? command.input.code.toUpperCase() : undefined;
      const name = 'name' in command.input ? command.input.name : undefined;
      const description =
        'description' in command.input ? command.input.description : undefined;
      const requestHash = hash(
        JSON.stringify({ id, ...fields, terms, code, name, description }),
      );
      const lock = [
        'corporate-promotion',
        audit.technicalPrincipalId,
        command.operation,
        keyHash,
      ].join(':');
      const prepared = await this.scope<Receipt | Sync>(audit, async (tx) => {
        await this.lock(tx, lock);
        const previous = await tx.corporatePromotionCommand.findFirst({
          where: {
            technicalPrincipalId: audit.technicalPrincipalId,
            operation: command.operation,
            keyHash,
          },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ConflictException(
              'Chave já usada para outro comando.',
              'IDEMPOTENCY_MISMATCH',
            );
          if (previous.result) {
            await this.audit(
              tx,
              audit,
              previous.promotionId,
              'RESULT',
              command.operation,
              'REPLAYED',
              fields,
              previous.id,
            );
            return { ...(previous.result as Result), replayed: true };
          }
          return {
            command: previous,
            row: await this.requirePromotion(tx, previous.promotionId),
            replayed: true,
          } satisfies Sync;
        }
        const entry = {
          id: generateUuidV7(),
          technicalPrincipalId: audit.technicalPrincipalId,
          operation: command.operation,
          keyHash,
          requestHash,
        };
        if (command.operation === 'CREATE') {
          await this.lock(tx, 'promotion-code:' + code!);
          if (await tx.billingPromotion.findUnique({ where: { code } }))
            throw new ConflictException(
              'Este código já pertence a uma promoção.',
            );
          const row = await tx.billingPromotion.create({
            data: {
              id: generateUuidV7(),
              code: code!,
              name: name!,
              description,
              ...terms!,
              status: 'DRAFT',
            },
          });
          return this.localReceipt(tx, audit, row, entry, fields);
        }
        const row = await this.current(
          tx,
          command.id,
          command.input.expectedVersion,
        );
        if (command.operation === 'UPDATE') {
          if (!terms && name === undefined && description === undefined)
            throw new BadRequestException(
              'Informe pelo menos um campo para edição.',
            );
          if (terms && row.status !== 'DRAFT')
            throw new ConflictException(
              'Crie uma promoção para mudar condições comerciais após iniciar a ativação.',
            );
          if (row.status === 'ACTIVATING' || row.status === 'DEACTIVATING')
            throw new ConflictException(
              'Conclua a sincronização atual antes de editar.',
            );
          const updated = await tx.billingPromotion.update({
            where: { id: row.id },
            data: { ...terms, name, description, version: { increment: 1 } },
          });
          return this.localReceipt(tx, audit, updated, entry, fields);
        }
        const activating = command.operation === 'ACTIVATE';
        if (row.status !== (activating ? 'DRAFT' : 'ACTIVE'))
          throw new ConflictException(
            'O estado da promoção não permite esta ação.',
          );
        if (
          !this.provider.isEnabled() ||
          !this.provider.activatePromotion ||
          !this.provider.deactivatePromotion
        )
          throw new BillingNotConfiguredException();
        if (!activating && row.mode !== this.provider.mode)
          throw new ConflictException(
            'A promoção está vinculada a outro modo de cobrança.',
          );
        const prices = activating ? await this.prices(row) : undefined;
        const pending = await tx.billingPromotion.update({
          where: { id: row.id },
          data: {
            status: activating ? 'ACTIVATING' : 'DEACTIVATING',
            mode: this.provider.mode,
            syncStartedAt: new Date(),
            eligiblePrices: prices as Prisma.InputJsonValue | undefined,
            version: { increment: 1 },
          },
        });
        const pendingCommand = await tx.corporatePromotionCommand.create({
          data: { ...entry, promotionId: row.id },
        });
        await this.audit(
          tx,
          audit,
          row.id,
          'RESULT',
          command.operation,
          pending.status,
          fields,
          pendingCommand.id,
        );
        return {
          command: pendingCommand,
          row: pending,
          replayed: false,
        } satisfies Sync;
      });
      if (!('row' in prepared)) return prepared;
      return await this.sync(audit, prepared, lock, fields);
    } catch (error) {
      await this.scope(audit, (tx) =>
        this.audit(
          tx,
          audit,
          id,
          'RESULT',
          command.operation,
          'UNCONFIRMED_OR_REJECTED',
          fields,
        ),
      );
      throw error;
    }
  }

  private async sync(
    audit: CorporateAuditReference,
    stage: Sync,
    lock: string,
    fields: Prisma.InputJsonObject,
  ) {
    const { row, command } = stage;
    const activating = command.operation === 'ACTIVATE';
    let providerId = row.providerPromotionId;
    try {
      if (
        !this.provider.isEnabled() ||
        this.provider.mode !== row.mode ||
        !this.provider.activatePromotion ||
        !this.provider.deactivatePromotion
      )
        throw new BillingNotConfiguredException();
      const terms = {
        id: row.id,
        mode: row.mode,
        percentOff: row.percentOff,
        amountOffMinor: row.amountOffMinor,
        totalLimit: row.totalLimit,
        durationMonths: row.durationMonths,
        endsAt: row.endsAt,
        prices: row.eligiblePrices as unknown as PromotionPrice[],
        recoverOnly:
          Date.now() >= row.syncStartedAt!.getTime() + WRITE_WINDOW_MS,
      };
      if (activating) providerId = await this.provider.activatePromotion(terms);
      else await this.provider.deactivatePromotion(terms, providerId!);
      if (!providerId || !/^promo_[A-Za-z0-9]+$/.test(providerId))
        throw new Error('Invalid provider promotion identity');
    } catch {
      this.logger.warn({
        event: 'corporate_promotion_sync_pending',
        operationId: command.id,
        correlationId: audit.correlationId,
      });
      return this.scope(audit, async (tx) => {
        await this.lock(tx, lock);
        const receipt = await tx.corporatePromotionCommand.findUniqueOrThrow({
          where: { id: command.id },
        });
        if (receipt.result)
          return { ...(receipt.result as Result), replayed: true };
        await this.audit(
          tx,
          audit,
          row.id,
          'RESULT',
          command.operation,
          'PENDING',
          fields,
          command.id,
        );
        return {
          operationId: command.id,
          promotion: promotionView(row),
          pending: true,
          replayed: stage.replayed,
        };
      });
    }
    return this.scope(audit, async (tx) => {
      await this.lock(tx, lock);
      const receipt = await tx.corporatePromotionCommand.findUniqueOrThrow({
        where: { id: command.id },
      });
      if (receipt.result)
        return { ...(receipt.result as Result), replayed: true };
      const result = await tx.billingPromotion.update({
        where: { id: row.id, version: row.version },
        data: {
          providerPromotionId: providerId,
          status: activating ? 'ACTIVE' : 'INACTIVE',
          version: { increment: 1 },
        },
      });
      const data: Result = {
        operationId: command.id,
        promotion: promotionView(result),
        pending: false,
      };
      await tx.corporatePromotionCommand.update({
        where: { id: command.id },
        data: { result: data },
      });
      await this.audit(
        tx,
        audit,
        row.id,
        'RESULT',
        command.operation,
        result.status,
        fields,
        command.id,
      );
      return { ...data, replayed: stage.replayed };
    });
  }

  private async localReceipt(
    tx: PrismaTransactionClient,
    audit: CorporateAuditReference,
    row: BillingPromotion,
    entry: {
      id: string;
      technicalPrincipalId: string;
      operation: string;
      keyHash: string;
      requestHash: string;
    },
    fields: Prisma.InputJsonObject,
  ) {
    const data: Result = {
      operationId: entry.id,
      promotion: promotionView(row),
      pending: false,
    };
    await tx.corporatePromotionCommand.create({
      data: { ...entry, promotionId: row.id, result: data },
    });
    await this.audit(
      tx,
      audit,
      row.id,
      'RESULT',
      entry.operation,
      'APPLIED',
      fields,
      entry.id,
    );
    return { ...data, replayed: false };
  }

  private terms(input: PromotionTermsDto) {
    const percent = input.percentOff !== undefined;
    const fixed = input.amountOffMinor !== undefined;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (
      percent === fixed ||
      (fixed ? input.currency !== 'BRL' : input.currency !== undefined) ||
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt >= endsAt ||
      input.customerLimit > input.totalLimit ||
      (input.durationMonths !== undefined &&
        (input.billingIntervals.length !== 1 ||
          input.billingIntervals[0] !== BillingInterval.MONTHLY))
    ) {
      throw new BadRequestException(
        'Confira o desconto, a vigência, os limites e as periodicidades.',
      );
    }
    return {
      percentOff: input.percentOff ?? null,
      amountOffMinor: input.amountOffMinor ?? null,
      currency: input.currency ?? null,
      startsAt,
      endsAt,
      planCodes: [...input.planCodes].sort(),
      billingIntervals: [...input.billingIntervals].sort(),
      totalLimit: input.totalLimit,
      customerLimit: input.customerLimit,
      audience: input.audience,
      durationMonths: input.durationMonths ?? null,
    };
  }

  private async prices(row: BillingPromotion): Promise<PromotionPrice[]> {
    if (
      row.endsAt.getTime() <
      Math.max(Date.now(), row.startsAt.getTime()) + MIN_CHECKOUT_MS
    )
      throw new ConflictException(
        'A promoção precisa de pelo menos 31 minutos de vigência disponível.',
      );
    const prices: PromotionPrice[] = [];
    for (const code of row.planCodes) {
      const plan = await this.catalog.find(code);
      if (!plan?.isActive || plan.tenantId !== null)
        throw new ConflictException('Use planos públicos ativos do catálogo.');
      for (const interval of row.billingIntervals) {
        const price = plan.prices[interval];
        if (
          !price?.stripePriceId ||
          price.amountMinor <= (row.amountOffMinor ?? 0) ||
          price.currency !== 'BRL'
        )
          throw new ConflictException(
            'Os planos elegíveis precisam de preços Stripe em BRL superiores ao desconto fixo.',
          );
        prices.push({
          planCode: code,
          billingInterval: interval,
          priceId: price.stripePriceId,
          amountMinor: price.amountMinor,
        });
      }
    }
    return prices;
  }

  private async current(
    tx: PrismaTransactionClient,
    id: string,
    version: number,
  ) {
    const [lock] = await tx.$queryRaw<
      { version: number }[]
    >`SELECT version FROM billing_promotions WHERE id = ${id}::uuid FOR UPDATE`;
    if (!lock) throw new NotFoundException();
    if (lock.version !== version)
      throw new ConflictException(
        'A versão da promoção foi alterada.',
        'STALE_VERSION',
      );
    return this.requirePromotion(tx, id);
  }

  private requirePromotion(tx: PrismaTransactionClient, id: string) {
    return tx.billingPromotion.findUniqueOrThrow({ where: { id } });
  }

  private async read<T>(
    call: CorporateCall,
    reference: unknown,
    operation: string,
    id: string | null,
    work: (
      tx: PrismaTransactionClient,
      row: BillingPromotion | null,
    ) => T | Promise<T>,
    requiredMode?: 'TEST' | 'LIVE',
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      PROMOTIONS_READ,
      false,
    );
    const result = await this.scope(audit, async (tx) => {
      const row = id
        ? await tx.billingPromotion.findUnique({ where: { id } })
        : null;
      const missing =
        !!id &&
        (!row || (requiredMode !== undefined && row.mode !== requiredMode));
      await this.audit(
        tx,
        audit,
        id,
        'READ',
        operation,
        missing ? 'NOT_FOUND' : 'CONFIRMED',
      );
      return missing ? null : await work(tx, row);
    });
    if (result === null) throw new NotFoundException();
    return result;
  }

  private scope<T>(
    audit: CorporateAuditReference,
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ) {
    return this.rls.runAmbient(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.corporate_promotion_principal', ${audit.technicalPrincipalId}, true)`;
      return work(tx);
    });
  }

  private async lock(tx: PrismaTransactionClient, value: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))::text`;
  }

  private audit(
    tx: PrismaTransactionClient,
    audit: CorporateAuditReference,
    id: string | null,
    phase: 'READ' | 'ATTEMPT' | 'RESULT',
    operation: string,
    outcome: string,
    fields: Prisma.InputJsonObject = {},
    operationId?: string,
  ) {
    return tx.auditLog.createMany({
      data: {
        entityType: 'BILLING_PROMOTION',
        entityId: id,
        action: 'CORPORATE_PROMOTION_' + phase,
        requestId: audit.correlationId,
        metadata: {
          ...audit,
          operation,
          outcome,
          ...fields,
          ...(operationId ? { operationId } : {}),
        },
      },
    });
  }
}
