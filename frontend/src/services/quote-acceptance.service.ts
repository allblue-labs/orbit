import { apiClient } from "@/api/client";
import { downloadAndSave } from "@/api/transfer";
import type {
  QuoteAcceptanceReadModel,
  QuoteAcceptanceLinkReadModel,
  QuoteCustomerResponseReadModel,
  QuoteCustomerDecision,
} from "@/types/contracts/modules/quotes/quote-acceptance.read-models";
export type { QuoteCustomerDecision };
const base = (token: string) =>
  `/public/quotes/proposals/${encodeURIComponent(token)}`;
export interface QuoteCustomerReply {
  decision: QuoteCustomerDecision;
  signerName: string;
  signerDocument?: string;
  signerEmail?: string;
  reason?: string;
  consentAccepted?: boolean;
  signatureBase64?: string;
}
export const quoteAcceptanceService = {
  create: (id: string) =>
    apiClient.post<QuoteAcceptanceLinkReadModel>(
      `/quotes/${id}/acceptance-link`,
      {},
    ),
  latest: (id: string) =>
    apiClient.get<QuoteCustomerResponseReadModel | null>(
      `/quotes/${id}/customer-response`,
    ),
  read: (token: string) =>
    apiClient.get<QuoteAcceptanceReadModel>(base(token), { retries: 0 }),
  respond: (token: string, input: QuoteCustomerReply) =>
    apiClient.post<QuoteAcceptanceReadModel>(`${base(token)}/response`, input, {
      retries: 0,
    }),
  document: (token: string) =>
    downloadAndSave(`${base(token)}/document`, { retries: 0 }),
};
