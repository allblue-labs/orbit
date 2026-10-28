import { apiClient } from "@/api/client";
import type { PaginatedResult, RequestOptions } from "@/types/api";

export interface RecurringAuthorizationItem {
  id: string;
  kind: "RVT" | "PMOC";
  parentId: string;
  code: string;
  title: string;
  scheduledStart: string | null;
  version: string;
  responsibleFieldTechnician: { id: string; displayName: string } | null;
}
export interface RecurringAuthorizationQuery {
  page?: number;
  businessUnitId?: string;
  assignedUserId?: string;
  search?: string;
}
export const recurringAuthorizationsService = {
  list: (query: RecurringAuthorizationQuery, options?: RequestOptions) =>
    apiClient.get<PaginatedResult<RecurringAuthorizationItem>>(
      "/operations/recurring-authorizations",
      { ...options, query: { ...query } },
    ),
  authorize: (
    items: readonly Pick<
      RecurringAuthorizationItem,
      "id" | "kind" | "version"
    >[],
  ) =>
    apiClient.post<{ authorized: number }>(
      "/operations/recurring-authorizations",
      { items },
    ),
};
