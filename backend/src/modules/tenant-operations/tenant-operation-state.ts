export function isOrganizationOperational(
  status: string,
  purgeBlocked: boolean,
) {
  return ['ACTIVE', 'ONBOARDING'].includes(status) && !purgeBlocked;
}
