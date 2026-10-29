export type QuoteCustomerDecision = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
export interface QuoteAcceptanceSnapshot {
  code: string;
  title: string;
  introText: string | null;
  notes: string | null;
  customerName: string;
  emitterName: string;
  validUntil: string | null;
  currency: string;
  subtotal: string;
  discount: string;
  total: string;
  serviceAddress: string | null;
  equipment: readonly {
    name: string;
    identifier: string | null;
    location: string | null;
  }[];
  items: readonly {
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discount: string;
    total: string;
    notes: string | null;
  }[];
}
export interface QuoteAcceptanceReadModel {
  state: 'AVAILABLE' | 'COMPLETED' | 'EXPIRED' | 'REVOKED' | 'UPDATED';
  proposal: QuoteAcceptanceSnapshot | null;
  expiresAt: string;
  response: {
    decision: QuoteCustomerDecision;
    signerName: string;
    respondedAt: string;
    reason: string | null;
  } | null;
}
export interface QuoteAcceptanceLinkReadModel {
  token: string;
  expiresAt: string;
  code: string;
}
export interface QuoteCustomerResponseReadModel {
  state: string;
  expiresAt: string;
  decision: QuoteCustomerDecision | null;
  signerName: string | null;
  respondedAt: string | null;
  reason: string | null;
}
