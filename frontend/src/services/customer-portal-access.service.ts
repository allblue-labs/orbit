/**
 * O acesso do cliente ao app, como o owner cria e mantém.
 *
 * Espelho de `CustomerPortalManagementController`. O domínio do e-mail e a
 * senha temporária são decididos no servidor; daqui só sai a parte local.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { RequestOptions } from "@/types/api";
import type {
  CustomerAccess,
  CustomerAccessCredentials,
} from "@/types/customer-portal-access";

const base = (customerId: string) =>
  `/customers/${encodeURIComponent(customerId)}/portal`;
const identity = (customerId: string, identityId: string) =>
  `${base(customerId)}/identities/${encodeURIComponent(identityId)}`;

export const customerPortalAccessService = {
  keys: {
    access: (customerId: string): QueryKey => [
      ...queryKeys.detail("customers", customerId),
      "portal-access",
    ],
  },

  get: (customerId: string, options?: RequestOptions) =>
    apiClient.get<CustomerAccess>(`${base(customerId)}/access`, options),

  create: (customerId: string, localPart: string) =>
    apiClient.post<CustomerAccessCredentials>(`${base(customerId)}/access`, {
      localPart,
    }),

  resetPassword: (customerId: string, identityId: string) =>
    apiClient.post<CustomerAccessCredentials>(
      `${identity(customerId, identityId)}/password`,
    ),

  disable: (customerId: string, identityId: string) =>
    apiClient.post<void>(`${identity(customerId, identityId)}/disable`),
};
