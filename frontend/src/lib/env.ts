/**
 * Configuração de ambiente do Frontend Core.
 *
 * `serverEnv` só pode ser lido em código de servidor (Route Handlers,
 * middleware, Server Components). O browser usa apenas `publicEnv`.
 */

const DEFAULT_BACKEND_ORIGIN = "http://localhost:3001/api/v1";

/** Prefixo do BFF. Todo tráfego do browser passa por aqui. */
export const BFF_BASE_PATH = "/api/orbit";

/** Rotas de autenticação do BFF (fora do proxy genérico). */
export const BFF_AUTH_PATH = "/api/auth";

/**
 * Consulta de CEP no BFF (fora do proxy genérico).
 *
 * Não é rota do backend: quem responde é o próprio servidor do frontend, que
 * fala com o serviço público dos Correios. O navegador continua conversando só
 * com a nossa origem.
 */
export const BFF_POSTAL_PATH = "/api/cep";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
export const DEFAULT_LOCALE = "pt-BR";
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/** Limite aplicado pelo backend em `FileInterceptor` (20 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function isServer(): boolean {
  return typeof window === "undefined";
}

export function assertServer(context: string): void {
  if (!isServer()) {
    throw new Error(
      `${context} só pode ser executado no servidor. Use o cliente do BFF (@/api).`,
    );
  }
}

export const serverEnv = {
  /** URL interna do NestJS. Nunca exposta ao browser. */
  get backendOrigin(): string {
    assertServer("serverEnv.backendOrigin");
    const configured = process.env.ORBIT_API_URL?.trim();
    if (!configured && process.env.NODE_ENV === "production") {
      throw new Error("ORBIT_API_URL is required in production");
    }
    const origin = configured || DEFAULT_BACKEND_ORIGIN;
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("ORBIT_API_URL must be an absolute HTTP(S) URL");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("ORBIT_API_URL must be an absolute HTTP(S) URL");
    }
    return origin.replace(/\/+$/, "");
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  /**
   * As origens públicas canônicas do Next/BFF.
   *
   * `request.url` pode conter o host interno do container ou do reverse proxy;
   * por isso ele não é autoridade suficiente para validar `Origin` em
   * produção. Cada origem configurada é deliberadamente exata e não aceita
   * path, credenciais, query string ou fragmento.
   *
   * ## Por que é uma lista
   *
   * `FRONTEND_ORIGIN` é lido por **dois** processos, e o backend sempre o
   * tratou como lista separada por vírgula (`configure-api.ts`, para o CORS).
   * Aqui ele era lido como origem única, e `new URL()` sobre
   * `http://localhost:3000,https://orbit.exemplo` lança — ou seja, a mesma
   * variável que fazia o backend aceitar dois ambientes derrubava todo pedido
   * ao BFF com 500.
   *
   * Um implantação serve mais de uma origem legítima com frequência —
   * `localhost` no smoke local, o domínio público em produção. O que continua
   * proibido é curinga: cada entrada é validada inteira, e a comparação em
   * [isSameOriginRequest] segue sendo de igualdade exata.
   */
  get frontendOrigins(): readonly string[] {
    const configured = process.env.FRONTEND_ORIGIN?.trim();
    if (!configured) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("FRONTEND_ORIGIN is required in production");
      }
      return [];
    }

    const entries = configured
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("FRONTEND_ORIGIN is required in production");
      }
      return [];
    }

    return entries.map((entry) => {
      if (entry === "*") {
        throw new Error("FRONTEND_ORIGIN must never contain a wildcard");
      }

      let parsed: URL;
      try {
        parsed = new URL(entry);
      } catch {
        throw new Error("FRONTEND_ORIGIN must be an exact HTTP(S) origin");
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error("FRONTEND_ORIGIN must be an exact HTTP(S) origin");
      }
      if (
        process.env.NODE_ENV === "production" &&
        parsed.protocol !== "https:" &&
        process.env.ALLOW_INSECURE_LOCAL_COOKIES !== "true"
      ) {
        throw new Error(
          "FRONTEND_ORIGIN must use HTTPS outside an explicit local-only runtime",
        );
      }
      return parsed.origin;
    });
  },
  /**
   * Cookies Secure exigem HTTPS. Deploys locais em HTTP precisam desabilitar
   * explicitamente essa flag; produção pública deve mantê-la habilitada.
   */
  get authCookieSecure(): boolean {
    const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
    if (configured === "true") return true;
    if (configured === "false") {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_INSECURE_LOCAL_COOKIES !== "true"
      ) {
        throw new Error(
          "AUTH_COOKIE_SECURE=false requires ALLOW_INSECURE_LOCAL_COOKIES=true in a local-only runtime",
        );
      }
      return false;
    }
    return process.env.NODE_ENV === "production";
  },
} as const;

export const publicEnv = {
  bffBasePath: BFF_BASE_PATH,
  authBasePath: BFF_AUTH_PATH,
} as const;

/** Monta uma URL absoluta para o backend a partir de um path da API. */
export function backendUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${serverEnv.backendOrigin}${normalized}`;
}
