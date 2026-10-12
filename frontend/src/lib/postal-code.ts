/**
 * CEP: normalização, máscara e a forma do endereço que a busca devolve.
 *
 * Isto é apresentação e formato — não é regra de negócio. Quem guarda o
 * endereço é o cadastro; quem sabe a que rua um CEP corresponde é o serviço de
 * consulta, atrás do BFF. Aqui só se decide o que é um CEP bem formado e como
 * o resultado vira os campos que os formulários já têm.
 */

/** Só os dígitos, no máximo oito. */
export function normalizePostalCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

/** `50030230` → `50030-230`. Parcial fica parcial: quem digita vê o que digitou. */
export function formatPostalCode(value: string): string {
  const digits = normalizePostalCode(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Oito dígitos. Se o CEP existe, quem responde é o serviço. */
export function isCompletePostalCode(value: string): boolean {
  return normalizePostalCode(value).length === 8;
}

/**
 * O endereço encontrado, nos campos que os formulários do produto usam.
 *
 * Os nomes são os de `ADDRESS_KEYS` — o mesmo vocabulário que o cadastro de
 * cliente lê e grava. `number` e `complement` não vêm da consulta: são de quem
 * mora lá, e o formulário os mantém como estavam.
 */
export interface PostalAddress {
  readonly postalCode: string;
  readonly street: string;
  readonly district: string;
  readonly city: string;
  readonly state: string;
  readonly stateCode: string;
  /**
   * Sempre "Brasil".
   *
   * Não vem do serviço: o ViaCEP atende **só** CEP brasileiro, então o país é
   * uma consequência de a consulta ter dado certo, não um dado a buscar.
   * Deixá-lo de fora fazia o formulário preencher rua, bairro, cidade e estado
   * e abandonar o campo de país logo abaixo — preenchido pela metade parece
   * defeito, e é.
   */
  readonly country: string;
}

/** O único país que este serviço conhece. */
export const BRASIL = "Brasil";

/** O que o serviço de consulta devolve, antes de virar vocabulário do produto. */
export interface PostalLookupPayload {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  estado?: string;
  erro?: string | boolean;
}

/**
 * Traduz a resposta do serviço para os campos do produto.
 *
 * Devolve `null` quando o CEP não existe — o serviço sinaliza isso com um
 * `erro` no corpo e status 200, não com um código HTTP.
 */
export function toPostalAddress(
  payload: PostalLookupPayload,
): PostalAddress | null {
  if (payload.erro === true || payload.erro === "true") return null;
  if (!payload.cep) return null;

  return {
    postalCode: formatPostalCode(payload.cep),
    street: payload.logradouro?.trim() ?? "",
    district: payload.bairro?.trim() ?? "",
    city: payload.localidade?.trim() ?? "",
    state: payload.estado?.trim() ?? "",
    stateCode: payload.uf?.trim().toUpperCase() ?? "",
    country: BRASIL,
  };
}
