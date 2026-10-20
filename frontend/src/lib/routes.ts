/**
 * Mapa de rotas da aplicação.
 *
 * Fonte única usada pelo middleware, pelos guards e pelos redirecionamentos.
 * Ao criar uma área nova, registre-a aqui — e mantenha o `matcher` em
 * `proxy.ts` alinhado, já que o Next exige valores estáticos naquele arquivo.
 */
export const ROUTES = {
  home: "/",
  /**
   * Planos — a página comercial pública.
   *
   * Canônica e única: `/precos` não existe, e não deve passar a existir. Duas
   * rotas para a mesma pergunta dividem link, SEO e manutenção, e uma delas
   * envelhece.
   */
  plans: "/planos",
  login: "/login",
  register: "/cadastro",
  forgotPassword: "/recuperar-senha",
  resetPassword: "/redefinir-senha",
  invitation: "/convite",
  /**
   * O contrato do PMOC aberto por link temporário.
   *
   * **Deliberadamente fora de `PROTECTED_PREFIXES` e do `matcher` do middleware.**
   * Quem abre é o contratante, que não tem conta: proteger a rota mandaria o cliente
   * para uma tela de login que ele nunca vai conseguir passar.
   *
   * E deliberadamente **fora de `/pmoc`**, que é protegido por prefixo. Pendurar o
   * contrato em `/pmoc/contrato/:token` o colocaria atrás do portão por herança, e a
   * causa — um `:path*` no matcher — não apareceria em nenhum lugar desta linha.
   *
   * A credencial é o token no caminho, conferido pelo backend a cada chamada. Não há
   * sessão a validar aqui, e é por isso que também não está em `GUEST_PREFIXES`: um
   * dono autenticado precisa poder abrir o link que acabou de gerar para conferi-lo.
   */
  contract: "/contrato",
  dashboard: "/dashboard",
  operations: "/operacoes",
  pmoc: "/pmoc",
  /** RVT — visitas técnicas: configuração, ocorrências e execução. */
  rvt: "/rvt",
  /**
   * Resolução de etiqueta QR.
   *
   * O caminho é ditado pelo backend: o payload gravado no código é
   * `<origem>/q/<token>`. Mudá-lo aqui invalidaria toda etiqueta já impressa.
   */
  qr: "/q",
  /** Artifact Studio — configuração dos Artifact Templates. */
  artifacts: "/artefatos",
  /** Artifact Execution Workspace — execução e acompanhamento. */
  executions: "/execucoes",
  /** Document Center — documentos emitidos, revisões e renderização. */
  documents: "/documentos",
  /** Scheduling Workspace — agenda operacional. */
  scheduling: "/agenda",
  /** Asset Workspace — visão 360° do equipamento. */
  assets: "/ativos",
  /** Catalog Workspace — produtos, serviços e peças. */
  catalog: "/catalogo",
  /** Central de Catálogos: roteiros de atendimento e unidades de PMOC. */
  catalogs: "/catalogos",
  /** Workforce Management — equipe, convites e papéis. */
  team: "/equipe",
  /** Financial Workspace — lançamentos, categorias e relatórios. */
  financial: "/financeiro",
  /** Quotes Workspace — propostas comerciais. */
  quotes: "/orcamentos",
  /**
   * Reports Center — relatórios **gerenciais**.
   *
   * Não confundir com o Document Center (`/documentos`), que publica os
   * documentos emitidos pelo Artifact Engine, nem com o relatório operacional
   * de visita: aquele pertence a uma operação e é assinado; este é o retrato
   * agregado de um período.
   */
  managementReports: "/relatorios",
  /** Settings Workspace — governança da plataforma. */
  settings: "/configuracoes",
  /** Profile Workspace — a própria conta. */
  profile: "/perfil",
  /** Organization Workspace — administração da empresa. */
  organization: "/organizacao",
  /** Customer Workspace — visão 360° do cliente. */
  customers: "/clientes",
  /** Notification Center. */
  notifications: "/notificacoes",
  /** Landing do Platform Administrator (painel será implementado adiante). */
  platform: "/plataforma",
  designSystem: "/design-system",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Áreas de tenant — exigem sessão e organização. */
export const PROTECTED_PREFIXES: readonly string[] = [
  ROUTES.dashboard,
  ROUTES.operations,
  ROUTES.artifacts,
  ROUTES.executions,
  ROUTES.documents,
  ROUTES.scheduling,
  ROUTES.assets,
  ROUTES.catalog,
  ROUTES.catalogs,
  ROUTES.team,
  ROUTES.financial,
  ROUTES.quotes,
  ROUTES.managementReports,
  ROUTES.settings,
  ROUTES.profile,
  ROUTES.organization,
  ROUTES.customers,
  ROUTES.notifications,
  ROUTES.pmoc,
  ROUTES.rvt,
  /**
   * Ler a etiqueta não dispensa a sessão.
   *
   * `GET /assets/qr/:token` exige `assets.read`, então a rota que a consome é
   * protegida como qualquer outra — deixá-la aberta "para facilitar o scan"
   * criaria uma porta pública para o contexto de um equipamento.
   */
  ROUTES.qr,
];

/** Áreas exclusivas do Platform Administrator. */
export const PLATFORM_PREFIXES: readonly string[] = [
  ROUTES.platform,
  ROUTES.designSystem,
];

/** Áreas exclusivas de visitantes — usuário autenticado é redirecionado. */
export const GUEST_PREFIXES: readonly string[] = [
  ROUTES.login,
  ROUTES.register,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  ROUTES.invitation,
];

/**
 * Rotas que um usuário autenticado ainda pode abrir.
 *
 * Redefinir senha e aceitar convite podem acontecer com sessão ativa — quem
 * está logado e clica no link do e-mail não deve ser expulso para o dashboard.
 */
const GUEST_ALLOWED_WHEN_AUTHENTICATED: readonly string[] = [
  ROUTES.resetPassword,
  ROUTES.invitation,
];

const startsWith = (pathname: string, prefixes: readonly string[]): boolean =>
  prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

/**
 * A página de um membro da equipe.
 *
 * Três telas apontam para cá — a lista de usuários, a tabela de técnicos e a de
 * comissão —, e o caminho montado à mão nas três divergiria na primeira
 * renomeação.
 */
export function teamMemberRoute(userId: string): string {
  return `${ROUTES.team}/membros/${encodeURIComponent(userId)}`;
}

export function isProtectedPath(pathname: string): boolean {
  return startsWith(pathname, PROTECTED_PREFIXES);
}

export function isPlatformPath(pathname: string): boolean {
  return startsWith(pathname, PLATFORM_PREFIXES);
}

export function isGuestPath(pathname: string): boolean {
  return startsWith(pathname, GUEST_PREFIXES);
}

export function allowsAuthenticatedGuest(pathname: string): boolean {
  return startsWith(pathname, GUEST_ALLOWED_WHEN_AUTHENTICATED);
}

/** Destino padrão após autenticar, conforme o tipo de conta. */
export function homeRouteFor(options: { isPlatformAdmin: boolean }): string {
  return options.isPlatformAdmin ? ROUTES.platform : ROUTES.dashboard;
}

/** Motivo do redirecionamento para o login, exibido na tela. */
export const LOGIN_REASON_PARAM = "motivo";

export const LoginReason = {
  expired: "sessao-expirada",
  unauthorized: "sem-acesso",
} as const;

export type LoginReason = (typeof LoginReason)[keyof typeof LoginReason];

/**
 * A URL que o contratante recebe para assinar.
 *
 * `origin` é passado por quem chama, e não lido de `window`: o link é montado logo
 * depois da mutação, e esta função também é usada em teste — onde não há `window`.
 */
export function pmocContractUrl(origin: string, token: string): string {
  return `${origin}${ROUTES.contract}/${encodeURIComponent(token)}`;
}

export function loginUrl(reason?: LoginReason, redirectTo?: string): string {
  const params = new URLSearchParams();
  if (reason) params.set(LOGIN_REASON_PARAM, reason);
  if (redirectTo && redirectTo !== ROUTES.login)
    params.set("destino", redirectTo);
  const query = params.toString();
  return query ? `${ROUTES.login}?${query}` : ROUTES.login;
}
