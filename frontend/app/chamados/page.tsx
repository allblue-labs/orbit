import { Suspense } from "react";

import { ServiceRequestsWorkspace } from "@/components/service-requests/service-requests-workspace";
import { WorkspacePage } from "@/workspace";

/** Chamados abertos pelos clientes no portal e no app. */
export default function ServiceRequestsPage() {
  return (
    <WorkspacePage entity="customer-service-request">
      <Suspense>
        <ServiceRequestsWorkspace />
      </Suspense>
    </WorkspacePage>
  );
}
