import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { ConflictException, EntityNotFoundException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { OperationRepository } from '../operations/operation.repository';
import type { CustomerPortalActor } from '../customer-portal/customer-portal.types';
import type {
  CustomerServiceRequestInternalQueryDto,
  CustomerServiceRequestPortalQueryDto,
  ConvertCustomerServiceRequestDto,
} from './customer-service-request.dto';
import type {
  CustomerServiceRequestStatus,
  InternalCustomerServiceRequestActor,
} from './customer-service-request.types';
import { CustomerServiceRequestPolicy } from './customer-service-request.policy';

const requestInclude = {
  customer: { select: { id: true, legalName: true, tradeName: true } },
  businessUnit: { select: { id: true, legalName: true, tradeName: true } },
  asset: { select: { id: true, name: true, identifier: true } },
  assignedTo: { select: { id: true, displayName: true } },
  convertedOperation: { select: { id: true, code: true, status: true } },
  createdByPortalIdentity: { select: { id: true, displayName: true } },
  events: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.CustomerServiceRequestInclude;

const listInclude = {
  asset: { select: { id: true, name: true, identifier: true } },
} satisfies Prisma.CustomerServiceRequestInclude;

@Injectable()
export class CustomerServiceRequestRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly policy: CustomerServiceRequestPolicy,
    private readonly operations: OperationRepository,
  ) {}

  portalList(
    actor: CustomerPortalActor,
    query: CustomerServiceRequestPortalQueryDto,
  ) {
    return this.rls.run(async (tx) => {
      const where: Prisma.CustomerServiceRequestWhereInput = {
        organizationId: actor.organizationId,
        customerId: actor.customerId,
        createdByPortalIdentityId: actor.identityId,
        status: query.status,
        category: query.category,
      };
      const data = await tx.customerServiceRequest.findMany({
        where,
        include: listInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const total = await tx.customerServiceRequest.count({ where });
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  internalList(
    actor: InternalCustomerServiceRequestActor,
    query: CustomerServiceRequestInternalQueryDto,
  ) {
    return this.rls.run(async (tx) => {
      const where: Prisma.CustomerServiceRequestWhereInput = {
        organizationId: actor.organizationId,
        status: query.status,
        category: query.category,
        customerId: query.customerId,
        businessUnitId: query.businessUnitId,
        assignedToUserId: query.assignedToUserId,
        ...(query.search
          ? {
              OR: [
                {
                  code: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  subject: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  customer: {
                    legalName: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
                {
                  customer: {
                    tradeName: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
      };
      const data = await tx.customerServiceRequest.findMany({
        where,
        include: listInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const total = await tx.customerServiceRequest.count({ where });
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  findPortal(actor: CustomerPortalActor, id: string) {
    return this.rls.run((tx) =>
      tx.customerServiceRequest.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          customerId: actor.customerId,
          createdByPortalIdentityId: actor.identityId,
        },
        include: requestInclude,
      }),
    );
  }

  findInternal(actor: InternalCustomerServiceRequestActor, id: string) {
    return this.rls.run((tx) =>
      tx.customerServiceRequest.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: requestInclude,
      }),
    );
  }

  createPortal(
    actor: CustomerPortalActor,
    input: {
      category: string;
      subject: string;
      description: string;
      assetId?: string;
    },
    idempotencyKey: string,
    payloadHash: string,
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:create:${actor.identityId}:${idempotencyKey}`);
      const previous = await tx.customerServiceRequest.findUnique({
        where: {
          createdByPortalIdentityId_createIdempotencyKey: {
            createdByPortalIdentityId: actor.identityId,
            createIdempotencyKey: idempotencyKey,
          },
        },
        include: requestInclude,
      });
      if (previous) {
        if (previous.createPayloadHash !== payloadHash) {
          throw new ConflictException(
            'Idempotency-Key was already used with another payload',
            'IDEMPOTENCY_MISMATCH',
          );
        }
        return previous;
      }

      let businessUnitId: string | null = null;
      if (input.assetId) {
        const asset = await tx.asset.findFirst({
          where: {
            id: input.assetId,
            organizationId: actor.organizationId,
            customerId: actor.customerId,
            deletedAt: null,
          },
          select: { businessUnitId: true },
        });
        if (!asset) throw new EntityNotFoundException('Asset', input.assetId);
        businessUnitId = asset.businessUnitId;
      }

      const identity = await tx.customerPortalIdentity.findFirst({
        where: {
          id: actor.identityId,
          organizationId: actor.organizationId,
          customerId: actor.customerId,
          status: 'ACTIVE',
        },
        select: { displayName: true },
      });
      if (!identity)
        throw new EntityNotFoundException('Customer Portal identity');

      const id = generateUuidV7();
      const code = `CH-${new Date().getUTCFullYear()}-${id.replaceAll('-', '').slice(-10).toUpperCase()}`;
      const created = await tx.customerServiceRequest.create({
        data: {
          id,
          organizationId: actor.organizationId,
          customerId: actor.customerId,
          createdByPortalIdentityId: actor.identityId,
          businessUnitId,
          assetId: input.assetId,
          code,
          category: input.category,
          subject: input.subject,
          description: input.description,
          createIdempotencyKey: idempotencyKey,
          createPayloadHash: payloadHash,
          events: {
            create: {
              organizationId: actor.organizationId,
              visibility: 'PORTAL',
              type: 'CREATED',
              actorType: 'CUSTOMER_PORTAL',
              portalIdentityId: actor.identityId,
              actorDisplayName: identity.displayName,
              toStatus: 'OPEN',
            },
          },
        },
        include: requestInclude,
      });
      await this.audit(tx, created, null, 'customer_service_request.created', {
        category: created.category,
        customerId: created.customerId,
      });
      return created;
    });
  }

  cancelPortal(
    actor: CustomerPortalActor,
    id: string,
    expectedVersion: number,
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:${id}`);
      const current = await tx.customerServiceRequest.findFirst({
        where: {
          id,
          organizationId: actor.organizationId,
          customerId: actor.customerId,
          createdByPortalIdentityId: actor.identityId,
        },
        include: { createdByPortalIdentity: { select: { displayName: true } } },
      });
      if (!current)
        throw new EntityNotFoundException('Customer service request', id);
      if (current.status === 'CANCELLED')
        return this.getWithin(tx, id, actor.organizationId);
      this.policy.assertVersion(current.version, expectedVersion);
      this.policy.assertPortalCancellation(
        current.status as CustomerServiceRequestStatus,
        Boolean(current.convertedOperationId),
      );
      const now = new Date();
      const updated = await tx.customerServiceRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          cancelledAt: now,
          closedAt: now,
        },
      });
      await this.event(tx, updated, {
        visibility: 'PORTAL',
        type: 'CANCELLED',
        actorType: 'CUSTOMER_PORTAL',
        portalIdentityId: actor.identityId,
        actorDisplayName: current.createdByPortalIdentity.displayName,
        fromStatus: current.status,
        toStatus: 'CANCELLED',
      });
      await this.audit(
        tx,
        updated,
        null,
        'customer_service_request.cancelled',
        { fromStatus: current.status },
      );
      return this.getWithin(tx, id, actor.organizationId);
    });
  }

  changeStatus(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    expectedVersion: number,
    status: CustomerServiceRequestStatus,
    message?: string,
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:${id}`);
      const current = await this.requireWithin(tx, id, actor.organizationId);
      this.policy.assertVersion(current.version, expectedVersion);
      this.policy.assertTransition(
        current.status as CustomerServiceRequestStatus,
        status,
      );
      const terminal = ['RESOLVED', 'REJECTED', 'CANCELLED'].includes(status);
      const updated = await tx.customerServiceRequest.update({
        where: { id },
        data: {
          status,
          version: { increment: 1 },
          closedAt: terminal ? new Date() : null,
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
        },
      });
      const actorName = await this.internalActorName(tx, actor.actorId);
      await this.event(tx, updated, {
        visibility: 'PORTAL',
        type: 'STATUS_CHANGED',
        actorType: 'INTERNAL_USER',
        internalUserId: actor.actorId,
        actorDisplayName: actorName,
        message,
        fromStatus: current.status,
        toStatus: status,
      });
      await this.audit(
        tx,
        updated,
        actor.actorId,
        'customer_service_request.status_changed',
        { fromStatus: current.status, toStatus: status },
      );
      return this.getWithin(tx, id, actor.organizationId);
    });
  }

  triage(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    expectedVersion: number,
    input: { category?: string; assetId?: string },
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:${id}`);
      const current = await this.requireWithin(tx, id, actor.organizationId);
      this.policy.assertVersion(current.version, expectedVersion);
      this.policy.assertTransition(
        current.status as CustomerServiceRequestStatus,
        'IN_TRIAGE',
      );
      let businessUnitId = current.businessUnitId;
      if (input.assetId) {
        const asset = await tx.asset.findFirst({
          where: {
            id: input.assetId,
            organizationId: actor.organizationId,
            customerId: current.customerId,
            deletedAt: null,
          },
          select: { businessUnitId: true },
        });
        if (!asset || !actor.businessUnitIds.includes(asset.businessUnitId)) {
          throw new EntityNotFoundException('Asset', input.assetId);
        }
        businessUnitId = asset.businessUnitId;
      }
      const updated = await tx.customerServiceRequest.update({
        where: { id },
        data: {
          status: 'IN_TRIAGE',
          category: input.category,
          assetId: input.assetId,
          businessUnitId,
          version: { increment: 1 },
        },
      });
      await this.event(tx, updated, {
        visibility: 'PORTAL',
        type: 'STATUS_CHANGED',
        actorType: 'INTERNAL_USER',
        internalUserId: actor.actorId,
        actorDisplayName: await this.internalActorName(tx, actor.actorId),
        fromStatus: current.status,
        toStatus: 'IN_TRIAGE',
      });
      await this.audit(
        tx,
        updated,
        actor.actorId,
        'customer_service_request.triaged',
        {
          category: updated.category,
          assetId: updated.assetId,
        },
      );
      return this.getWithin(tx, id, actor.organizationId);
    });
  }

  assign(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    expectedVersion: number,
    userId: string,
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:${id}`);
      const current = await this.requireWithin(tx, id, actor.organizationId);
      this.policy.assertVersion(current.version, expectedVersion);
      const membership = await tx.organizationMembership.findFirst({
        where: {
          organizationId: actor.organizationId,
          userId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        include: { user: { select: { displayName: true } } },
      });
      if (!membership)
        throw new EntityNotFoundException('Active organization member', userId);
      const updated = await tx.customerServiceRequest.update({
        where: { id },
        data: { assignedToUserId: userId, version: { increment: 1 } },
      });
      await this.event(tx, updated, {
        visibility: 'PORTAL',
        type: 'ASSIGNED',
        actorType: 'INTERNAL_USER',
        internalUserId: actor.actorId,
        actorDisplayName: await this.internalActorName(tx, actor.actorId),
        message: `Responsável: ${membership.user.displayName}`,
      });
      await this.audit(
        tx,
        updated,
        actor.actorId,
        'customer_service_request.assigned',
        { assignedToUserId: userId },
      );
      return this.getWithin(tx, id, actor.organizationId);
    });
  }

  addMessage(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    expectedVersion: number,
    message: string,
    visibility: 'PORTAL' | 'INTERNAL',
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:${id}`);
      const current = await this.requireWithin(tx, id, actor.organizationId);
      this.policy.assertVersion(current.version, expectedVersion);
      const updated = await tx.customerServiceRequest.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.event(tx, updated, {
        visibility,
        type: visibility === 'PORTAL' ? 'PUBLIC_RESPONSE' : 'INTERNAL_NOTE',
        actorType: 'INTERNAL_USER',
        internalUserId: actor.actorId,
        actorDisplayName: await this.internalActorName(tx, actor.actorId),
        message,
      });
      await this.audit(
        tx,
        updated,
        actor.actorId,
        visibility === 'PORTAL'
          ? 'customer_service_request.public_response_added'
          : 'customer_service_request.internal_note_added',
        { visibility },
      );
      return this.getWithin(tx, id, actor.organizationId);
    });
  }

  convert(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    input: ConvertCustomerServiceRequestDto,
    idempotencyKey: string,
    payloadHash: string,
  ) {
    return this.rls.run(async (tx) => {
      await this.lock(tx, `csr:${id}`);
      const current = await this.requireWithin(tx, id, actor.organizationId);
      if (current.convertedOperationId) {
        if (
          current.conversionIdempotencyKey === idempotencyKey &&
          current.conversionPayloadHash === payloadHash
        ) {
          return this.getWithin(tx, id, actor.organizationId);
        }
        throw new ConflictException(
          'Request already has a canonical Operation',
          'REQUEST_ALREADY_CONVERTED',
        );
      }
      this.policy.assertVersion(current.version, input.expectedVersion);
      this.policy.assertConvertible(
        current.status as CustomerServiceRequestStatus,
        false,
      );
      if (!actor.businessUnitIds.includes(input.businessUnitId))
        throw new EntityNotFoundException(
          'Business unit',
          input.businessUnitId,
        );
      if (
        current.businessUnitId &&
        current.businessUnitId !== input.businessUnitId
      ) {
        throw new ConflictException(
          'Operation Business Unit must match the request asset scope',
          'BUSINESS_UNIT_SCOPE_MISMATCH',
        );
      }
      const businessUnit = await tx.businessUnit.findFirst({
        where: {
          id: input.businessUnitId,
          organizationId: actor.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!businessUnit)
        throw new EntityNotFoundException(
          'Business unit',
          input.businessUnitId,
        );

      const operation = await this.operations.createWithin(
        tx,
        {
          organizationId: actor.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: current.customerId,
          code: input.code,
          kind: input.kind,
          title: input.title,
          description: input.description,
          createdById: actor.actorId,
          data: {
            source: {
              type: 'CUSTOMER_SERVICE_REQUEST',
              id: current.id,
              code: current.code,
            },
          },
        },
        actor.actorId,
        {
          source: 'CUSTOMER_SERVICE_REQUEST',
          sourceId: current.id,
          sourceCode: current.code,
        },
        [],
        /** O equipamento da solicitação entra como o único do atendimento. */
        current.assetId ? [current.assetId] : [],
      );
      const updated = await tx.customerServiceRequest.update({
        where: { id },
        data: {
          businessUnitId: input.businessUnitId,
          convertedOperationId: operation.id,
          conversionIdempotencyKey: idempotencyKey,
          conversionPayloadHash: payloadHash,
          status: 'IN_PROGRESS',
          version: { increment: 1 },
        },
      });
      await this.event(tx, updated, {
        visibility: 'PORTAL',
        type: 'OPERATION_LINKED',
        actorType: 'INTERNAL_USER',
        internalUserId: actor.actorId,
        actorDisplayName: await this.internalActorName(tx, actor.actorId),
        fromStatus: current.status,
        toStatus: 'IN_PROGRESS',
        message: `Atendimento operacional ${operation.code} criado`,
        metadata: { operationId: operation.id },
      });
      await this.audit(
        tx,
        updated,
        actor.actorId,
        'customer_service_request.operation_created',
        { operationId: operation.id },
      );
      return this.getWithin(tx, id, actor.organizationId);
    });
  }

  private requireWithin(
    tx: PrismaTransactionClient,
    id: string,
    organizationId: string,
  ) {
    return tx.customerServiceRequest
      .findFirst({ where: { id, organizationId } })
      .then((value) => {
        if (!value)
          throw new EntityNotFoundException('Customer service request', id);
        return value;
      });
  }

  private getWithin(
    tx: PrismaTransactionClient,
    id: string,
    organizationId: string,
  ) {
    return tx.customerServiceRequest.findFirstOrThrow({
      where: { id, organizationId },
      include: requestInclude,
    });
  }

  private async internalActorName(
    tx: PrismaTransactionClient,
    userId: string,
  ): Promise<string> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? 'Equipe Orbit';
  }

  private event(
    tx: PrismaTransactionClient,
    request: { id: string; organizationId: string },
    data: {
      visibility: string;
      type: string;
      actorType: string;
      actorDisplayName: string;
      portalIdentityId?: string;
      internalUserId?: string;
      message?: string;
      fromStatus?: string;
      toStatus?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return tx.customerServiceRequestEvent.create({
      data: {
        organizationId: request.organizationId,
        requestId: request.id,
        visibility: data.visibility,
        type: data.type,
        actorType: data.actorType,
        actorDisplayName: data.actorDisplayName,
        portalIdentityId: data.portalIdentityId,
        internalUserId: data.internalUserId,
        message: data.message,
        fromStatus: data.fromStatus,
        toStatus: data.toStatus,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  private audit(
    tx: PrismaTransactionClient,
    request: {
      id: string;
      organizationId: string;
      businessUnitId: string | null;
    },
    userId: string | null,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: request.organizationId,
        businessUnitId: userId ? request.businessUnitId : null,
        userId,
        action,
        entityType: 'CUSTOMER_SERVICE_REQUEST',
        entityId: request.id,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private lock(tx: PrismaTransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}
