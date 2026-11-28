import { AssetService } from '../organizations/business-units/equipaments/asset.service';
import type { CreateAssetDto } from '../organizations/business-units/equipaments/asset.dto';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import type { AuthenticatedIdentity } from '../identity/domain/identity.types';
import { QuoteService } from './quote.service';
import { QuoteMapper } from './quote.mapper';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import type { CreateMobileQuoteDto } from './mobile-quote.dto';

/** Field operators may propose to customers, without managing the whole commercial ledger. */
@Injectable()
export class MobileQuoteService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly quotes: QuoteService,
    private readonly mapper: QuoteMapper,
    private readonly acceptance: QuoteAcceptanceService,
    private readonly assets: AssetService,
  ) {}

  authorize(actor: AuthenticatedIdentity) {
    if (
      !actor.organizationId ||
      (!actor.isOrganizationOwner &&
        !actor.permissions.some((p) =>
          [
            '*',
            'quotes.manage',
            'operations.walk_in.create',
            'operations.create',
          ].includes(p),
        ))
    ) {
      throw new ForbiddenException(
        'Você não possui permissão para criar orçamentos em campo.',
      );
    }
    return actor.organizationId;
  }

  private unit(actor: AuthenticatedIdentity, requested?: string) {
    const id = requested ?? actor.businessUnitId ?? actor.businessUnitIds[0];
    if (!id || !actor.businessUnitIds.some((candidate) => candidate === id)) {
      throw new ForbiddenException('Unidade fora do seu acesso.');
    }
    return id;
  }

  async options(
    actor: AuthenticatedIdentity,
    customerId: string,
    requestedUnit?: string,
  ) {
    const organizationId = this.authorize(actor);
    const businessUnitId = this.unit(actor, requestedUnit);
    return this.rls.run(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId, deletedAt: null },
        select: { id: true, legalName: true, tradeName: true },
      });
      if (!customer) throw new EntityNotFoundException('Cliente', customerId);
      const addresses = await tx.customerAddress.findMany({
        where: {
          customerId,
          organizationId,
          deletedAt: null,
          isActive: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { label: 'asc' }],
      });
      const equipment = await tx.asset.findMany({
        where: {
          customerId,
          organizationId,
          businessUnitId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true, name: true, identifier: true, location: true },
        orderBy: { name: 'asc' },
      });
      const members = await tx.organizationMembership.findMany({
        where: { organizationId, deletedAt: null, status: 'ACTIVE' },
        select: {
          userId: true,
          user: {
            select: {
              displayName: true,
              professionalSignatures: {
                where: { organizationId, active: true, revokedAt: null },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      return {
        businessUnitId,
        customer,
        addresses,
        equipment,
        responsibles: members.map((m) => ({
          id: m.userId,
          name: m.user.displayName,
          hasSignature: m.user.professionalSignatures.length > 0,
        })),
      };
    });
  }

  catalog(actor: AuthenticatedIdentity, search = '', requestedUnit?: string) {
    const organizationId = this.authorize(actor);
    const businessUnitId = this.unit(actor, requestedUnit);
    return this.rls.run((tx) =>
      tx.product.findMany({
        where: {
          organizationId,
          deletedAt: null,
          status: 'ACTIVE',
          AND: [
            {
              OR: [{ businessUnitId: null }, { businessUnitId }],
            },
            {
              OR: [
                {
                  name: { contains: search.slice(0, 180), mode: 'insensitive' },
                },
                {
                  sku: { contains: search.slice(0, 180), mode: 'insensitive' },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          sku: true,
          kind: true,
          unit: true,
          salePrice: true,
        },
        orderBy: { name: 'asc' },
        take: 50,
      }),
    );
  }

  async create(actor: AuthenticatedIdentity, input: CreateMobileQuoteDto) {
    const organizationId = this.authorize(actor);
    const businessUnitId = this.unit(actor, input.businessUnitId);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    // One transaction, including every item and the send transition. Retry after a
    // lost response returns the same quote; a different body cannot reuse its key.
    return this.rls.runAmbient(
      async (tx) => {
        const key = `mobile-quote:${organizationId}:${actor.id}:${input.requestId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const previous = await tx.quote.findFirst({
          where: {
            organizationId,
            createdById: actor.id,
            metadata: { path: ['mobileRequestId'], equals: input.requestId },
          },
        });
        if (previous) {
          const metadata = previous.metadata as Prisma.JsonObject;
          if (metadata.mobileRequestHash !== fingerprint)
            throw new ConflictException(
              'Este envio já foi registrado com outros dados. Abra um novo orçamento.',
            );
          return this.mapper.detail(
            await this.quotes.get(previous.id, organizationId),
          );
        }
        if (!input.responsibleUserId)
          throw new ValidationException(
            'Selecione o responsável técnico pela proposta.',
          );
        const member = await tx.organizationMembership.findFirst({
          where: {
            organizationId,
            userId: input.responsibleUserId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (!member)
          throw new ValidationException(
            'O responsável precisa ser um membro ativo desta organização.',
          );
        const assetIds = [...new Set(input.assetIds ?? [])];
        if (
          assetIds.length &&
          (await tx.asset.count({
            where: {
              id: { in: assetIds },
              organizationId,
              customerId: input.customerId,
              businessUnitId,
              deletedAt: null,
              status: 'ACTIVE',
            },
          })) !== assetIds.length
        ) {
          throw new ValidationException(
            'Selecione equipamentos ativos deste cliente e desta unidade.',
          );
        }
        for (const item of input.items) {
          if (
            item.catalogItemId &&
            !(await tx.product.findFirst({
              where: {
                id: item.catalogItemId,
                organizationId,
                status: 'ACTIVE',
                deletedAt: null,
                OR: [{ businessUnitId: null }, { businessUnitId }],
              },
            }))
          )
            throw new ValidationException(
              'O item do catálogo não está disponível nesta unidade.',
            );
        }
        const quote = await this.quotes.create(
          organizationId,
          businessUnitId,
          actor.id,
          { ...input, businessUnitId },
        );
        for (const item of input.items)
          await this.quotes.addItem(quote.id, organizationId, actor.id, item);
        if (input.discount)
          await this.quotes.update(quote.id, organizationId, actor.id, {
            discount: input.discount,
            discountReason: input.discountReason,
          });
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            metadata: {
              source: 'MOBILE_CUSTOMER',
              mobileRequestId: input.requestId,
              mobileRequestHash: fingerprint,
            },
          },
        });
        return this.mapper.detail(
          await this.quotes.send(quote.id, organizationId, actor.id),
        );
      },
      { timeout: 30_000 },
    );
  }

  async createEquipment(
    actor: AuthenticatedIdentity,
    customerId: string,
    input: CreateAssetDto,
  ) {
    const organizationId = this.authorize(actor);
    const businessUnitId = this.unit(actor, input.businessUnitId);
    if (input.customerId && input.customerId !== customerId)
      throw new ValidationException(
        'O equipamento deve pertencer ao cliente selecionado.',
      );
    // The route owns the customer relation; payload cannot select another customer.
    return this.assets.create(organizationId, {
      ...input,
      businessUnitId,
      customerId,
    });
  }

  async assertDocumentRead(actor: AuthenticatedIdentity, id: string) {
    if (!actor.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    const quote = await this.rls.run((tx) =>
      tx.quote.findFirst({
        where: {
          id,
          organizationId: actor.organizationId!,
          businessUnitId: { in: [...actor.businessUnitIds] },
          deletedAt: null,
          ...(!actor.isOrganizationOwner ? { mobileVisible: true } : {}),
        },
        select: { id: true },
      }),
    );
    if (!quote) throw new EntityNotFoundException('Orçamento', id);
    return actor.organizationId;
  }

  async assertOwn(actor: AuthenticatedIdentity, id: string) {
    const organizationId = this.authorize(actor);
    const quote = await this.rls.run((tx) =>
      tx.quote.findFirst({
        where: {
          id,
          organizationId,
          businessUnitId: { in: [...actor.businessUnitIds] },
          createdById: actor.id,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'MOBILE_CUSTOMER' },
        },
      }),
    );
    if (!quote) throw new EntityNotFoundException('Orçamento', id);
    return organizationId;
  }

  async link(actor: AuthenticatedIdentity, id: string) {
    const organizationId = await this.assertOwn(actor, id);
    return this.acceptance.create(id, organizationId, actor.id);
  }

  async document(actor: AuthenticatedIdentity, id: string) {
    return this.quotes.document(id, await this.assertDocumentRead(actor, id));
  }
}
