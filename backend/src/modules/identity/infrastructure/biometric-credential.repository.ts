import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database';

export interface UserBiometricCredential {
  id: string;
  userId: string;
  kind: 'DEVICE' | 'WEBAUTHN';
  label: string;
  secretHash: string | null;
  webauthnCredentialId: string | null;
  publicKey: Uint8Array | null;
  signCount: number;
  transports: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Credenciais biométricas da equipe. Sem RLS, como `sessions`: o login não
 * tem organização no contexto, e toda leitura aqui é por id da credencial ou
 * do próprio usuário autenticado.
 */
@Injectable()
export class BiometricCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(userId: string): Promise<UserBiometricCredential[]> {
    const rows = await this.prisma.identityBiometricCredential.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toModel(row));
  }

  async findActive(where: {
    id?: string;
    webauthnCredentialId?: string;
  }): Promise<UserBiometricCredential | null> {
    const row = await this.prisma.identityBiometricCredential.findFirst({
      where: { ...where, revokedAt: null },
    });
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
    await this.prisma.identityBiometricCredential.create({
      data: {
        ...input,
        kind: 'WEBAUTHN',
        publicKey: Buffer.from(input.publicKey),
        signCount: BigInt(input.signCount),
      },
    });
  }

  /** Um aparelho, uma credencial: cadastrar de novo substitui a anterior. */
  async replaceDevice(input: {
    id: string;
    userId: string;
    label: string;
    deviceId: string;
    secretHash: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
        data: { ...input, kind: 'DEVICE' },
      });
    });
  }

  /**
   * Marca o uso. Com `expectedSecretHash`, troca o segredo só se o antigo
   * ainda for o atual — duas tentativas com o mesmo segredo, uma vence.
   */
  async markUsed(
    id: string,
    change: {
      expectedSecretHash?: string;
      newSecretHash?: string;
      signCount?: number;
    },
  ): Promise<boolean> {
    const result = await this.prisma.identityBiometricCredential.updateMany({
      where: {
        id,
        revokedAt: null,
        ...(change.expectedSecretHash
          ? { secretHash: change.expectedSecretHash }
          : {}),
      },
      data: {
        lastUsedAt: new Date(),
        ...(change.newSecretHash ? { secretHash: change.newSecretHash } : {}),
        ...(change.signCount !== undefined
          ? { signCount: BigInt(change.signCount) }
          : {}),
      },
    });
    return result.count === 1;
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.identityBiometricCredential.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  private toModel(row: {
    id: string;
    userId: string;
    kind: string;
    label: string;
    secretHash: string | null;
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
