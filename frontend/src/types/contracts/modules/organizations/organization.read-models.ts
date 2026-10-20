/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

import type { BusinessUnitType } from '../..';

export interface BusinessUnitReadModel {
  id: string;
  organizationId: string;
  parentId: string | null;
  slug: string;
  code: string | null;
  type: BusinessUnitType;
  isPrimary: boolean;
  legalName: string;
  tradeName: string | null;
  documentType: string;
  documentNumber: string;
  city: string;
  street: string;
  number: string | null;
  stateCode: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  locale: string;
  currency: string;
  status: string;
  /**
   * Se a unidade tem marca cadastrada — não a imagem.
   *
   * O data URI tem centenas de quilobytes e esta leitura devolve a lista
   * inteira de unidades: mandar a imagem aqui faria a tela de configurações
   * baixar megabytes para desenhar meia dúzia de linhas. Quem precisa da
   * imagem busca a unidade por id.
   */
  hasLogo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationPlanReadModel {
  id: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: string | number | null;
  annualPrice: string | number | null;
  currency: string;
  capabilities: readonly string[];
  limits: Readonly<Record<string, number | null>>;
  isActive: boolean;
}

/**
 * Membro da organização.
 *
 * Recorte mínimo para atribuir trabalho a alguém: identificação, contato e
 * papel. Nada de credencial, verificação de e-mail, último acesso ou marca de
 * exclusão — atribuir uma operação não precisa disso, e publicar seria expor
 * mais do que a finalidade exige.
 */
export interface OrganizationMemberReadModel {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  status: string;
  /** Papel na organização, como o backend o define. */
  role: { id: string; key: string; name: string };
  /**
   * Unidades que a pessoa atende.
   *
   * Vem de `BusinessUnitMembership`, que já existia e nunca era publicada.
   * Lista vazia significa acesso em nível de organização — não é ausência de
   * dado, é o escopo mais amplo.
   */
  businessUnits: readonly {
    id: string;
    legalName: string;
    tradeName: string | null;
  }[];
  joinedAt: string;
  /** `true` para o dono da organização. */
  isOwner: boolean;
  /**
   * A pessoa tem assinatura profissional ativa.
   *
   * **Só o fato.** A imagem não é publicada aqui de propósito: quem a desenha é
   * o gerador de documento, no servidor, e quem escolhe um responsável precisa
   * saber se o documento sairá assinado — não ver a assinatura de outra pessoa
   * na tela. Espalhar a imagem pelo navegador não atenderia nenhuma pergunta
   * que esta resposta já não atenda.
   */
  hasSignature: boolean;
  /** Effective access after applying an optional member override. */
  access: {
    useRoleDefaults: boolean;
    permissions: readonly string[];
    allowedSurfaces: readonly string[];
  };
}

/**
 * Papel e o que ele concede.
 *
 * `permissions` é a lista que o backend usa para autorizar — publicada para
 * que a interface possa **mostrar** o que cada papel permite, não para decidir
 * nada com ela. Quem autoriza continua sendo o servidor.
 */
export interface OrganizationRoleReadModel {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: readonly string[];
  /**
   * Onde este papel entra: `WEB`, `MOBILE`, `API`.
   *
   * O painel web é da administração da operação. Os papéis de campo nascem só
   * com `MOBILE` — quem os tem entra pelo aplicativo, e o backend recusa a
   * entrada na web mesmo com a senha certa.
   */
  allowedSurfaces: readonly string[];
  /** `true` para papéis de plataforma, que a organização não edita. */
  isSystem: boolean;
  /** `false` quando o papel é global, compartilhado por todas as organizações. */
  isOrganizationOwned: boolean;
  /** Quantas pessoas têm este papel nesta organização. */
  memberCount: number;
}

export interface OrganizationContextReadModel {
  id: string;
  ownerUserId: string;
  planId: string;
  slug: string;
  displayName: string;
  primarySegment: string;
  status: string;
  subscriptionStatus: string;
  subscriptionStartedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /* Só o fato, não a imagem: `GET current` é carregado em toda navegação, e a
     marca chega a meio megabyte. Quem precisa dela pede `current/logo`. */
  hasLogo: boolean;
  settings: unknown;
  createdAt: string;
  updatedAt: string;
  plan: OrganizationPlanReadModel;
  businessUnits: readonly BusinessUnitReadModel[];
}

export interface OrganizationAccessCatalogReadModel {
  surfaces: readonly { code: string; label: string }[];
  permissionGroups: readonly {
    key: string;
    label: string;
    permissions: readonly { code: string; label: string }[];
  }[];
}
