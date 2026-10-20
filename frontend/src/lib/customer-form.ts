/**
 * O formulário de cliente, sem tela.
 *
 * Guarda três decisões: que campos existem, como o estado vira corpo de
 * requisição e o que a tela consegue recusar antes de chamar o servidor.
 * Nenhuma delas é regra de negócio — todas saem do `CreateCustomerDto` e do
 * `UpdateCustomerDto`, e o backend continua sendo quem decide.
 *
 * ## O que o contrato aceita
 *
 * Obrigatório: `type` e `legalName`. Opcional: `tradeName`, `documentType`
 * com `documentNumber`, `email`, `phone`, `notes` e `address`.
 *
 * ## O que o contrato não aceita, e por isso não está aqui
 *
 * - **`status` na criação.** Só o `UpdateCustomerDto` o tem; o banco nasce em
 *   `ACTIVE`. Oferecer a escolha na criação seria prometer o que a API recusa.
 * - **Contato.** É sub-recurso (`POST /customers/:id/contacts`), com
 *   requisição própria. Emendá-la ao cadastro faria uma transação de mentira:
 *   falhando a segunda chamada, o cliente já existiria sem o contato e a tela
 *   teria de esconder isso. `email` e `phone` do próprio cliente cobrem o
 *   contato inicial; contatos nomeados vivem no cadastro do cliente.
 * - **Unidade de negócio.** O cliente é da organização. Não há
 *   `businessUnitId` no modelo, e a organização vem do token — não do corpo.
 */
import {
  isValidBrazilianDocument,
  normalizeBrazilianDocument,
} from "./brazilian-document";
import {
  ADDRESS_KEYS,
  CUSTOMER_LIMITS,
  type CreateCustomerInput,
  type Customer,
  type CustomerStatus,
  type CustomerType,
  type UpdateCustomerInput,
} from "@/types/customers";

export type AddressKey = (typeof ADDRESS_KEYS)[number];

export interface CustomerFormState {
  type: CustomerType;
  legalName: string;
  tradeName: string;
  documentType: "" | "CPF" | "CNPJ";
  documentNumber: string;
  email: string;
  phone: string;
  notes: string;
  status: CustomerStatus;
  address: Record<AddressKey, string>;
}

const emptyAddress = (): Record<AddressKey, string> =>
  Object.fromEntries(ADDRESS_KEYS.map((key) => [key, ""])) as Record<
    AddressKey,
    string
  >;

/**
 * Estado inicial.
 *
 * Na edição, o que o servidor publicou. Na criação, campos vazios e
 * `COMPANY` — o mesmo padrão que a coluna `type` tem no banco, não uma
 * preferência inventada aqui.
 */
export function initialCustomerForm(
  customer: Customer | null,
): CustomerFormState {
  const address = emptyAddress();
  if (customer?.address) {
    for (const key of ADDRESS_KEYS) {
      const value = customer.address[key];
      if (value !== null && value !== undefined && value !== "") {
        address[key] = String(value);
      }
    }
  }

  return {
    type: customer?.type ?? "COMPANY",
    legalName: customer?.legalName ?? "",
    tradeName: customer?.tradeName ?? "",
    documentType: (customer?.documentType as "CPF" | "CNPJ" | null) ?? "",
    documentNumber: customer?.documentNumber ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    notes: customer?.notes ?? "",
    status: customer?.status ?? "ACTIVE",
    address,
  };
}

/** Texto vazio não viaja: ausência e string vazia são coisas diferentes no DTO. */
const optional = (value: string): string | undefined =>
  value.trim() ? value.trim() : undefined;

/**
 * O endereço só vai quando tem conteúdo.
 *
 * `address` é `Json?` livre no backend — não há esquema a cumprir. As chaves
 * são as que o produto já lê em `readAddress`; mandar `{}` gravaria um objeto
 * vazio onde antes havia ausência.
 */
function addressPayload(
  address: Record<AddressKey, string>,
): Record<string, string> | undefined {
  const filled = Object.entries(address).filter(([, value]) => value.trim());
  if (filled.length === 0) return undefined;
  return Object.fromEntries(filled.map(([key, value]) => [key, value.trim()]));
}

export function customerPayload(form: CustomerFormState): CreateCustomerInput {
  const documentType = form.documentType || undefined;
  return {
    type: form.type,
    legalName: form.legalName.trim(),
    tradeName: optional(form.tradeName),
    documentType,
    /**
     * Só dígitos. O backend guarda assim (`replace(/\D/g, '')`), e a máscara
     * da tela é apresentação — mandar o texto formatado deixaria a decisão de
     * normalizar para o servidor sem necessidade.
     */
    documentNumber: documentType
      ? normalizeBrazilianDocument(form.documentNumber) || undefined
      : undefined,
    email: optional(form.email),
    phone: optional(form.phone),
    notes: optional(form.notes),
    address: addressPayload(form.address),
  };
}

/** Na edição o contrato acrescenta `status`. */
export function customerUpdatePayload(
  form: CustomerFormState,
): UpdateCustomerInput {
  return { ...customerPayload(form), status: form.status };
}

export type CustomerFormField =
  | "legalName"
  | "documentType"
  | "documentNumber"
  | "email";

/**
 * O que a tela consegue recusar sozinha.
 *
 * Formato e obrigatoriedade — nada além. Documento repetido, por exemplo, não
 * aparece aqui: só o banco sabe, e perguntar antes criaria uma segunda
 * verdade que envelhece no instante seguinte.
 */
export function customerFormIssues(
  form: CustomerFormState,
): Readonly<Partial<Record<CustomerFormField, string>>> {
  const issues: Partial<Record<CustomerFormField, string>> = {};

  const legalName = form.legalName.trim();
  if (legalName.length < CUSTOMER_LIMITS.legalNameMinLength) {
    issues.legalName = "Informe a razão social ou o nome, com ao menos duas letras.";
  }

  const digits = normalizeBrazilianDocument(form.documentNumber);
  if (form.documentType && !digits) {
    issues.documentNumber = "Informe o número do documento.";
  }
  if (!form.documentType && digits) {
    issues.documentType = "Escolha se o documento é CPF ou CNPJ.";
  }
  if (form.documentType && digits && !isValidBrazilianDocument(digits)) {
    issues.documentNumber = "Este número não confere. Verifique os dígitos.";
  }
  if (form.documentType === "CPF" && digits.length > 11) {
    issues.documentNumber = "Um CPF tem onze dígitos.";
  }
  if (form.documentType === "CNPJ" && digits && digits.length < 14) {
    issues.documentNumber = "Um CNPJ tem catorze dígitos.";
  }

  const email = form.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.email = "Informe um e-mail válido.";
  }

  return issues;
}

/** Há algo que impeça o envio? */
export function hasCustomerFormIssues(form: CustomerFormState): boolean {
  return Object.keys(customerFormIssues(form)).length > 0;
}
