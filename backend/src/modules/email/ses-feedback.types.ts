export type FeedbackKind =
  'HARD_BOUNCE' | 'SOFT_BOUNCE' | 'COMPLAINT' | 'DELIVERY' | 'IGNORED';
export interface SesFeedback {
  sesMessageId: string;
  outboundId?: string;
  source: string;
  destination: string[];
  recipients: string[];
  kind: FeedbackKind;
  occurredAt: Date;
}

/** Safe machine code only; never wrap raw AWS, parser, URL or database messages. */
export class SesFeedbackError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 409 | 503,
  ) {
    super(code);
  }
}
