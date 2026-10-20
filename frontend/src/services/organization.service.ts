/**
 * Serviços do Organization Workspace.
 *
 * Cobre quatro controllers do backend, porque a administração da organização
 * está distribuída entre eles:
 *
 * | Controller | O que traz |
 * | --- | --- |
 * | `organizations` | cadastro, segmento, settings |
 * | `organizations/current/business-units` | unidades |
 * | `subscription-plans` | plano, capabilities, limites, consumo |
 * | `integrations` | integrações configuradas |
 *
 * Nenhuma regra vive aqui: quais capabilities o plano concede, se um limite
 * foi excedido e se uma unidade pode ser removida são decisões do servidor.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { PaginatedResult, QueryParams, RequestOptions } from "@/types/api";
import type {
  BusinessUnit,
  BusinessUnitLogo,
  CreateBusinessUnitInput,
  Integration,
  Organization,
  OrganizationEntitlements,
  OrganizationLogo,
  OrganizationMember,
  OrganizationPlan,
  PlanUsageRecord,
  UpdateBusinessUnitInput,
  UpdateOrganizationInput,
} from "@/types/organization";

const RESOURCE = "organizations";
const UNITS_RESOURCE = "business-units";
const INTEGRATIONS_RESOURCE = "integrations";
const PLANS_RESOURCE = "plans";

const unit = (id: string): string =>
  `/organizations/current/business-units/${encodeURIComponent(id)}`;

export const organizationService = {
  current: (options?: RequestOptions): Promise<Organization> =>
    apiClient.get<Organization>("/organizations/current", options),

  /** Metadados. `settings` é JSON livre — é onde branding vive hoje. */
  update: (input: UpdateOrganizationInput): Promise<Organization> =>
    apiClient.patch<Organization>("/organizations/current", input),

  /**
   * Membros da organização.
   *
   * Leitura pura, no mesmo escopo de `GET /organizations/current`. É a única
   * fonte de identificadores de usuário do tenant — sem ela não há como
   * atribuir uma operação a alguém.
   */
  /**
   * Membros da organização — **paginado**.
   *
   * O tipo dizia `OrganizationMember[]`, e o endpoint sempre respondeu
   * `PaginationHelper.result(...)`: `{ data, meta }`. A anotação era uma mentira
   * que o compilador aceitava, então `members.data.find(...)` compilava e
   * estourava `find is not a function` em execução — a tela de Certificações
   * caía inteira na primeira linha que mostrasse o nome de uma pessoa.
   */
  members: (
    query?: { page?: number; limit?: number },
    options?: RequestOptions,
  ): Promise<PaginatedResult<OrganizationMember>> =>
    apiClient.get<PaginatedResult<OrganizationMember>>(
      "/organizations/current/members",
      { ...options, query: query as QueryParams | undefined },
    ),

  entitlements: (options?: RequestOptions): Promise<OrganizationEntitlements> =>
    apiClient.get<OrganizationEntitlements>(
      "/organizations/current/subscription",
      options,
    ),

  /** Consumo do período corrente da assinatura — recorte feito no servidor. */
  usage: (options?: RequestOptions): Promise<readonly PlanUsageRecord[]> =>
    apiClient.get<readonly PlanUsageRecord[]>(
      "/organizations/current/usage",
      options,
    ),

  /**
   * Catálogo de planos.
   *
   * É a única fonte publicada de "quais capabilities existem": a união das
   * capabilities de todos os planos. Rota `@Public()`.
   */
  plans: (options?: RequestOptions): Promise<readonly OrganizationPlan[]> =>
    apiClient.get<readonly OrganizationPlan[]>("/plans", options),

  businessUnits: (options?: RequestOptions): Promise<readonly BusinessUnit[]> =>
    apiClient.get<readonly BusinessUnit[]>(
      "/organizations/current/business-units",
      options,
    ),

  /**
   * A marca que timbra os documentos da empresa.
   *
   * Vale para toda unidade que não tenha logo próprio — o caso de quem opera com
   * uma unidade só, que é a maioria. Rota separada de `current` pelo mesmo
   * motivo do logo de unidade: o corpo tem centenas de quilobytes.
   */
  logo: (options?: RequestOptions): Promise<OrganizationLogo> =>
    apiClient.get<OrganizationLogo>("/organizations/current/logo", options),

  setLogo: (image: string): Promise<OrganizationLogo> =>
    apiClient.put<OrganizationLogo>("/organizations/current/logo", { image }),

  removeLogo: (): Promise<OrganizationLogo> =>
    apiClient.delete<OrganizationLogo>("/organizations/current/logo"),

  createBusinessUnit: (input: CreateBusinessUnitInput): Promise<BusinessUnit> =>
    apiClient.post<BusinessUnit>(
      "/organizations/current/business-units",
      input,
    ),

  updateBusinessUnit: (
    id: string,
    input: UpdateBusinessUnitInput,
  ): Promise<BusinessUnit> => apiClient.patch<BusinessUnit>(unit(id), input),

  removeBusinessUnit: (id: string): Promise<void> =>
    apiClient.delete<void>(unit(id)),

  /**
   * A marca que timbra os documentos da unidade.
   *
   * Rota própria, e não campo do `PATCH`: o corpo tem centenas de quilobytes,
   * e misturá-lo à edição de nome e endereço faria toda alteração de cadastro
   * carregar a imagem junto.
   */
  setBusinessUnitLogo: (id: string, image: string): Promise<BusinessUnitLogo> =>
    apiClient.put<BusinessUnitLogo>(`${unit(id)}/logo`, { image }),

  removeBusinessUnitLogo: (id: string): Promise<BusinessUnitLogo> =>
    apiClient.delete<BusinessUnitLogo>(`${unit(id)}/logo`),

  integrations: (options?: RequestOptions): Promise<readonly Integration[]> =>
    apiClient.get<readonly Integration[]>("/integrations", options),

  /** Revalida as credenciais da integração. Não sincroniza dados. */
  validateIntegration: (id: string): Promise<Integration> =>
    apiClient.post<Integration>(
      `/integrations/${encodeURIComponent(id)}/validate`,
    ),

  keys: {
    module: (): QueryKey => queryKeys.module(RESOURCE),
    current: (): QueryKey => queryKeys.query(RESOURCE, "current"),
    logo: (): QueryKey => queryKeys.query(RESOURCE, "logo"),
    members: (query?: { page?: number; limit?: number }): QueryKey =>
      queryKeys.list(`${RESOURCE}-members`, query as QueryParams | undefined),
    entitlements: (): QueryKey => queryKeys.query(RESOURCE, "subscription"),
    usage: (): QueryKey => queryKeys.query(RESOURCE, "usage"),
    plans: (): QueryKey => queryKeys.query(PLANS_RESOURCE, "catalog"),
    businessUnits: (): QueryKey => queryKeys.list(UNITS_RESOURCE),
    integrations: (): QueryKey => queryKeys.list(INTEGRATIONS_RESOURCE),
  },
} as const;
