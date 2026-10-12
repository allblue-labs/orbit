/**
 * O endereço de atendimento derivado do endereço informado no cadastro.
 *
 * ## Dois endereços, um formulário
 *
 * `Customer.address` é o endereço **fiscal**: JSON livre, sai em documento.
 * `CustomerAddress` é para onde o técnico vai — é o que a aba Endereços lista
 * e o que uma operação referencia.
 *
 * Para quem cadastra, são a mesma coisa: preencheu o endereço do cliente. O
 * efeito de tratá-los como coisas separadas era o dono preencher tudo, abrir a
 * aba Endereços e encontrá-la vazia — e ter de digitar de novo para que o
 * atendimento tivesse destino.
 *
 * ## O que faz um endereço valer a pena semear
 *
 * Logradouro e cidade. São os dois campos que `CustomerAddress` exige, e são o
 * mínimo para alguém chegar lá. Sem eles o que veio é fragmento — um CEP
 * solto, uma UF — e criar uma linha a partir disso produziria um endereço de
 * atendimento que não leva a lugar nenhum.
 */

/** Como o primeiro endereço se chama quando ninguém o nomeou. */
export const PRIMEIRO_ENDERECO = 'Principal';

export interface EnderecoDeAtendimento {
  label: string;
  street: string;
  city: string;
  number?: string;
  complement?: string;
  district?: string;
  stateCode?: string;
  postalCode?: string;
}

/** O texto de uma chave do JSON, ou `undefined` quando não há o que aproveitar. */
function texto(
  fonte: Record<string, unknown>,
  chave: string,
): string | undefined {
  const valor = fonte[chave];
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : undefined;
}

export function enderecoDeAtendimento(
  address: Record<string, unknown> | undefined,
): EnderecoDeAtendimento | undefined {
  if (!address) return undefined;

  const street = texto(address, 'street');
  const city = texto(address, 'city');
  if (!street || !city) return undefined;

  return {
    label: texto(address, 'label') ?? PRIMEIRO_ENDERECO,
    street,
    city,
    number: texto(address, 'number'),
    complement: texto(address, 'complement'),
    district: texto(address, 'district'),
    /* A UF viaja em maiúsculas: a coluna tem duas posições e o resto do
       produto compara com `PE`, não com `pe`. */
    stateCode: texto(address, 'stateCode')?.toUpperCase().slice(0, 2),
    postalCode: texto(address, 'postalCode'),
  };
}
