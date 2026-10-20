/**
 * O que a tela de login faz com cada recusa do servidor.
 *
 * ## Por que existe, em vez de um `if` dentro do componente
 *
 * Aqui morava um defeito que trancava pessoas fora do sistema: a tela revelava o
 * campo do segundo fator comparando `message.includes("mfa code is required")` —
 * o texto **interno** do backend, em inglês, que o contrato público nunca envia.
 * O mapeador de erros troca a mensagem pela do catálogo, em português. O campo
 * nunca aparecia, e quem ativava o segundo fator via "sua sessão não é válida ou
 * expirou" numa tela onde ninguém tem sessão.
 *
 * A decisão passou a ser pelo **código**, que é contrato publicado
 * (`PUBLIC_ERROR_CODES`), e saiu do componente para poder ser testada sem DOM.
 * A mensagem continua vindo do servidor: quem escreve o texto é o catálogo, não
 * esta tela.
 */
import { toApiError } from "./api-error";

export interface LoginFailure {
  /** Abre (e mantém aberto) o campo do código do autenticador. */
  readonly revealMfa: boolean;
  readonly title: string;
  readonly description: string;
}

export function loginFailure(error: unknown): LoginFailure {
  /* `toApiError` garante mensagem: uma falha sem texto vira a frase padrão do
     catálogo, e um `|| "verifique suas credenciais"` aqui seria ramo morto. */
  const falha = toApiError(error);
  const description = falha.message;

  switch (falha.code) {
    case "MFA_REQUIRED":
      return {
        revealMfa: true,
        title: "Falta o código do autenticador",
        description,
      };
    /* O campo continua aberto: o próximo código do aplicativo resolve, e fechá-lo
       obrigaria a digitar e-mail e senha de novo por causa de um dígito. */
    case "MFA_INVALID":
      return { revealMfa: true, title: "Código não confere", description };
    /**
     * Credencial errada e conta travada tinham a mensagem de sessão expirada —
     * dita a quem está na tela de login, onde ninguém tem sessão. Quem errou a
     * senha limpava cookie; quem estava travado digitava a senha certa.
     */
    case "INVALID_CREDENTIALS":
      return {
        revealMfa: false,
        title: "Não foi possível entrar",
        description,
      };
    case "ACCOUNT_LOCKED":
      return { revealMfa: false, title: "Acesso bloqueado", description };
    default:
      return {
        revealMfa: false,
        title: "Não foi possível entrar",
        description,
      };
  }
}
