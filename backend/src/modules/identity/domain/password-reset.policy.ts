/** Applies to recovery, initial password setup and manually shared team links. */
export const PASSWORD_RESET_TTL_MS = 3 * 60 * 60_000;
export const PASSWORD_RESET_INVALID_MESSAGE =
  'Este link de recuperação é inválido, expirou ou já foi utilizado. Solicite um novo link.';

export function usablePasswordReset(
  reset: { usedAt: Date | null; expiresAt: Date; createdAt: Date } | null,
  now = Date.now(),
): boolean {
  return Boolean(
    reset &&
    !reset.usedAt &&
    reset.expiresAt.getTime() > now &&
    reset.createdAt.getTime() > now - PASSWORD_RESET_TTL_MS,
  );
}
