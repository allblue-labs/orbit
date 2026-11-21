import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database';

export type ChallengePurpose =
  'USER_REGISTER' | 'USER_LOGIN' | 'PORTAL_REGISTER' | 'PORTAL_LOGIN';

const TTL_MS = 5 * 60_000;

/**
 * Desafios WebAuthn: um uso, cinco minutos.
 *
 * Ficam no banco, não na memória, para valer com mais de uma réplica. O
 * consumo é um UPDATE condicional: duas respostas para o mesmo desafio, só uma
 * passa — repetir uma assinatura capturada não abre sessão.
 */
@Injectable()
export class AuthChallengeStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Guarda o desafio que a biblioteca gerou nas opções; devolve o id. */
  async issue(
    purpose: ChallengePurpose,
    subjectId: string | null,
    challenge: string,
  ): Promise<string> {
    const id = randomUUID();
    await this.prisma.$executeRaw`
      DELETE FROM auth_challenges WHERE expires_at < clock_timestamp() - interval '1 hour'`;
    await this.prisma.authChallenge.create({
      data: {
        id,
        purpose,
        challenge,
        subjectId,
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
    return id;
  }

  /** O desafio, se ainda valer para este propósito e sujeito; queima-o. */
  async consume(
    id: string,
    purpose: ChallengePurpose,
    subjectId: string | null,
  ): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ challenge: string }[]>`
      UPDATE auth_challenges SET consumed_at = clock_timestamp()
       WHERE id = ${id}::uuid AND purpose = ${purpose}
         AND subject_id IS NOT DISTINCT FROM ${subjectId}::uuid
         AND consumed_at IS NULL AND expires_at > clock_timestamp()
      RETURNING challenge`;
    return rows[0]?.challenge ?? null;
  }
}
