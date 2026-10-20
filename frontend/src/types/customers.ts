/**
 * Contratos do módulo CRM (clientes e contatos).
 *
 * As formas de leitura são **sincronizadas** desde a PR-11: o backend passou a
 * publicar `CustomerReadModel` e um mapper, em vez de devolver o registro do
 * Prisma. Foi a correção que tirou `deletedAt` — e também `_count`, o nome do
 * ORM — do contrato público. A exclusão lógica não mudou; ela apenas deixou de
 * atravessar a API.
 *
 * Duas coisas que essa leitura entrega e que valem notar:
 *
 * - **`contacts` vem embutido**, ordenado por `isPrimary desc, name asc` — não
 *   é preciso uma segunda consulta para exibi-los;
 * - **`counts` traz `assets` e `operations` contados no banco**. São
 *   indicadores observados, publicados pelo backend; a tela não os soma.
 *
 * O que o contrato **não** tem: unidade de negócio (o cliente é da
 * organização, não da unidade), cidade como coluna (fica em `address`, que é
 * JSON livre) e responsável pela conta.
 */
import type { CustomerStatus, CustomerType } from "./contracts";
import type {
  CustomerContactReadModel,
  CustomerCountsReadModel,
  CustomerReadModel,
  CustomerAddressReadModel,
} from "./contracts/modules/organizations/business-units/customers/customer.read-models";

export type { CustomerStatus, CustomerType };

export type CustomerContact = CustomerContactReadModel;
export type CustomerCounts = CustomerCountsReadModel;

/**
 * `type` e `status` chegam como `string` no Read Model — o backend os valida
 * por `@IsIn`, e o literal sincronizado é a leitura correta deles no cliente.
 */
export type Customer = Omit<
  CustomerReadModel,
  "type" | "status" | "address"
> & {
  type: CustomerType;
  status: CustomerStatus;
  /** JSON livre — o backend não define esquema de endereço. */
  address: Record<string, unknown> | null;
};

/**
 * `GET /customers` (`CustomerQueryDto`).
 *
 * Aceita **apenas** estes campos. Não há filtro por unidade, cidade ou
 * responsável — verificado: `?city=Recife` devolve
 * `['property city should not exist']`.
 */
export interface CustomerQuery {
  search?: string;
  type?: CustomerType;
  status?: CustomerStatus;
  page?: number;
  limit?: number;
}

/** `POST /customers` (`CreateCustomerDto`). */
export interface CreateCustomerInput {
  type: CustomerType;
  legalName: string;
  tradeName?: string;
  documentType?: "CPF" | "CNPJ";
  documentNumber?: string;
  email?: string;
  phone?: string;
  notes?: string;
  address?: Record<string, unknown>;
}

/** `PATCH /customers/:id` (`UpdateCustomerDto`) — acrescenta `status`. */
export interface UpdateCustomerInput extends Partial<CreateCustomerInput> {
  status?: CustomerStatus;
}

/**
 * `POST /customers/:id/contacts` (`CreateContactDto`).
 *
 * Sem `notes`: o modelo `Contact` não tem essa coluna, e o `ValidationPipe`
 * usa `forbidNonWhitelisted` — enviá-la viraria 400.
 */
export interface CreateContactInput {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  businessUnitId?: string;
}

export type UpdateContactInput = Partial<CreateContactInput>;

/** Limites declarados pelo `class-validator`. */
export const CUSTOMER_LIMITS = {
  legalNameMinLength: 2,
  legalNameMaxLength: 255,
  tradeNameMaxLength: 255,
  contactNameMaxLength: 180,
  contactRoleMaxLength: 120,
  phoneMaxLength: 32,
  notesMaxLength: 5000,
  searchMaxLength: 180,
} as const;

/**
 * Chaves reconhecidas em `address`.
 *
 * `address` é `Json?` sem esquema no backend. A leitura aceita as grafias
 * usuais e mostra o restante como está — não há campo obrigatório a exigir
 * nem formato a impor.
 */
export const ADDRESS_KEYS = [
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "stateCode",
  "postalCode",
  "country",
] as const;

/* ------------------------------------------------------------------ */
/* Endereços de atendimento                                            */
/* ------------------------------------------------------------------ */

export type CustomerAddress = CustomerAddressReadModel;

/** `POST /customers/:id/addresses`. */
export interface CreateCustomerAddressInput {
  label: string;
  street: string;
  city: string;
  number?: string;
  complement?: string;
  district?: string;
  stateCode?: string;
  postalCode?: string;
  notes?: string;
  isPrimary?: boolean;
}

export type UpdateCustomerAddressInput = Partial<CreateCustomerAddressInput> & {
  isActive?: boolean;
};
