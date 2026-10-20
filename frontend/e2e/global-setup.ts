/**
 * Prontidão do ambiente, antes do primeiro teste.
 *
 * ## Por que existe
 *
 * Quando o endereço assinado do storage apontava para a porta interna do
 * container, quinze testes de RVT falhavam em cascata — o primeiro por
 * `ECONNREFUSED` no upload, os outros catorze por serem seriais. O diagnóstico
 * levava minutos e não estava no erro.
 *
 * Aqui as quatro dependências são verificadas em segundos, e cada falha diz o
 * que está errado e onde olhar. Nenhum valor de configuração é impresso: as
 * mensagens falam de serviço e de endereço, nunca de credencial.
 */
import { request, type FullConfig } from "@playwright/test";

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";
const WEB = process.env.ORBIT_WEB_URL ?? "http://127.0.0.1:3000";
const OWNER = {
  email: process.env.ORBIT_OWNER_EMAIL ?? "owner@orbit.local",
  password: process.env.ORBIT_OWNER_PASSWORD ?? "OrbitOwner@2026",
};

function fail(what: string, detail: string): never {
  throw new Error(
    `Ambiente E2E indisponível — ${what}.\n${detail}\n` +
      `Confira docs/e2e-ambiente.md.`,
  );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const api = await request.newContext();

  /** 1 · a aplicação Web responde. */
  const web = await api.get(`${WEB}/login`).catch(() => null);
  if (!web?.ok()) fail("o frontend não respondeu", `Esperado em ${WEB}.`);

  /** 2 · a API responde e autentica. */
  const session = await api
    .post(`${API}/identity/login`, {
      data: { email: OWNER.email, password: OWNER.password },
    })
    .catch(() => null);
  if (!session?.ok()) {
    fail(
      "a API não autenticou a conta de referência",
      `Esperada em ${API}. Verifique se o serviço subiu e se o seed foi aplicado.`,
    );
  }
  const token = (await session.json()).data.accessToken as string;
  const headers = { authorization: `Bearer ${token}` };

  /** 3 · o banco responde por trás da API. */
  const organization = await api.get(`${API}/organizations/current`, { headers });
  if (!organization.ok()) {
    fail(
      "a API não leu a organização",
      "A autenticação passou, então o problema está entre a API e o banco.",
    );
  }

  /**
   * 4 · o endereço assinado do storage é alcançável **deste host**.
   *
   * A reserva não grava nada de domínio: pede o endereço e verifica que o host
   * atende. É o passo que faltava — a URL vinha da API com a porta interna do
   * container e só falhava lá adiante, no meio do smoke de RVT.
   */
  const reservation = await api.post(`${API}/mobile/field/me/signature/upload`, {
    headers,
    data: { fileName: "prontidao.png", mimeType: "image/png", sizeBytes: 1 },
  });
  if (reservation.ok()) {
    const upload = (await reservation.json()).data?.upload as
      | { url: string }
      | undefined;
    if (upload?.url) {
      const host = new URL(upload.url).host;
      const reachable = await api
        .fetch(upload.url, { method: "HEAD", failOnStatusCode: false })
        .catch(() => null);
      if (!reachable) {
        fail(
          `o storage devolveu um endereço que este host não alcança (${host})`,
          "STORAGE_LOCAL_PUBLIC_URL precisa apontar para a porta publicada da API, " +
            "não para a porta interna do container.",
        );
      }
    }
  }

  await api.dispose();
}
