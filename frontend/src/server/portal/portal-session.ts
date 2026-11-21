/**
 * A sessão do cliente na web — BFF próprio, separado da sessão da equipe.
 *
 * Como o documento de segurança do portal pede: cookies com nome próprio
 * (`orbit_portal_*`), HttpOnly, nunca os da equipe nem `localStorage`. O token
 * do cliente só é enviado ao backend pelas rotas `/api/portal/*`, e só para
 * caminhos `/portal/...` — o servidor recusaria o resto de qualquer jeito, e
 * aqui ele nem chega a sair.
 */
import { serverEnv } from "@/lib/env";
import { backendJson, jsonBody } from "@/server/backend-client";

export const PORTAL_ACCESS_COOKIE = "orbit_portal_access";
export const PORTAL_REFRESH_COOKIE = "orbit_portal_refresh";

export interface PortalTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PortalSessionPayload extends PortalTokens {
  me: unknown;
}

interface CookieWriter {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: true;
      sameSite: "lax";
      secure: boolean;
      path: string;
      maxAge: number;
    },
  ): unknown;
  delete(name: string): unknown;
}

const base = (maxAge: number) => ({
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: serverEnv.authCookieSecure,
  path: "/",
  maxAge,
});

export function persistPortalSession(
  writer: CookieWriter,
  tokens: PortalTokens,
): void {
  writer.set(
    PORTAL_ACCESS_COOKIE,
    tokens.accessToken,
    base(tokens.expiresIn > 0 ? Math.floor(tokens.expiresIn) : 15 * 60),
  );
  writer.set(PORTAL_REFRESH_COOKIE, tokens.refreshToken, base(30 * 24 * 3600));
}

export function endPortalSession(writer: CookieWriter): void {
  writer.delete(PORTAL_ACCESS_COOKIE);
  writer.delete(PORTAL_REFRESH_COOKIE);
}

/** `exp` do JWT, sem validar assinatura — quem valida é o backend. */
export function portalTokenExpired(token: string | undefined): boolean {
  if (!token) return true;
  const partes = token.split(".");
  if (partes.length !== 3) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(
        partes[1]!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as { exp?: number; actorType?: string };
    if (payload.actorType !== "CUSTOMER_PORTAL") return true;
    return (
      typeof payload.exp === "number" &&
      payload.exp - 30 <= Math.floor(Date.now() / 1000)
    );
  } catch {
    return true;
  }
}

export function portalLogin(
  input: { email: string; password: string },
  userAgent: string | null,
): Promise<PortalSessionPayload> {
  return backendJson<PortalSessionPayload>({
    method: "POST",
    path: "/portal/auth/login",
    body: jsonBody({
      email: String(input.email ?? "")
        .trim()
        .toLowerCase(),
      password: String(input.password ?? ""),
    }),
    headers: userAgent ? { "user-agent": userAgent } : {},
    retries: 0,
  });
}

/** Renova; `null` quando a sessão não vale mais. */
export async function portalRefresh(
  refreshToken: string | undefined,
): Promise<PortalSessionPayload | null> {
  if (!refreshToken) return null;
  try {
    return await backendJson<PortalSessionPayload>({
      method: "POST",
      path: "/portal/auth/refresh",
      body: jsonBody({ refreshToken }),
      retries: 0,
    });
  } catch {
    return null;
  }
}

export async function portalLogout(accessToken: string | undefined) {
  if (!accessToken) return;
  try {
    await backendJson({
      method: "POST",
      path: "/portal/auth/logout",
      accessToken,
      retries: 0,
    });
  } catch {
    /* A sessão local some de qualquer jeito. */
  }
}

/**
 * Só o que o cliente pode chamar: `/portal/me/...` e a troca de senha.
 * Login, renovação e saída têm rotas próprias, que cuidam dos cookies.
 */
export function portalPathAllowed(path: string, method: string): boolean {
  const normalizado = path.toLowerCase();
  if (normalizado.includes("..") || normalizado.includes("//")) return false;
  /* A credencial de aparelho é do app: na web, segredo nenhum chega à página. */
  if (normalizado === "/portal/me/biometrics/devices") return false;
  if (normalizado === "/portal/me" || normalizado.startsWith("/portal/me/"))
    return true;
  return method === "PATCH" && normalizado === "/portal/auth/password";
}
