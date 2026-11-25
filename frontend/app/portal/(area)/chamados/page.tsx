import { Suspense } from "react";

import { PortalRequests } from "@/components/portal/portal-requests";

export default function PortalRequestsPage() {
  return (
    <Suspense>
      <PortalRequests />
    </Suspense>
  );
}
