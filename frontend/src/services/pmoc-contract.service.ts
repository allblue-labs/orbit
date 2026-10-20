/**
 * O contrato do PMOC visto por quem vai assiná-lo — `/api/v1/public/pmoc/contracts`.
 *
 * ## Por que um serviço separado de `pmocService`
 *
 * Pela mesma razão que o backend separou o controller: a autoridade é outra. Todo o
 * resto do PMOC fala por uma sessão com organização, unidade e permissão; aqui quem
 * chama é o contratante, que não tem conta — a credencial é o token do link, e ela
 * vale para **um** contrato.
 *
 * A separação também é prática: um `import` de `pmocService` numa página pública
 * traria consigo todo o módulo — download de documento, execuções, cobertura — para
 * um bundle que só precisa ler e assinar.
 *
 * ## A key fica com a página
 *
 * Não há entrada em `pmocService.keys` para estas rotas: nada no resto da aplicação
 * invalida o contrato público, porque nada no resto da aplicação o lê. A página monta
 * a própria key com o token, que é o único eixo que existe aqui — um contrato por
 * link.
 */
import { apiClient } from "@/api/client";
import type {
  PmocContractSignatureResult,
  PmocPublicContract,
  SignPmocContractInput,
} from "@/types/pmoc";

const base = (token: string) =>
  `/public/pmoc/contracts/${encodeURIComponent(token)}`;

export const pmocContractService = {
  /**
   * O resumo que o link abre.
   *
   * `retries: 0` porque as falhas que importam aqui não são transitórias: token
   * inexistente é 404 e repetir não o cria. Insistir só atrasaria a mensagem.
   */
  read: (token: string): Promise<PmocPublicContract> =>
    apiClient.get<PmocPublicContract>(base(token), { retries: 0 }),

  /**
   * Registra a assinatura.
   *
   * `retries: 0` é obrigatório, não preferência: a rota grava. Uma repetição
   * automática depois de um timeout que na verdade chegou ao servidor tentaria
   * assinar duas vezes o mesmo contrato — e a segunda responderia `JA_ASSINADO`,
   * fazendo o contratante ver uma recusa logo após ter assinado com sucesso.
   */
  sign: (
    token: string,
    input: SignPmocContractInput,
  ): Promise<PmocContractSignatureResult> =>
    apiClient.post<PmocContractSignatureResult>(
      `${base(token)}/signature`,
      input,
      { retries: 0 },
    ),
} as const;
