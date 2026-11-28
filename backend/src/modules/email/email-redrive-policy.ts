/** Definitive rejections that an operator can resolve by fixing SES configuration. */
export const canRedriveRejectedEmail = (code: string | null): boolean =>
  code === 'SES_IDENTITY_NOT_VERIFIED' ||
  code === 'SES_SENDING_PAUSED' ||
  code === 'SES_ACCESS_DENIED' ||
  code === 'SES_ACCOUNT_SUSPENDED' ||
  code === 'AWS_CREDENTIALS_REJECTED' ||
  code === 'AWS_CREDENTIALS_EXPIRED';
