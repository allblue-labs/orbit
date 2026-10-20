/**
 * As decisões da página pública de assinatura do contrato.
 *
 * Separadas da marcação porque são as duas únicas coisas ali que podem estar
 * **erradas**: qual tela cada estado do link produz, e quando o botão de assinar
 * pode disparar. O resto da página é layout, e layout não tem como ser testado neste
 * projeto — não há harness de componente.
 */
import type {
  PmocContractSignatureResult,
  PmocSignatureLinkState,
} from "@/types/pmoc";

/**
 * O que a página mostra.
 *
 * Três telas para quatro estados, e o agrupamento é a decisão: `JA_ASSINADO` **não**
 * é recusa. É o desfecho feliz — o contratante assinou, talvez num outro dispositivo,
 * talvez recarregando a página depois de enviar. Juntá-lo a "expirado" e "revogado"
 * numa tela de erro diria a quem teve sucesso que algo deu errado, e a reação natural
 * seria pedir outro link e assinar duas vezes o mesmo contrato.
 */
export type EtapaDoContrato = "ASSINAR" | "CONCLUIDO" | "RECUSADO";

export function etapaDoContrato(
  state: PmocSignatureLinkState,
): EtapaDoContrato {
  if (state === "VALIDO") return "ASSINAR";
  if (state === "JA_ASSINADO") return "CONCLUIDO";
  return "RECUSADO";
}

/** O mínimo para um nome valer como identificação de quem assina. */
const NOME_MINIMO = 3;

/**
 * O envio pode disparar?
 *
 * As três condições são independentes e todas necessárias. O traço é a assinatura; o
 * nome é quem assinou — uma rubrica sem nome não identifica ninguém, e o backend
 * exige `signerName`. `enviando` é o que impede o segundo clique: a rota grava, e o
 * serviço não repete automaticamente justamente para não assinar duas vezes.
 */
export function podeAssinar(estado: {
  signerName: string;
  temTraco: boolean;
  enviando: boolean;
}): boolean {
  if (estado.enviando) return false;
  if (!estado.temTraco) return false;
  return estado.signerName.trim().length >= NOME_MINIMO;
}

/**
 * A assinatura foi registrada?
 *
 * **`VALIDO` é o sucesso, e nada mais serve como critério.** A função no banco devolve
 * `VALIDO` junto de `signed = true` só no caminho em que gravou; qualquer recusa volta
 * com o estado do link e a frase correspondente.
 *
 * A tentação é olhar `reason === null`, já que uma assinatura aceita não tem motivo a
 * explicar. Não serve: `reason` também vinha nulo para o estado que o backend passou a
 * tratar como 404 — o contrato removido no meio do aceite —, e o contratante via
 * "assinado" sem nada gravado. Afirmar o sucesso pelo que o sucesso **é** não tem essa
 * ambiguidade; afirmar pela ausência de um erro conhecido tem.
 */
export function assinaturaFoiRegistrada(
  resultado: PmocContractSignatureResult,
): boolean {
  return resultado.state === "VALIDO";
}
