import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { customerPortalAccessService } from "@/services/customer-portal-access.service";

export function useCustomerPortalAccess(customerId: string, enabled = true) {
  return useApiQuery(
    customerPortalAccessService.keys.access(customerId),
    ({ signal }) => customerPortalAccessService.get(customerId, { signal }),
    { enabled: enabled && Boolean(customerId) },
  );
}

function useRefresh(customerId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: customerPortalAccessService.keys.access(customerId),
    });
}

export function useCreateCustomerPortalAccess(customerId: string) {
  const refresh = useRefresh(customerId);
  return useApiMutation(
    (localPart: string) =>
      customerPortalAccessService.create(customerId, localPart),
    { onSuccess: refresh },
  );
}

export function useResetCustomerPortalPassword(customerId: string) {
  const refresh = useRefresh(customerId);
  return useApiMutation(
    (identityId: string) =>
      customerPortalAccessService.resetPassword(customerId, identityId),
    { onSuccess: refresh },
  );
}

export function useDisableCustomerPortalAccess(customerId: string) {
  const refresh = useRefresh(customerId);
  return useApiMutation(
    (identityId: string) =>
      customerPortalAccessService.disable(customerId, identityId),
    { onSuccess: refresh },
  );
}
