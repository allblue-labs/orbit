export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export type EmailSendResult =
  | { status: 'SENT'; provider: 'ses'; providerMessageId?: string }
  | { status: 'SKIPPED'; provider: 'noop' }
  | {
      status: 'FAILED';
      provider: 'ses';
      code: string;
      retryable: boolean;
    };
