/**
 * Endereço do backend virando endereço que o navegador alcança.
 *
 * ## O problema que isto resolve
 *
 * Algumas respostas do backend carregam **o caminho dele**: a
 * pré-visualização da assinatura chega como
 * `/api/v1/identity/me/signature/preview?expires=…&signature=…`. Está correto
 * para o aplicativo de campo, que fala direto com a API. No navegador é um
 * endereço da origem do frontend, onde `/api/v1` não existe — a imagem respondia
 * 404 e a assinatura cadastrada aparecia como um quadro vazio.
 *
 * O navegador só conversa com a nossa origem, e é o BFF que traduz: `/api/v1/x`
 * vira `/api/orbit/x`. Esta função é essa tradução, num lugar só — qualquer
 * `<img src>` ou download que receba caminho do backend passa por aqui.
 *
 * URL absoluta é devolvida intacta: o endereço assinado do Storage já vem com
 * host próprio e não passa pelo proxy.
 */
import { BFF_BASE_PATH } from "./env";

/** O prefixo global do NestJS (`app.setGlobalPrefix` + versionamento). */
const API_PREFIX = "/api/v1";

export function browserUrlFor(url: string): string {
  const valor = url.trim();
  if (valor === "") return valor;

  /* Absoluto — inclusive `blob:` e `data:` — não é caminho de backend. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(valor) || valor.startsWith("//")) {
    return valor;
  }

  if (valor === API_PREFIX || valor.startsWith(`${API_PREFIX}/`)) {
    return `${BFF_BASE_PATH}${valor.slice(API_PREFIX.length)}`;
  }

  /* Já é caminho do BFF, ou caminho de página: fica como está. Reescrever
     qualquer relativo transformaria um link de tela num pedido de API. */
  return valor;
}
