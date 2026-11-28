import type { PrismaService } from '../prisma.service';
import type { PrismaTransactionClient } from '../prisma.types';

export function withIdentity<T>(
  prisma: PrismaService,
  userId: string,
  work: (tx: PrismaTransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return work(tx);
  });
}

export async function resolveIdentityUser(
  tx: PrismaTransactionClient,
  normalizedEmail: string,
): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ id: string | null }[]>`
    SELECT public.app_identity_user_by_email(${normalizedEmail}) AS id`;
  return row?.id ?? null;
}
