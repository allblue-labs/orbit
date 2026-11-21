"use client";

/**
 * A casca da área do cliente na web: cabeçalho, navegação e o porteiro.
 *
 * O porteiro pergunta ao BFF do cliente quem está logado. Sem sessão, login;
 * com senha temporária, a troca vem antes de qualquer página. Nenhuma rota da
 * equipe aparece aqui, e o BFF do cliente nem sabe chegar nelas.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  FileText,
  Home,
  LifeBuoy,
  Loader2,
  LogOut,
  Snowflake,
  UserRound,
} from "lucide-react";

import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { browserUrlFor } from "@/lib/backend-url";
import { cn } from "@/lib/utils";
import { PortalSessionExpired } from "@/portal/portal-client";
import {
  usePortalLogout,
  usePortalProfile,
  usePortalSession,
} from "@/portal/portal-hooks";
import { PortalChangePassword } from "./portal-change-password";
import { BiometricOffer } from "@/components/auth/biometric-offer";

export const PORTAL_ROUTES = {
  login: "/portal/entrar",
  home: "/portal",
  requests: "/portal/chamados",
  equipment: "/portal/equipamentos",
  documents: "/portal/documentos",
  profile: "/portal/perfil",
} as const;

const NAV = [
  { href: PORTAL_ROUTES.home, label: "Início", icon: Home },
  { href: PORTAL_ROUTES.requests, label: "Chamados", icon: LifeBuoy },
  { href: PORTAL_ROUTES.equipment, label: "Equipamentos", icon: Snowflake },
  { href: PORTAL_ROUTES.documents, label: "Documentos", icon: FileText },
] as const;

export function initialsOf(name: string | undefined): string {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]!.toUpperCase())
    .join("");
}

export function PortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = usePortalSession();
  const profile = usePortalProfile();
  const logout = usePortalLogout();
  const me = session.data;

  const expirou = session.error instanceof PortalSessionExpired;
  useEffect(() => {
    if (expirou) router.replace(PORTAL_ROUTES.login);
  }, [expirou, router]);

  if (session.isPending || expirou) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Carregando…
      </div>
    );
  }
  if (session.error || !me) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Não foi possível abrir a área do cliente agora.
        </p>
        <button
          type="button"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => void session.refetch()}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (me.mustChangePassword) return <PortalChangePassword required me={me} />;

  const avatar = profile.data?.avatar.url
    ? browserUrlFor(profile.data.avatar.url)
    : undefined;

  const sair = () =>
    logout.mutate(undefined, {
      onSettled: () => router.replace(PORTAL_ROUTES.login),
    });

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
          <Link href={PORTAL_ROUTES.home} className="flex items-center gap-3">
            <OrbitLogo variant="mark" className="h-7 w-auto" />
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-semibold">
                {me.customer.displayName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                Atendido por {me.organization.displayName}
              </span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Área do cliente">
            {NAV.map((item) => (
              <NavLink key={item.href} {...item} active={ativo(pathname, item.href)} />
            ))}
          </nav>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="ml-auto rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:ml-2"
              aria-label="Seu perfil"
            >
              <Avatar className="size-9">
                {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initialsOf(me.identity.displayName)}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="space-y-0.5">
                <p className="truncate text-sm font-medium">{me.identity.displayName}</p>
                <p className="truncate text-xs font-normal text-muted-foreground">
                  {me.identity.email}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={PORTAL_ROUTES.profile}>
                  <UserRound className="size-4" />
                  Meu perfil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={sair} className="text-destructive">
                <LogOut className="size-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:pb-12">{children}</main>
      <BiometricOffer audience="portal" settingsHint="Perfil" />

      {/* No celular, a navegação fica embaixo — como no app. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Área do cliente"
      >
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
              ativo(pathname, href) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function ativo(pathname: string, href: string): boolean {
  return href === PORTAL_ROUTES.home
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
