import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import {
  customerServiceRequestsService as service,
  type ServiceRequestQuery,
} from "@/services/customer-service-requests.service";
import type { CustomerServiceRequestDetailsReadModel as ServiceRequest } from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";

export function useServiceRequests(query: ServiceRequestQuery) {
  return useApiQuery(
    service.keys.list(query),
    ({ signal }) => service.list(query, { signal }),
    { placeholderData: (previous) => previous, refetchInterval: 60_000 },
  );
}

export function useServiceRequest(id: string | null) {
  return useApiQuery(
    service.keys.detail(id ?? ""),
    ({ signal }) => service.get(id!, { signal }),
    { enabled: Boolean(id) },
  );
}

/**
 * Todo comando devolve o chamado atualizado: o detalhe vai direto para o
 * cache, e a lista é relida para refletir status e responsável.
 */
export function useServiceRequestCommand() {
  const client = useQueryClient();
  return useApiMutation(
    (run: () => Promise<ServiceRequest>) => run(),
    {
      onSuccess: async (request) => {
        client.setQueryData(service.keys.detail(request.id), request);
        await client.invalidateQueries({ queryKey: service.keys.all() });
      },
    },
  );
}
