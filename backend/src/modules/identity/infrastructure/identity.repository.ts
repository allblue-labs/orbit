import { IdentityEmailOutbox } from './identity-email.outbox';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import {
  UnauthorizedException,
  ValidationException,
} from '../../../exceptions';

export interface RefreshSession {
  id: string;
  userId: string;
  client: string;
  refreshTokenHash: string;
  rotationResponse: string | null;
  inGrace: boolean;
}

const identityInclude = {
  credential: true,
  mfaFactors: { where: { verifiedAt: { not: null }, deletedAt: null } },
  platformRoleAssignments: {
    where: { revokedAt: null },
    include: { role: true },
  },
  organizationMemberships: {
    where: { status: 'ACTIVE', deletedAt: null },
    include: { role: true },
  },
  businessUnitMemberships: {
    where: { status: 'ACTIVE', deletedAt: null },
    include: { role: true },
  },
} satisfies Prisma.UserInclude;

export type IdentityUser = Prisma.UserGetPayload<{
  include: typeof identityInclude;
}> & {
  readonly isOrganizationOwner: boolean;
  readonly effectiveBusinessUnitIds: readonly string[];
};

@Injectable()
export class IdentityRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailOutbox: IdentityEmailOutbox,
  ) {}

  async findByEmail(email: string): Promise<IdentityUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail },
      select: { id: true },
    });
    return user ? this.findIdentity(user.id) : null;
  }

  findById(id: string): Promise<IdentityUser | null> {
    return this.findIdentity(id);
  }

  hasActivePlatformRole(userId: string, roleKey: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.user_id', userId);
      const assignment = await transaction.platformRoleAssignment.findFirst({
        where: {
          userId,
          revokedAt: null,
          role: {
            key: roleKey,
            organizationId: null,
            deletedAt: null,
          },
        },
        select: { id: true },
      });
      return Boolean(assignment);
    });
  }

  private findIdentity(id: string): Promise<IdentityUser | null> {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.user_id', id);
      await this.setLocal(transaction, 'app.is_platform_admin', 'false');
      const organization = await transaction.organizationMembership.findFirst({
        where: { userId: id, status: 'ACTIVE', deletedAt: null },
        select: { organizationId: true },
        orderBy: { joinedAt: 'asc' },
      });
      await this.setLocal(
        transaction,
        'app.organization_id',
        organization?.organizationId ?? '',
      );
      const organizationRow = organization
        ? await transaction.organization.findUnique({
            where: { id: organization.organizationId },
            select: { ownerUserId: true },
          })
        : null;
      const isOrganizationOwner = organizationRow?.ownerUserId === id;
      const units = isOrganizationOwner
        ? await transaction.businessUnit.findMany({
            where: {
              organizationId: organization?.organizationId,
              status: 'ACTIVE',
              deletedAt: null,
            },
            select: { id: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          })
        : await transaction.businessUnitMembership.findMany({
            where: {
              userId: id,
              organizationId: organization?.organizationId,
              status: 'ACTIVE',
              deletedAt: null,
            },
            select: { businessUnitId: true },
          });
      const unitIds = units.map((unit) =>
        'businessUnitId' in unit ? unit.businessUnitId : unit.id,
      );
      await this.setLocal(
        transaction,
        'app.business_unit_ids',
        unitIds.join(','),
      );
      const user = await transaction.user.findUnique({
        where: { id },
        include: identityInclude,
      });
      return user
        ? { ...user, isOrganizationOwner, effectiveBusinessUnitIds: unitIds }
        : null;
    });
  }

  async updateFailedLogin(
    credentialId: string,
    expectedPasswordHash: string,
  ): Promise<void> {
    // Increment the current row, never the snapshot read before password/MFA
    // verification. A late attempt against an old password cannot re-lock it.
    await this.prisma.$executeRaw`
      UPDATE credentials SET
        failed_attempts = CASE WHEN locked_until <= clock_timestamp() THEN 1 ELSE failed_attempts + 1 END,
        locked_until = CASE
          WHEN (CASE WHEN locked_until <= clock_timestamp() THEN 1 ELSE failed_attempts + 1 END) >= 5
          THEN clock_timestamp() + interval '15 minutes' ELSE NULL END,
        updated_at = clock_timestamp()
      WHERE id = ${credentialId}::uuid AND password_hash = ${expectedPasswordHash}
        AND (locked_until IS NULL OR locked_until <= clock_timestamp())`;
  }

  findCredential(userId: string) {
    return this.prisma.credential.findUnique({ where: { userId } });
  }

  /**
   * Troca a senha de quem já está autenticado.
   *
   * **Revoga todas as sessões**, exceto a atual — é o mesmo comportamento do
   * reset por e-mail, e pelo mesmo motivo: se a senha mudou, quem estava com
   * a antiga não deve continuar dentro. A sessão atual sobrevive para que a
   * pessoa não seja expulsa da tela em que acabou de agir.
   */
  changePassword(
    userId: string,
    passwordHash: string,
    keepSessionId?: string,
  ): Promise<void> {
    return this.prisma
      .$transaction(async (transaction) => {
        await transaction.credential.update({
          where: { userId },
          data: {
            passwordHash,
            passwordUpdatedAt: new Date(),
            mustChangePassword: false,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
        await transaction.session.updateMany({
          where: {
            userId,
            revokedAt: null,
            ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
          },
          data: { revokedAt: new Date() },
        });
      })
      .then(() => undefined);
  }

  async completeLogin(
    data: Prisma.SessionUncheckedCreateInput,
    credentialId: string,
    expectedPasswordHash: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.$executeRaw`
        UPDATE credentials SET failed_attempts = 0, locked_until = NULL, updated_at = clock_timestamp()
        WHERE id = ${credentialId}::uuid AND user_id = ${data.userId}::uuid
          AND password_hash = ${expectedPasswordHash}
          AND (locked_until IS NULL OR locked_until <= clock_timestamp())`;
      if (changed !== 1) {
        const current = await tx.credential.findUnique({
          where: { id: credentialId },
        });
        if (
          current?.passwordHash === expectedPasswordHash &&
          current.lockedUntil
        )
          throw new UnauthorizedException(
            'Account temporarily locked',
            'ACCOUNT_LOCKED',
          );
        throw new UnauthorizedException(
          'Invalid credentials',
          'INVALID_CREDENTIALS',
        );
      }
      const user = await tx.user.updateMany({
        where: { id: data.userId, status: 'ACTIVE', deletedAt: null },
        data: { lastAuthenticatedAt: new Date() },
      });
      if (user.count !== 1)
        throw new UnauthorizedException(
          'Invalid credentials',
          'INVALID_CREDENTIALS',
        );
      // Password resets lock this same credential before revoking sessions:
      // either this login loses its comparison or the reset revokes its session.
      await tx.session.create({ data });
    });
  }

  createSession(data: Prisma.SessionUncheckedCreateInput) {
    return this.prisma.session.create({ data });
  }

  findSessionByRefreshHash(refreshTokenHash: string) {
    return this.prisma.session.findUnique({ where: { refreshTokenHash } });
  }

  findSessionById(id: string) {
    return this.prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        client: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  async findRefreshSession(hash: string): Promise<RefreshSession | null> {
    const rows = await this.prisma.$queryRaw<RefreshSession[]>`
      SELECT id, user_id AS "userId", client, refresh_token_hash AS "refreshTokenHash",
        rotation_response AS "rotationResponse",
        COALESCE(rotation_grace_until > clock_timestamp(), false) AS "inGrace"
      FROM sessions
      WHERE (refresh_token_hash = ${hash} OR previous_refresh_token_hash = ${hash})
        AND revoked_at IS NULL AND expires_at > clock_timestamp()`;
    return rows[0] ?? null;
  }

  async rotateSession(
    id: string,
    expectedHash: string,
    refreshTokenHash: string,
    expiresAt: Date,
    encryptedResponse: string,
  ): Promise<boolean> {
    // PostgreSQL rechecks this predicate after waiting for a competing update.
    // Current and previous tokens return the same response throughout grace;
    // a fast successor cannot invalidate a response still in flight.
    const changed = await this.prisma.$executeRaw`
      UPDATE sessions SET refresh_token_hash = ${refreshTokenHash},
        previous_refresh_token_hash = ${expectedHash},
        rotation_response = ${encryptedResponse},
        rotation_grace_until = clock_timestamp() + interval '15 seconds',
        expires_at = ${expiresAt}
      WHERE id = ${id}::uuid AND refresh_token_hash = ${expectedHash}
        AND revoked_at IS NULL AND expires_at > clock_timestamp()
        AND (rotation_grace_until IS NULL OR rotation_grace_until <= clock_timestamp())`;
    return changed === 1;
  }

  revokeSession(id: string): Promise<void> {
    return this.prisma.session
      .updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .then(() => undefined);
  }

  revokeUserSessions(userId: string): Promise<void> {
    return this.prisma.session
      .updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .then(() => undefined);
  }

  findDelegatedRole(
    organizationId: string,
    roleId: string,
    actorId: string,
    businessUnitIds: readonly string[],
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.user_id', actorId);
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      await this.setLocal(
        transaction,
        'app.business_unit_ids',
        businessUnitIds.join(','),
      );
      return transaction.role.findFirst({
        where: { id: roleId, organizationId, deletedAt: null },
      });
    });
  }

  listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // The profile UI is a security overview, not an audit export. A bounded
      // latest-first window prevents an account with years of rotated or
      // revoked sessions from creating an unbounded response.
      take: 100,
      select: {
        id: true,
        client: true,
        deviceId: true,
        userAgent: true,
        ipAddress: true,
        organizationId: true,
        businessUnitId: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  updateProfile(userId: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      omit: { deletedAt: true },
    });
  }

  createEmailVerification(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    emailToken?: string,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.setLocal(tx, 'app.user_id', userId);
      await tx.$executeRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: {
          id: userId,
          status: 'ACTIVE',
          deletedAt: null,
          emailVerifiedAt: null,
        },
        select: { normalizedEmail: true, email: true },
      });
      if (!user) return null;
      const previous = await tx.emailVerificationToken.findUnique({
        where: { userId },
        select: { createdAt: true },
      });
      if (previous && previous.createdAt.getTime() > Date.now() - 60_000)
        return null;
      const data = {
        email: user.normalizedEmail,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: new Date(),
      };
      await tx.emailVerificationToken.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      if (emailToken)
        await this.emailOutbox.enqueueIn(tx, {
          purpose: 'EMAIL_VERIFICATION',
          userId,
          recipient: user.email,
          token: emailToken,
          expiresAt,
        });
      return user.email;
    });
  }

  async confirmEmail(tokenHash: string): Promise<boolean> {
    const [result] = await this.prisma.$queryRaw<
      { confirmed: boolean }[]
    >`SELECT app_confirm_email(${tokenHash}) AS confirmed`;
    return result?.confirmed === true;
  }

  createPasswordReset(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    emailToken?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
      await this.setLocal(transaction, 'app.user_id', userId);
      await transaction.passwordResetToken.deleteMany({ where: { userId } });
      const reset = await transaction.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt },
      });
      if (emailToken) {
        const user = await transaction.user.findUniqueOrThrow({
          where: { id: userId },
          select: { email: true },
        });
        await this.emailOutbox.enqueueIn(transaction, {
          purpose: 'PASSWORD_RESET',
          userId,
          recipient: user.email,
          token: emailToken,
          expiresAt,
        });
      }
      return reset;
    });
  }

  findPasswordReset(tokenHash: string) {
    return this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  consumePasswordReset(
    tokenId: string,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    return this.prisma
      .$transaction(async (transaction) => {
        const consumed = await transaction.passwordResetToken.updateMany({
          where: { id: tokenId, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new ValidationException(
            'Este link de recuperação é inválido, expirou ou já foi utilizado.',
          );
        }
        await transaction.credential.update({
          where: { userId },
          data: {
            passwordHash,
            passwordUpdatedAt: new Date(),
            mustChangePassword: false,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
        await transaction.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      })
      .then(() => undefined);
  }

  createInvitation(
    data: Prisma.IdentityInvitationUncheckedCreateInput,
    emailToken?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(
        transaction,
        'app.organization_id',
        data.organizationId,
      );
      await this.setLocal(
        transaction,
        'app.business_unit_ids',
        data.businessUnitId ?? '',
      );
      await this.setLocal(transaction, 'app.user_id', data.invitedById);
      const role = await transaction.role.findFirst({
        where: {
          id: data.roleId,
          OR: [
            { organizationId: data.organizationId },
            { organizationId: null },
          ],
          deletedAt: null,
        },
      });
      const businessUnit = data.businessUnitId
        ? await transaction.businessUnit.findFirst({
            where: {
              id: data.businessUnitId,
              organizationId: data.organizationId,
              deletedAt: null,
            },
          })
        : null;
      if (!role || (data.businessUnitId && !businessUnit)) {
        throw new Error('Invitation scope is invalid');
      }
      await transaction.identityInvitation.updateMany({
        where: {
          organizationId: data.organizationId,
          normalizedEmail: data.normalizedEmail,
          status: 'PENDING',
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      const invitation = await transaction.identityInvitation.create({ data });
      if (emailToken)
        await this.emailOutbox.enqueueIn(transaction, {
          purpose: 'INVITATION',
          organizationId: invitation.organizationId,
          recipient: invitation.email,
          token: emailToken,
          expiresAt: invitation.expiresAt,
        });
      return invitation;
    });
  }

  findInvitation(tokenHash: string) {
    return this.prisma.identityInvitation.findUnique({ where: { tokenHash } });
  }

  /**
   * Convites da organização.
   *
   * Marca como `EXPIRED` os pendentes cujo prazo passou **antes** de listar —
   * a mesma limpeza que `createInvitation` já fazia. Sem isso, um convite
   * vencido apareceria como pendente até alguém tentar criar outro, e a tela
   * ofereceria "reenviar" para algo que o `accept` já recusa.
   */
  listInvitations(
    organizationId: string,
    query: { status?: string; search?: string; skip: number; take: number },
  ) {
    const where: Prisma.IdentityInvitationWhereInput = {
      organizationId,
      status: query.status,
      ...(query.search
        ? { normalizedEmail: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      await transaction.identityInvitation.updateMany({
        where: {
          organizationId,
          status: 'PENDING',
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED' },
      });

      const data = await transaction.identityInvitation.findMany({
        where,
        include: {
          role: { select: { id: true, key: true, name: true } },
          businessUnit: {
            select: { id: true, legalName: true, tradeName: true },
          },
          invitedBy: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      });
      const total = await transaction.identityInvitation.count({ where });
      return { data, total };
    });
  }

  findInvitationById(id: string, organizationId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      return transaction.identityInvitation.findFirst({
        where: { id, organizationId },
      });
    });
  }

  /** Renova prazo e token de um convite pendente. */
  refreshInvitation(
    id: string,
    organizationId: string,
    data: { tokenHash: string; expiresAt: Date },
    emailToken?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      const changed = await transaction.identityInvitation.updateMany({
        where: {
          id,
          organizationId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        data,
      });
      if (changed.count !== 1)
        throw new ValidationException('Invitation is no longer pending');
      const invitation = await transaction.identityInvitation.findUniqueOrThrow(
        { where: { id } },
      );
      if (emailToken)
        await this.emailOutbox.enqueueIn(transaction, {
          purpose: 'INVITATION',
          organizationId,
          recipient: invitation.email,
          token: emailToken,
          expiresAt: data.expiresAt,
        });
      return invitation;
    });
  }

  /**
   * Cancela um convite.
   *
   * `REVOKED`, não remoção: o registro de que alguém foi convidado e o convite
   * foi retirado é informação de auditoria.
   */
  revokeInvitation(id: string, organizationId: string): Promise<void> {
    return this.prisma
      .$transaction(async (transaction) => {
        await this.setLocal(transaction, 'app.organization_id', organizationId);
        return transaction.identityInvitation.update({
          where: { id },
          data: { status: 'REVOKED' },
        });
      })
      .then(() => undefined);
  }

  acceptInvitation(
    invitationId: string,
    input: {
      email: string;
      normalizedEmail: string;
      firstName: string;
      lastName: string;
      passwordHash: string;
      organizationId: string;
      businessUnitId: string | null;
      roleId: string;
    },
    /**
     * A cota de usuários da plataforma, conferida **aqui dentro**.
     *
     * O aceite é anônimo: fora desta transação a organização nem existe para
     * a política de RLS, e uma contagem feita lá fora voltaria zero. O
     * chamador entrega a verificação; a transação empresta o contexto.
     */
    assertQuota?: (transaction: PrismaTransactionClient) => Promise<void>,
  ): Promise<void> {
    return this.prisma
      .$transaction(async (transaction) => {
        await this.setLocal(
          transaction,
          'app.organization_id',
          input.organizationId,
        );
        await this.setLocal(
          transaction,
          'app.business_unit_ids',
          input.businessUnitId ?? '',
        );
        let user = await transaction.user.findUnique({
          where: { normalizedEmail: input.normalizedEmail },
        });
        user ??= await transaction.user.create({
          data: {
            email: input.email,
            normalizedEmail: input.normalizedEmail,
            firstName: input.firstName,
            lastName: input.lastName,
            displayName: `${input.firstName} ${input.lastName}`.trim(),
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            credential: {
              create: { passwordHash: input.passwordHash },
            },
          },
        });
        await transaction.credential.upsert({
          where: { userId: user.id },
          create: { userId: user.id, passwordHash: input.passwordHash },
          update: {},
        });
        /**
         * Só cobra vaga quem ainda não ocupa uma: reaceitar um convite de
         * quem já é membro ativo não consome uma segunda unidade (§60).
         */
        const jaAtivo = await transaction.organizationMembership.findFirst({
          where: {
            organizationId: input.organizationId,
            userId: user.id,
            status: 'ACTIVE',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!jaAtivo) await assertQuota?.(transaction);

        await transaction.organizationMembership.upsert({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: user.id,
            },
          },
          create: {
            organizationId: input.organizationId,
            userId: user.id,
            roleId: input.roleId,
          },
          update: { roleId: input.roleId, status: 'ACTIVE', deletedAt: null },
        });
        if (input.businessUnitId) {
          await transaction.businessUnitMembership.upsert({
            where: {
              businessUnitId_userId: {
                businessUnitId: input.businessUnitId,
                userId: user.id,
              },
            },
            create: {
              organizationId: input.organizationId,
              businessUnitId: input.businessUnitId,
              userId: user.id,
              roleId: input.roleId,
            },
            update: { roleId: input.roleId, status: 'ACTIVE', deletedAt: null },
          });
        }
        await transaction.identityInvitation.update({
          where: { id: invitationId },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
      })
      .then(() => undefined);
  }

  private setLocal(
    transaction: Prisma.TransactionClient,
    key: string,
    value: string,
  ): Promise<unknown> {
    return transaction.$queryRawUnsafe(
      'SELECT set_config($1, $2, true)',
      key,
      value,
    );
  }

  createMfaFactor(userId: string, encryptedSecret: string) {
    return this.prisma.mfaFactor.create({
      data: { userId, secret: encryptedSecret },
      select: { id: true },
    });
  }

  findMfaFactor(id: string, userId: string) {
    return this.prisma.mfaFactor.findFirst({
      where: { id, userId, deletedAt: null },
    });
  }

  enableMfaFactor(id: string, recoveryCodes: readonly string[]): Promise<void> {
    return this.prisma.mfaFactor
      .update({
        where: { id },
        data: { verifiedAt: new Date(), recoveryCodes: [...recoveryCodes] },
      })
      .then(() => undefined);
  }

  async touchMfaFactor(id: string): Promise<boolean> {
    const result = await this.prisma.mfaFactor.updateMany({
      where: { id, verifiedAt: { not: null }, deletedAt: null },
      data: { lastUsedAt: new Date() },
    });
    return result.count === 1;
  }

  async consumeMfaRecoveryCode(
    id: string,
    matchedHash: string,
  ): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE mfa_factors SET recovery_codes = array_remove(recovery_codes, ${matchedHash}),
        last_used_at = clock_timestamp()
      WHERE id = ${id}::uuid AND verified_at IS NOT NULL AND deleted_at IS NULL
        AND ${matchedHash} = ANY(recovery_codes)`;
    return changed === 1;
  }

  disableMfa(userId: string): Promise<void> {
    return this.prisma.mfaFactor
      .updateMany({
        where: { userId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      .then(() => undefined);
  }
}
