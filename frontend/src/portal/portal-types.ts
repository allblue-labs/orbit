/** Os contratos da área do cliente, com nomes curtos para as telas. */
export type {
  CustomerPortalAssetDetailsReadModel as PortalAsset,
  CustomerPortalDashboardReadModel as PortalSummary,
  CustomerPortalDocumentReadModel as PortalDocument,
  CustomerPortalMeReadModel as PortalMe,
  CustomerPortalOperationDetailsReadModel as PortalOperation,
  CustomerPortalPageReadModel as PortalPage,
  CustomerPortalProfileReadModel as PortalProfile,
} from "@/types/contracts/modules/customer-portal/customer-portal.read-models";
export type {
  CustomerServiceRequestDetailsReadModel as ServiceRequest,
  CustomerServiceRequestTimelineItemReadModel as ServiceRequestEvent,
} from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";
