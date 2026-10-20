/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * Contrato público do módulo CRM.
 *
 * Até aqui o controller devolvia o registro do Prisma diretamente, o que
 * vazava dois detalhes de persistência para os clientes:
 *
 * - **`deletedAt`** — a marca de exclusão lógica. É estado interno: a consulta
 *   já filtra `deletedAt: null`, então o campo só podia chegar nulo e, se
 *   algum dia chegasse preenchido, seria um registro que o cliente não deveria
 *   estar vendo. Publicá-lo convida a implementar exclusão lógica no cliente.
 * - **`_count`** — nome gerado pelo Prisma. Um contrato público não deve
 *   carregar a convenção do ORM; o campo é o mesmo dado, com nome próprio.
 *
 * A regra de exclusão lógica **não muda**: o repositório continua marcando
 * `deletedAt` e filtrando por ele. O que muda é que isso deixa de atravessar a
 * fronteira da API.
 */

export interface CustomerContactReadModel {
  id: string;
  organizationId: string;
  businessUnitId: string | null;
  customerId: string | null;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Contagens calculadas no banco pelo `include` do repositório.
 *
 * Já excluem registros removidos — o recorte é do servidor.
 */
export interface CustomerCountsReadModel {
  assets: number;
  operations: number;
}

export interface CustomerReadModel {
  id: string;
  organizationId: string;
  type: string;
  legalName: string;
  tradeName: string | null;
  documentType: string | null;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** JSON livre — o backend não define esquema de endereço. */
  address: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
  contacts: readonly CustomerContactReadModel[];
  counts: CustomerCountsReadModel;
}

export interface CustomerListReadModel {
  data: readonly CustomerReadModel[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** Um endereço de atendimento, como a tela o consome. */
export interface CustomerAddressReadModel {
  id: string;
  customerId: string;
  label: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  stateCode: string | null;
  postalCode: string | null;
  notes: string | null;
  isPrimary: boolean;
  isActive: boolean;
  /** O endereço em uma linha, montado no servidor. */
  summary: string;
}
