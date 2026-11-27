import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database';
import { withIdentity } from '../../../database/rls/identity-scope';

export interface UserBiometricCredential {
  id: string;
  userId: string;
  kind: 'DEVICE' | 'WEBAUTHN';
  label: string;
  deviceId: string | null;
  webauthnCredentialId: string | null;
  publicKey: Uint8Array | null;
  signCount: number;
  transports: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Injectable()
export class BiometricCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(userId: string): Promise<UserBiometricCredential[]> {
    const rows = await withIdentity(this.prisma, userId, (tx) =>
      tx.identityBiometricCredential.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((row) => this.toModel(row));
  }

  async findActive(where: {
    id?: string;
    webauthnCredentialId?: string;
  }): Promise<UserBiometricCredential | null> {
    const [scope] = await this.prisma.$queryRaw<{ userId: string | null }[]>`
      SELECT public.app_identity_biometric_owner(${where.id ?? null}::uuid, ${where.webauthnCredentialId ?? null}) AS "userId"`;
    if (!scope?.userId) return null;
    const row = await withIdentity(this.prisma, scope.userId, (tx) =>
      tx.identityBiometricCredential.findFirst({
        where: { ...where, revokedAt: null },
      }),
    );
    return row ? this.toModel(row) : null;
  }

  async createWebAuthn(input: {
    id: string;
    userId: string;
    label: string;
    webauthnCredentialId: string;
    publicKey: Uint8Array;
    signCount: number;
    transports: string[];
  }): Promise<void> {
    await withIdentity(this.prisma, input.userId, (tx) =>
      tx.identityBiometricCredential.create({
        data: {
          ...input,
          kind: 'WEBAUTHN',
          publicKey: Buffer.from(input.publicKey),
          signCount: BigInt(input.signCount),
        },
      }),
    );
  }

  /** Um aparelho, uma credencial: cadastrar de novo substitui a anterior. */
  async replaceDevice(input: {
    id: string;
    userId: string;
    label: string;
    deviceId: string;
    publicKey: Uint8Array;
  }): Promise<void> {
    await withIdentity(this.prisma, input.userId, async (tx) => {
      await tx.identityBiometricCredential.updateMany({
        where: {
          userId: input.userId,
          kind: 'DEVICE',
          deviceId: input.deviceId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.identityBiometricCredential.create({
        data: {
          ...input,
          publicKey: Buffer.from(input.publicKey),
          kind: 'DEVICE',
        },
      });
    });
  }

  /** Anota o uso enquanto a credencial ainda estiver ativa. */
  async markUsed(
    id: string,
    userId: string,
    change: {
      signCount?: number;
    },
  ): Promise<boolean> {
    const result = await withIdentity(this.prisma, userId, (tx) =>
      tx.identityBiometricCredential.updateMany({
        where: {
          id,
          userId,
          revokedAt: null,
        },
        data: {
          lastUsedAt: new Date(),
          ...(change.signCount !== undefined
            ? { signCount: BigInt(change.signCount) }
            : {}),
        },
      }),
    );
    return result.count === 1;
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const result = await withIdentity(this.prisma, userId, (tx) =>
      tx.identityBiometricCredential.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
    return result.count === 1;
  }

  private toModel(row: {
    id: string;
    userId: string;
    kind: string;
    label: string;
    deviceId: string | null;
    webauthnCredentialId: string | null;
    publicKey: Uint8Array | null;
    signCount: bigint;
    transports: string[];
    createdAt: Date;
    lastUsedAt: Date | null;
  }): UserBiometricCredential {
    return {
      ...row,
      kind: row.kind === 'WEBAUTHN' ? 'WEBAUTHN' : 'DEVICE',
      publicKey: row.publicKey ? new Uint8Array(row.publicKey) : null,
      signCount: Number(row.signCount),
    };
  }
}
