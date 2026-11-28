/**
 * O acesso do cliente ao app — tipos do contrato do backend.
 *
 * Ver `backend/src/modules/customer-portal/customer-portal.read-models.ts`.
 */
export type {
  CustomerPortalAccessCredentialsReadModel as CustomerAccessCredentials,
  CustomerPortalAccessIdentityReadModel as CustomerAccessIdentity,
  CustomerPortalAccessReadModel as CustomerAccess,
} from "@/types/contracts/modules/customer-portal/customer-portal.read-models";
