import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../database';
import { ConflictException, EntityNotFoundException } from '../../exceptions';
import type {
  PortalIdentityRecord,
  PortalSessionRecord,
} from './customer-portal.types';

interface RateLimitRow {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class CustomerPortalRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  async consumeRateLimit(
    action: string,
    scopeHash: string,
    limit: number,
    windowSeconds: number,
    blockSeconds: number,
  ): Promise<RateLimitRow> {
    const rows = await this.prisma.$queryRaw<RateLimitRow[]>`
      SELECT "allowed", "retry_after_seconds"::int AS "retryAfterSeconds"
      FROM app_customer_portal_consume_rate_limit(
        ${action}, ${scopeHash}, ${limit}, ${windowSeconds}, ${blockSeconds}
      )`;
    return rows[0] ?? { allowed: false, retryAfterSeconds: blockSeconds };
  }

  async findLoginIdentity(
    organizationSlug: string,
    normalizedEmail: string,
  ): Promise<PortalIdentityRecord | null> {
    const rows = await this.prisma.$queryRaw<PortalIdentityRecord[]>`
      SELECT * FROM app_customer_portal_find_login(
        ${organizationSlug}, ${normalizedEmail}
      )`;
    return rows[0] ?? null;
  }

  async recordFailedLogin(identityId: string): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT app_customer_portal_record_failed_login(${identityId}::uuid)::text AS "result"`;
  }

  async createSession(data: {
    id: string;
    identityId: string;
    refreshTokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }): Promise<PortalSessionRecord> {
    const rows = await this.prisma.$queryRaw<PortalSessionRecord[]>`
      SELECT * FROM app_customer_portal_create_session(
        ${data.id}::uuid,
        ${data.identityId}::uuid,
        ${data.refreshTokenHash},
        ${data.userAgent ?? null},
        ${data.ipAddress ?? null}::inet,
        ${data.expiresAt}
      )`;
    const record = rows[0];
    if (!record) throw new EntityNotFoundException('Customer portal identity');
    return record;
  }

  async resolveSession(
    sessionId: string,
    identityId: string,
  ): Promise<PortalSessionRecord | null> {
    const rows = await this.prisma.$queryRaw<PortalSessionRecord[]>`
      SELECT * FROM app_customer_portal_resolve_session(
        ${sessionId}::uuid, ${identityId}::uuid
      )`;
    return rows[0] ?? null;
  }

  async findSessionByRefreshHash(
    refreshTokenHash: string,
  ): Promise<PortalSessionRecord | null> {
    const rows = await this.prisma.$queryRaw<PortalSessionRecord[]>`
      SELECT * FROM app_customer_portal_find_refresh(${refreshTokenHash})`;
    return rows[0] ?? null;
  }

  async rotateSession(
    sessionId: string,
    currentHash: string,
    nextHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ rotated: boolean }>>`
      SELECT app_customer_portal_rotate_session(
        ${sessionId}::uuid, ${currentHash}, ${nextHash}, ${expiresAt}
      ) AS "rotated"`;
    return rows[0]?.rotated ?? false;
  }

  async revokeSession(sessionId: string, identityId: string): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT app_customer_portal_revoke_session(
        ${sessionId}::uuid, ${identityId}::uuid
      )`;
  }

  async activateInvitation(
    tokenHash: string,
    passwordHash: string,
  ): Promise<PortalIdentityRecord | null> {
    const rows = await this.prisma.$queryRaw<PortalIdentityRecord[]>`
      SELECT * FROM app_customer_portal_activate_invitation(
        ${tokenHash}, ${passwordHash}
      )`;
    return rows[0] ?? null;
  }

  async createPasswordReset(
    organizationSlug: string,
    normalizedEmail: string,
    resetId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ created: boolean }>>`
      SELECT app_customer_portal_create_password_reset(
        ${organizationSlug}, ${normalizedEmail}, ${resetId}::uuid,
        ${tokenHash}, ${expiresAt}
      ) AS "created"`;
    return rows[0]?.created ?? false;
  }

  async consumePasswordReset(
    tokenHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ consumed: boolean }>>`
      SELECT app_customer_portal_consume_password_reset(
        ${tokenHash}, ${passwordHash}
      ) AS "consumed"`;
    return rows[0]?.consumed ?? false;
  }

  async changePassword(
    identityId: string,
    keepSessionId: string,
    passwordHash: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ changed: boolean }>>`
      SELECT app_customer_portal_change_password(
        ${identityId}::uuid, ${keepSessionId}::uuid, ${passwordHash}
      ) AS "changed"`;
    return rows[0]?.changed ?? false;
  }

  invite(data: {
    organizationId: string;
    customerId: string;
    contactId?: string;
    invitedById: string;
    email: string;
    normalizedEmail: string;
    displayName: string;
    invitationId: string;
    identityId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-invite:${data.organizationId}:${data.normalizedEmail}`}))`;
      const customer = await tx.customer.findFirst({
        where: {
          id: data.customerId,
          organizationId: data.organizationId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!customer) throw new EntityNotFoundException('Customer');
      if (data.contactId) {
        const contact = await tx.contact.findFirst({
          where: {
            id: data.contactId,
            customerId: data.customerId,
            organizationId: data.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!contact) throw new EntityNotFoundException('Customer contact');
      }

      const existing = await tx.customerPortalIdentity.findUnique({
        where: {
          organizationId_normalizedEmail: {
            organizationId: data.organizationId,
            normalizedEmail: data.normalizedEmail,
          },
        },
      });
      if (existing?.status === 'ACTIVE') {
        throw new ConflictException('Portal identity is already active');
      }
      if (existing?.status === 'DISABLED') {
        throw new ConflictException('Portal identity is disabled');
      }
      if (existing && existing.customerId !== data.customerId) {
        throw new ConflictException(
          'Email is already linked to another customer in this organization',
        );
      }

      const identity = existing
        ? await tx.customerPortalIdentity.update({
            where: { id: existing.id },
            data: {
              email: data.email,
              displayName: data.displayName,
              contactId: data.contactId ?? null,
              status: 'INVITED',
            },
          })
        : await tx.customerPortalIdentity.create({
            data: {
              id: data.identityId,
              organizationId: data.organizationId,
              customerId: data.customerId,
              contactId: data.contactId,
              email: data.email,
              normalizedEmail: data.normalizedEmail,
              displayName: data.displayName,
            },
          });
      await tx.customerPortalInvitation.updateMany({
        where: {
          portalIdentityId: identity.id,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      const invitation = await tx.customerPortalInvitation.create({
        data: {
          id: data.invitationId,
          organizationId: data.organizationId,
          customerId: data.customerId,
          portalIdentityId: identity.id,
          invitedById: data.invitedById,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
        },
        include: { identity: true },
      });
      await this.audit(tx, {
        organizationId: data.organizationId,
        userId: data.invitedById,
        action: existing
          ? 'customer.portal.identity.reinvited'
          : 'customer.portal.identity.invited',
        entityId: identity.id,
        metadata: { customerId: data.customerId },
      });
      return invitation;
    });
  }

  disable(
    organizationId: string,
    customerId: string,
    identityId: string,
    actorId: string,
  ): Promise<boolean> {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-identity:${identityId}`}))`;
      const changed = await tx.customerPortalIdentity.updateMany({
        where: { id: identityId, organizationId, customerId },
        data: { status: 'DISABLED', disabledAt: new Date() },
      });
      if (changed.count === 0) return false;
      await tx.customerPortalSession.updateMany({
        where: { portalIdentityId: identityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, {
        organizationId,
        userId: actorId,
        action: 'customer.portal.identity.disabled',
        entityId: identityId,
        metadata: { customerId },
      });
      return true;
    });
  }

  revokeSessions(
    organizationId: string,
    customerId: string,
    identityId: string,
    actorId: string,
  ): Promise<number> {
    return this.rls.run(async (tx) => {
      const identity = await tx.customerPortalIdentity.findFirst({
        where: { id: identityId, organizationId, customerId },
        select: { id: true },
      });
      if (!identity) return 0;
      const result = await tx.customerPortalSession.updateMany({
        where: { portalIdentityId: identityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, {
        organizationId,
        userId: actorId,
        action: 'customer.portal.sessions.revoked',
        entityId: identityId,
        metadata: { customerId, count: result.count },
      });
      return result.count;
    });
  }

  identityExists(
    organizationId: string,
    customerId: string,
    identityId: string,
  ): Promise<boolean> {
    return this.rls.run(async (tx) =>
      Boolean(
        await tx.customerPortalIdentity.findFirst({
          where: { id: identityId, organizationId, customerId },
          select: { id: true },
        }),
      ),
    );
  }

  private audit(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      userId: string;
      action: string;
      entityId: string;
      metadata: Prisma.InputJsonValue;
    },
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        action: data.action,
        entityType: 'CUSTOMER_PORTAL_IDENTITY',
        entityId: data.entityId,
        metadata: data.metadata,
      },
    });
  }
}
