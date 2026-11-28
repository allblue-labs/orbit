import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database';

export type ChallengePurpose =
  | 'USER_REGISTER'
  | 'USER_LOGIN'
  | 'PORTAL_REGISTER'
  | 'PORTAL_LOGIN'
  | 'USER_DEVICE_REGISTER'
  | 'USER_DEVICE_LOGIN'
  | 'PORTAL_DEVICE_REGISTER'
  | 'PORTAL_DEVICE_LOGIN'
  | 'USER_SECURITY_CONFIRMATION'
  | 'PORTAL_SECURITY_CONFIRMATION';

const TTL_MS = 5 * 60_000;

/**
 * Desafios de autenticação com validade de cinco minutos e uso único.
 *
 * Ficam no banco, não na memória, para valer com mais de uma réplica. O
 * consumo é um UPDATE condicional: duas respostas para o mesmo desafio, só uma
 * passa — repetir uma assinatura capturada não abre sessão.
 */
@Injectable()
export class AuthChallengeStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Persiste o desafio para verificação posterior e devolve seu ID. */
  async issue(
    purpose: ChallengePurpose,
    subjectId: string | null,
    challenge: string,
  ): Promise<string> {
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.auth_challenge_id', ${id}, true)`;
      await tx.authChallenge.create({
        data: {
          id,
          purpose,
          challenge,
          subjectId,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    });
    return id;
  }

  /** O desafio, se ainda valer para este propósito e sujeito; queima-o. */
  async consume(
    id: string,
    purpose: ChallengePurpose,
    subjectId: string | null,
    expectedChallenge: string | null = null,
  ): Promise<string | null> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.auth_challenge_id', ${id}, true)`;
      return tx.$queryRaw<{ challenge: string }[]>`
      UPDATE auth_challenges SET consumed_at = clock_timestamp()
       WHERE id = ${id}::uuid AND purpose = ${purpose}
         AND subject_id IS NOT DISTINCT FROM ${subjectId}::uuid
         AND consumed_at IS NULL AND expires_at > clock_timestamp()
         AND (${expectedChallenge}::text IS NULL OR challenge = ${expectedChallenge})
      RETURNING challenge`;
    });
    return rows[0]?.challenge ?? null;
  }
}
