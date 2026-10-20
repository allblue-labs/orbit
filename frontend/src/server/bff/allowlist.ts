/**
 * Superfície de API exposta pelo proxy do BFF.
 *
 * O proxy não é um túnel aberto: só encaminha os prefixos abaixo, que
 * correspondem aos controllers do NestJS. Ao criar um módulo novo no backend,
 * registre a raiz aqui — é o único ponto a alterar no Frontend Core.
 */
import type { HttpMethod } from "@/types/api";

/** Raízes correspondentes aos `@Controller(...)` do backend. */
export const ALLOWED_API_ROOTS: readonly string[] = [
  "ai-agents",
  "ai-executions",
  "analytics",
  "artifact-executions",
  "artifact-manifests",
  "artifact-rendering",
  "artifact-templates",
  "assets",
  "automations",
  "billing",
  "catalog",
  "checklist-executions",
  "checklist-templates",
  "commissions",
  "customers",
  "dashboard",
  "financial",
  "identity",
  "integrations",
  "inventory",
  "issued-documents",
  "management-reports",
  "notifications",
  "operations",
  "pmoc",
  "organizations",
  "plans",
  "platform-admin",
  /** Contrato de PMOC assinado por link — ver `PUBLIC_ENDPOINT_PATTERNS`. */
  "public",
  "quotes",
  "report-templates",
  "reports",
  "rvt",
  "scheduling",
  /**
   * Objetos de storage.
   *
   * O navegador precisa alcançar o destino de um upload assinado — foto de
   * perfil e assinatura chegam por aí. A URL assinada aponta para o backend, e
   * o navegador só fala com o proxy: sem esta raiz, o envio morre em 404.
   *
   * A assinatura na URL continua sendo a credencial do objeto, e o proxy ainda
   * exige sessão. Duas barreiras, não uma.
   */
  "storage",
  "workforce",
];

/**
 * Rotas de identidade que emitem ou revogam tokens. Precisam do tratamento de
 * cookies `HttpOnly` das rotas dedicadas (`/api/auth/*`); se passassem pelo
 * proxy genérico, o par de tokens voltaria no corpo da resposta e ficaria
 * acessível ao JavaScript da página.
 */
const TOKEN_ROUTES: readonly string[] = [
  "/identity/login",
  "/identity/register",
  "/identity/refresh",
  "/identity/logout",
];

/**
 * Endpoints marcados com `@Public()` no backend, encaminhados sem sessão.
 *
 * São os fluxos que acontecem justamente quando o usuário não está
 * autenticado: escolha de plano no onboarding, recuperação de senha e aceite
 * de convite. A correspondência é exata (método + caminho) para que o proxy
 * continue exigindo sessão em todo o resto.
 */
const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set([
  "GET /plans",
  "POST /identity/password/forgot",
  "POST /identity/password/reset",
  "POST /identity/invitations/accept",
]);

/**
 * Rotas públicas cujo caminho carrega um segredo — e por isso não casam por igualdade.
 *
 * O conjunto acima compara método e caminho exatos, de propósito: é o que mantém o
 * proxy exigindo sessão em todo o resto. Um link de assinatura traz o token **no
 * caminho**, então nenhuma string fixa o descreve.
 *
 * Cada padrão é ancorado nas duas pontas e descreve o formato do segredo, não um
 * curinga: `[A-Za-z0-9_-]{32,128}` é a forma de um token `base64url` de 48 bytes.
 * Sem a âncora e sem a forma, `^/public/` viraria uma porta aberta para qualquer
 * caminho que alguém pendurasse ali depois.
 *
 * A comparação recebe o caminho em minúsculas, e a classe aceita as duas caixas de
 * propósito: um token `base64url` é sensível a caixa, e restringir a classe ao que a
 * normalização deixa passar amarraria este padrão a esse detalhe de `inspectPath`.
 * Quem segue para o backend é o caminho original — a caixa do token sobrevive.
 */
const PUBLIC_ENDPOINT_PATTERNS: readonly { method: HttpMethod; path: RegExp }[] =
  [
    {
      method: "GET",
      path: /^\/public\/pmoc\/contracts\/[A-Za-z0-9_-]{32,128}$/,
    },
    {
      method: "POST",
      path: /^\/public\/pmoc\/contracts\/[A-Za-z0-9_-]{32,128}\/signature$/,
    },
  ];

export type PathVerdict =
  | { allowed: true; requiresSession: boolean }
  | { allowed: false; status: 403 | 404; message: string };

export function inspectPath(path: string, method: HttpMethod): PathVerdict {
  const root = path.split("/")[1] ?? "";
  if (!ALLOWED_API_ROOTS.includes(root)) {
    return {
      allowed: false,
      status: 404,
      message: `Recurso "${root}" não é exposto pelo BFF.`,
    };
  }
  const normalized = path.toLowerCase();
  if (TOKEN_ROUTES.includes(normalized)) {
    return {
      allowed: false,
      status: 403,
      message: "Use as rotas de autenticação em /api/auth.",
    };
  }
  return {
    allowed: true,
    requiresSession: !isPublic(normalized, method),
  };
}

/**
 * O caminho dispensa sessão?
 *
 * Igualdade primeiro, padrão depois — e o padrão só para o que não cabe em igualdade.
 * Toda regra aqui amplia o que o proxy encaminha sem credencial, e é por isso que elas
 * ficam neste arquivo e não espalhadas por quem precisa delas.
 */
function isPublic(normalized: string, method: HttpMethod): boolean {
  if (PUBLIC_ENDPOINTS.has(`${method} ${normalized}`)) return true;
  return PUBLIC_ENDPOINT_PATTERNS.some(
    (regra) => regra.method === method && regra.path.test(normalized),
  );
}
