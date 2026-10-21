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
 * O storage LOCAL também passa pelo BFF: sua URL absoluta pode conter
 * localhost, um host do Docker ou HTTP atrás do TLS do proxy. A assinatura
 * local cobre o objeto, a operação e a expiração, e continua válida quando
 * a mesma query é encaminhada pela nossa origem. URLs externas (S3/MinIO)
 * conservam o host e o caminho que participam da assinatura do provider.
 */
import { BFF_BASE_PATH } from "./env";

/** O prefixo global do NestJS (`app.setGlobalPrefix` + versionamento). */
const API_PREFIX = "/api/v1";

export function browserUrlFor(url: string): string {
  const valor = url.trim();
  if (valor === "") return valor;

  /* Só a rota e os parâmetros próprios do storage LOCAL permitem descartar
     o host. Reescrever qualquer URL externa quebraria assinaturas S3/MinIO. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(valor) || valor.startsWith("//")) {
    try {
      const parsed = new URL(valor.startsWith("//") ? `https:${valor}` : valor);
      const localStorage =
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.pathname === `${API_PREFIX}/storage/objects` &&
        ["bucket", "key", "operation", "expires", "signature"].every((key) =>
          parsed.searchParams.has(key),
        );
      if (localStorage) {
        return `${BFF_BASE_PATH}/storage/objects${parsed.search}${parsed.hash}`;
      }
    } catch {
      // O helper não transforma um endereço inválido em erro de renderização.
    }
    return valor;
  }

  if (valor === API_PREFIX || valor.startsWith(`${API_PREFIX}/`)) {
    return `${BFF_BASE_PATH}${valor.slice(API_PREFIX.length)}`;
  }

  /* Já é caminho do BFF, ou caminho de página: fica como está. Reescrever
     qualquer relativo transformaria um link de tela num pedido de API. */
  return valor;
}
