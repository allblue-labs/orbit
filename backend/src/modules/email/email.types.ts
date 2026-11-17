export interface EmailInlineImage {
  readonly contentId: string;
  readonly fileName: string;
  readonly contentType: 'image/png';
  readonly content: Uint8Array;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  inlineImages?: readonly EmailInlineImage[];
  identityDeliveryId?: string;
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
