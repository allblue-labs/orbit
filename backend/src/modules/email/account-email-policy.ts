import type { PrismaTransactionClient } from '../../database/prisma.types';
export interface AccountEmailOwner {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  verifiedAt: Date | null;
}
/** Positive initial-owner provenance, never a role key or an untrusted email suffix. */
export async function accountEmailOwner(
  tx: PrismaTransactionClient,
  userId: string,
): Promise<AccountEmailOwner | null> {
  const rows = await tx.$queryRaw<
    AccountEmailOwner[]
  >`SELECT user_id AS "userId",organization_id AS "organizationId",email,display_name AS "displayName",verified_at AS "verifiedAt" FROM app_account_email_owner(${userId}::uuid)`;
  const owner = rows[0];
  if (!owner) return null;
  return owner;
}
export const ACCOUNT_EMAIL_PURPOSES = [
  'PASSWORD_CHANGED',
  'PLAN_EXPIRED',
  'PLAN_LIMIT_REACHED',
] as const;
export type AccountEmailPurpose = (typeof ACCOUNT_EMAIL_PURPOSES)[number];
export const isAccountEmailPurpose = (
  value: string,
): value is AccountEmailPurpose =>
  (ACCOUNT_EMAIL_PURPOSES as readonly string[]).includes(value);
