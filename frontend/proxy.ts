/**
 * Middleware de autenticação (Next 16 — antigo `middleware.ts`).
 *
 * Portão de navegação. Responsabilidades:
 *
 * - manter os cookies de sessão rotacionados antes de qualquer Server
 *   Component executar (por isso Server Components nunca renovam tokens);
 * - impedir que rota protegida renderize sem sessão;
 * - tirar quem já está autenticado das telas de visitante;
 * - separar as áreas de tenant e de plataforma pelo papel do usuário;
 * - sinalizar sessão expirada para o login exibir a mensagem certa.
 *
 * A expiração do access token é avaliada localmente (sem round-trip) e a
 * renovação usa o refresh token, que o NestJS valida de fato. A autoridade
 * sobre autenticação e permissões continua sendo do backend: toda chamada de
 * dados passa pelo BFF e é verificada lá. Aqui a decisão é só de navegação.
 *
 * O middleware conhece apenas o que está nas claims do token (papéis,
 * permissões e escopo). Regras que dependem de dados do backend — plano,
 * capabilities, troca de senha obrigatória — ficam nos guards de rota, que
 * enxergam a sessão completa.
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  LoginReason,
  ROUTES,
  allowsAuthenticatedGuest,
  homeRouteFor,
  isGuestPath,
  isPlatformPath,
  isProtectedPath,
  loginUrl,
} from "@/lib/routes";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  writeSessionCookies,
} from "@/server/auth/cookies";
import { decodeAccessToken, claimList, isExpired } from "@/server/auth/jwt";
import { refreshTokens } from "@/server/auth/refresh";
import { PLATFORM_ADMIN_ROLE, type AccessTokenClaims } from "@/types/session";
import type { TokenPair } from "@/types/session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isProtected = isProtectedPath(pathname);
  const isPlatform = isPlatformPath(pathname);
  const isGuest = isGuestPath(pathname);
  if (!isProtected && !isPlatform && !isGuest) return NextResponse.next();

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  let claims = accessToken ? decodeAccessToken(accessToken) : null;

  let rotated: TokenPair | null = null;
  let authenticated = Boolean(claims && !isExpired(claims));

  if (!authenticated && refreshToken) {
    rotated = await refreshTokens(refreshToken);
    claims = rotated ? decodeAccessToken(rotated.accessToken) : null;
    authenticated = Boolean(rotated);
  }

  const destination = authenticated
    ? destinationForSession(claims, pathname, {
        isGuest,
        isProtected,
        isPlatform,
      })
    : destinationForVisitor(pathname, {
        isProtected,
        isPlatform,
        hadSession: Boolean(accessToken ?? refreshToken),
      });

  const response = destination
    ? NextResponse.redirect(new URL(destination, request.url))
    : NextResponse.next();

  if (rotated) {
    writeSessionCookies(response.cookies, rotated);
  } else if (!authenticated && (accessToken ?? refreshToken)) {
    clearSessionCookies(response.cookies);
  }
  return response;
}

interface AreaFlags {
  isGuest: boolean;
  isProtected: boolean;
  isPlatform: boolean;
}

/** Para onde mandar um usuário autenticado que abriu esta rota. */
function destinationForSession(
  claims: AccessTokenClaims | null,
  pathname: string,
  area: AreaFlags,
): string | null {
  const isPlatformAdmin = claimList(claims?.roles).includes(
    PLATFORM_ADMIN_ROLE,
  );
  const home = homeRouteFor({ isPlatformAdmin });

  if (area.isGuest) {
    /**
     * Redefinir senha e aceitar convite continuam acessíveis com sessão: quem
     * está logado e clica no link do e-mail não deve ser expulso — e o guard
     * de troca de senha obrigatória depende disso.
     */
    return allowsAuthenticatedGuest(pathname) ? null : home;
  }
  /** Sem organização nas claims, as rotas de tenant responderiam 403. */
  if (area.isProtected && isPlatformAdmin && !claims?.organizationId) {
    return ROUTES.platform;
  }
  if (area.isPlatform && !isPlatformAdmin) {
    return ROUTES.dashboard;
  }
  return null;
}

/** Para onde mandar um visitante que abriu esta rota. */
function destinationForVisitor(
  pathname: string,
  options: { isProtected: boolean; isPlatform: boolean; hadSession: boolean },
): string | null {
  if (!options.isProtected && !options.isPlatform) return null;
  return loginUrl(
    options.hadSession ? LoginReason.expired : undefined,
    pathname,
  );
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/operacoes/:path*",
    "/artefatos/:path*",
    "/execucoes/:path*",
    "/documentos/:path*",
    "/agenda/:path*",
    "/ativos/:path*",
    "/pmoc/:path*",
    "/rvt/:path*",
    "/q/:path*",
    "/catalogo/:path*",
    "/equipe/:path*",
    "/financeiro/:path*",
    "/orcamentos/:path*",
    "/relatorios/:path*",
    "/configuracoes/:path*",
    "/perfil/:path*",
    "/organizacao/:path*",
    "/clientes/:path*",
    "/notificacoes/:path*",
    "/plataforma/:path*",
    "/design-system/:path*",
    "/login",
    "/cadastro",
    "/recuperar-senha",
    "/redefinir-senha",
    "/convite",
  ],
};
