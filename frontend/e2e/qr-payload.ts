/**
 * Leitura do QR renderizado — instrumentação de teste, não código de produto.
 *
 * O gate de opacidade do payload só vale se alguém **decodificar de verdade**
 * o código que o backend imprimiu. Confiar no que o servidor diz ter gravado
 * provaria apenas que ele concorda consigo mesmo; o que importa é o que sai da
 * imagem que vai colada no equipamento.
 *
 * `sharp` converte o PNG em pixels e `jsQR` lê os módulos — as duas já
 * existiam no repositório. Nada disso entra no bundle: este arquivo só é
 * carregado pelo Playwright.
 */
import jsQR from "jsqr";
import sharp from "sharp";

/** O que está gravado no código, exatamente como um leitor de etiqueta veria. */
export async function decodePayload(png: Buffer): Promise<string> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (!decoded) throw new Error("não foi possível ler o QR renderizado");
  return decoded.data;
}

/**
 * O token dentro do payload.
 *
 * A extração é deliberadamente estrita: o payload precisa ser uma URL cujo
 * caminho seja `/q/<token>` e nada mais. Um payload que trouxesse parâmetros,
 * fragmento ou outro caminho reprovaria aqui — que é justamente o ponto.
 */
export async function extractToken(png: Buffer): Promise<string> {
  const payload = await decodePayload(png);
  const url = new URL(payload);
  const match = /^\/q\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (!match) throw new Error(`payload fora do contrato: ${url.pathname}`);
  expectNoSearch(url);
  return match[1]!;
}

function expectNoSearch(url: URL): void {
  if (url.search || url.hash) {
    throw new Error("payload carrega parâmetros além do token");
  }
}
