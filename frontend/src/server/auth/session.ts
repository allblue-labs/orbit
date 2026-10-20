/**
 * Sessão do lado servidor.
 *
 * Responsável por ler os cookies `HttpOnly`, conhecer o escopo ativo, renovar
 * o par de tokens (com deduplicação) e montar o estado de sessão entregue ao
 * browser — sempre sem expor tokens.
 */
import { cookies } from "next/headers";

import { ApiError } from "@/lib/api-error";
import { backendJson, jsonBody } from "@/server/backend-client";
import type {
  AccessTokenClaims,
  AuthenticatedSession,
  LoginInput,
  RegisterInput,
  SessionEntitlements,
  SessionAccess,
  SessionProductAccess,
  SessionOrganization,
  SessionState,
  SessionUser,
  TokenPair,
} from "@/types/session";
import { ANONYMOUS_SESSION, PLATFORM_ADMIN_ROLE } from "@/types/session";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  type CookieWriter,
  clearSessionCookies,
  writeSessionCookies,
} from "./cookies";
import { assinaturaVigente } from "@/components/billing/subscription-status";
import { claimList, decodeAccessToken, expiresAtIso, isExpired } from "./jwt";
import { refreshTokens } from "./refresh";

export { refreshTokens };

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

export interface ResolvedAccess {
  accessToken: string | null;
  claims: AccessTokenClaims | null;
  /** Novo par emitido nesta chamada. O chamador precisa persistí-lo. */
  rotated: TokenPair | null;
  /** `true` quando a sessão não pôde ser recuperada e deve ser encerrada. */
  expired: boolean;
}

export async function readStoredTokens(): Promise<StoredTokens> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: store.get(REFRESH_COOKIE)?.value ?? null,
  };
}

/**
 * Resolve o access token utilizável na requisição atual.
 *
 * `allowRefresh` só deve ser habilitado onde é possível gravar cookies
 * (Route Handlers, Server Actions e middleware). Em Server Components a
 * renovação é feita antes, pelo middleware — renovar sem poder persistir o
 * novo refresh token invalidaria a sessão do usuário.
 */
export async function resolveAccess(
  options: { allowRefresh?: boolean } = {},
): Promise<ResolvedAccess> {
  const { accessToken, refreshToken } = await readStoredTokens();
  const claims = accessToken ? decodeAccessToken(accessToken) : null;
  const usable = claims && !isExpired(claims);

  if (accessToken && usable) {
    return { accessToken, claims, rotated: null, expired: false };
  }
  if (!options.allowRefresh || !refreshToken) {
    return {
      accessToken: null,
      claims: null,
      rotated: null,
      expired: Boolean(accessToken ?? refreshToken),
    };
  }

  const rotated = await refreshTokens(refreshToken);
  if (!rotated) {
    return { accessToken: null, claims: null, rotated: null, expired: true };
  }
  return {
    accessToken: rotated.accessToken,
    claims: decodeAccessToken(rotated.accessToken),
    rotated,
    expired: false,
  };
}

