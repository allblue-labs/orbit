"use client";

import { Search, LogOut, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SubscriptionBadge } from "@/components/billing/subscription-badge";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { NavItem } from "@/components/layout/sidebar";
import { useAvatar } from "@/hooks/profile/use-me-media";
import { initialsOf } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { useOptionalSession } from "@/providers";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar({
  onOpenCommand,
  navigation,
  activeLabel,
  breadcrumb,
  className,
}: {
  onOpenCommand: () => void;
  navigation?: { group: string; items: NavItem[] }[];
  activeLabel?: string;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const session = useOptionalSession();

  /**
   * A foto de quem está logado — que o topo simplesmente não tinha.
   *
   * O avatar era `OR` escrito à mão: nenhuma sessão, nenhuma consulta. Trocar a
   * foto em Minha conta funcionava e o topo continuava igual, o que faz a
   * pessoa trocar de novo achando que não salvou.
   *
   * A consulta é a mesma de Minha conta, com a mesma chave de cache: a troca já
   * invalida essa chave, então o topo acompanha sem nada a mais. O endereço é
   * assinado e expira — por isso `CACHE.fresh` lá, e por isso não guardamos a
   * URL em lugar nenhum.
   */
  const avatar = useAvatar();
  const foto = avatar.data?.available ? avatar.data.url : null;
  const pessoa = session?.user?.displayName ?? null;
  const iniciais = initialsOf(pessoa) || "?";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6",
        className,
      )}
    >
      {/*
        * Aqui havia um botão "Abrir menu" sem `onClick`. Abaixo de `lg` a barra
        * lateral é `hidden`, então quem entrasse pelo tablet ficava sem
        * navegação alguma. Agora o botão é o gatilho da gaveta.
        */}
      <MobileNav navigation={navigation} activeLabel={activeLabel} />
      <div className="lg:hidden">
        <OrbitLogo variant="mark" />
      </div>

      <div className="hidden min-w-0 flex-1 md:block">{breadcrumb}</div>

      <button
        type="button"
        onClick={onOpenCommand}
        aria-label="Abrir busca global (Command K)"
        className="glass ml-auto flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground md:w-72"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden md:inline">Buscar em tudo…</span>
        <kbd className="ml-auto hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] md:inline">
          ⌘K
        </kbd>
      </button>

      {/*
        O estado da assinatura, quando há o que dizer.

        Antes do sino de propósito: o vencimento muda o que a pessoa consegue
        fazer em toda tela, e um aviso disso não deve ficar atrás de um
        contador de notificações.
      */}
      <SubscriptionBadge />

      {/* Contador real de não lidas — ver components/notifications/notification-bell. */}
      <NotificationBell />
      {/*
        Aqui havia um botão de "alternar painéis" **sem `onClick`**: um ícone
        que existia desde o primeiro esqueleto da topbar e prometia um recurso
        inexistente. Quem clicasse não fazia nada e concluía que estava quebrado.

        O lugar passou a ser do tema, que é a troca que de fato acontece daqui.
      */}
      <ThemeToggle />

      <div className="flex items-center gap-2 pl-1">
        <Badge variant="outline" className="hidden lg:inline-flex">
          Workspace
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={pessoa ? `Conta de ${pessoa}` : "Minha conta"}
            >
              <Avatar className="size-8 ring-1 ring-border">
                {foto ? (
                  <AvatarImage src={foto} alt="" />
                ) : null}
                <AvatarFallback className="bg-gradient-orbit text-xs font-semibold text-primary-foreground">
                  {iniciais}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">
              {pessoa ?? "Minha conta"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={ROUTES.profile}>
                <UserRound className="size-4" />
                Minha conta
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={logout}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="size-4" />
              Encerrar sessão
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