/** Estado de sessão entregue ao browser (sem tokens). */
export async function buildSessionState(
  accessToken: string,
  claims: AccessTokenClaims,
): Promise<SessionState> {
  try {
    /**
     * O perfil é obrigatório; organização e plano só existem para usuários de
     * tenant. Um Platform Administrator não pertence a nenhuma organização,
     * então essas chamadas nem são disparadas para ele.
     */
    const [user, access, organization, entitlements, productAccess] =
      await Promise.all([
        backendJson<SessionUser & { mustChangePassword?: boolean }>({
          path: "/identity/me",
          accessToken,
          retries: 0,
        }),
        backendJson<SessionAccess>({
          path: "/identity/me/access",
          accessToken,
          retries: 0,
        }),
        claims.organizationId
          ? tolerate(
              backendJson<SessionOrganization>({
                path: "/organizations/current",
                accessToken,
                retries: 0,
              }),
            )
          : null,
        claims.organizationId
          ? tolerate(
              backendJson<SessionEntitlements>({
                path: "/organizations/current/subscription",
                accessToken,
                retries: 0,
              }),
            )
          : null,
        claims.organizationId
          ? tolerate(
              backendJson<SessionProductAccess>({
                path: "/organizations/current/product-access",
                accessToken,
                retries: 0,
              }),
            )
          : null,
      ]);

    const subscriptionStatus =
      entitlements?.subscriptionStatus ?? organization?.subscriptionStatus;
    const roles = claimList(access.roles);
    const isPlatformAdmin = roles.includes(PLATFORM_ADMIN_ROLE);
    const unitIds = claimList(access.unitIds);

    const session: AuthenticatedSession = {
      authenticated: true,
      user,
      scope: {
        organizationId: claims.organizationId,
        businessUnitId:
          claims.businessUnitId && unitIds.includes(claims.businessUnitId)
            ? claims.businessUnitId
            : (unitIds[0] ?? null),
        businessUnitIds: unitIds,
      },
      roles: claimList(access.roles),
      permissions: claimList(access.permissions),
      isOwner: access.isOwner,
      surfaceAccess: claimList(access.surfaceAccess),
      sessionId: claims.sid,
      expiresAt: expiresAtIso(claims),
      organization,
      businessUnits: organization?.businessUnits ?? [],
      entitlements,
      productAccess,
      organizations: organization
        ? [
            {
              id: organization.id,
              displayName: organization.displayName,
              slug: organization.slug,
              isActive: true,
            },
          ]
        : [],
      isPlatformAdmin,
      /**
       * A mesma conta que o backend faz, e não uma aproximação — ver
       * `assinaturaVigente`. Sem sessão de organização, quem responde é o
       * papel de plataforma.
       */
      subscriptionActive: subscriptionStatus
        ? assinaturaVigente(
            subscriptionStatus,
            entitlements?.currentPeriodEnd ??
              organization?.currentPeriodEnd ??
              null,
          )
        : isPlatformAdmin,
      subscriptionEndsAt:
        entitlements?.currentPeriodEnd ??
        organization?.currentPeriodEnd ??
        null,
      requiresPasswordChange: user.mustChangePassword === true,
    };
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      return ANONYMOUS_SESSION;
    }
    throw error;
  }
}

/**
 * Converte falhas esperadas em `null`.
 *
 * `GET /organizations/current` exige assinatura ativa (`@RequiresActivePlan`) e
 * responde 403 quando o plano está vencido — a sessão precisa existir mesmo
 * assim, para que a aplicação mostre o estado de assinatura bloqueada em vez
 * de derrubar o usuário para o login.
 */
async function tolerate<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && !error.isUnauthorized) return null;
    throw error;
  }
}

/** Autentica no backend e devolve o par de tokens (sem gravar cookies). */
export function login(input: LoginInput): Promise<TokenPair> {
  return backendJson<TokenPair>({
    method: "POST",
    path: "/identity/login",
    body: jsonBody({ client: "WEB", ...input }),
    retries: 0,
  });
}

/** Cria organização + usuário e devolve o par de tokens. */
export function register(input: RegisterInput): Promise<TokenPair> {
  return backendJson<TokenPair>({
    method: "POST",
    path: "/identity/register",
    body: jsonBody({ client: "WEB", ...input }),
    retries: 0,
  });
}

/** Encerra a sessão no backend. Falhas são silenciosas: o cookie some de todo modo. */
export async function logout(tokens: StoredTokens): Promise<void> {
  if (!tokens.accessToken) return;
  await backendJson<void>({
    method: "POST",
    path: "/identity/logout",
    accessToken: tokens.accessToken,
    body: jsonBody({ refreshToken: tokens.refreshToken ?? undefined }),
    retries: 0,
  }).catch(() => undefined);
}

export function persistSession(writer: CookieWriter, tokens: TokenPair): void {
  writeSessionCookies(writer, tokens);
}

export function endSession(writer: CookieWriter): void {
  clearSessionCookies(writer);
}
