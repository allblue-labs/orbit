"use client";

/**
 * Sino com as notificações recentes.
 *
 * ## Por que virou popup, e o menu perdeu a entrada
 *
 * "Notificações" ocupava uma linha no menu de Administração, ao lado de Equipe
 * e Configurações — coisas que se visita para **decidir**. Notificação não é
 * isso: ela se consulta de passagem, no meio de outra tarefa, e quase sempre a
 * pergunta é "tem algo novo?", não "quero abrir a central".
 *
 * O sino já estava na topbar e já sabia o número. Faltava ele responder à
 * pergunta sem tirar a pessoa de onde ela estava.
 *
 * ## O que o popup mostra
 *
 * As cinco mais recentes, com as não lidas destacadas, e "Ver todas" para a
 * central — que continua existindo por rota, com filtro, paginação e marcação
 * em massa. O popup é atalho, não substituto.
 *
 * ## Abrir não é ler
 *
 * Espiar o sino **não** marca nada como lido. Marcar ao abrir zeraria o
 * contador de quem só queria conferir, e a notificação que importava sumiria
 * do destaque sem ninguém ter lido. Ler é clicar na notificação.
 */
import { useState } from "react";
import Link from "next/link";
import { Bell, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  NotificationCategoryIcon,
  relativeTime,
} from "@/components/notifications/notification-presentation";
import {
  useDeduplicated,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/notifications/use-notifications";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { OrbitNotification } from "@/types/notifications";

/** Quantas cabem sem virar rolagem longa dentro de um popup. */
const RECENTES = 5;

export function NotificationBell({ className }: { className?: string }) {
  const [aberto, setAberto] = useState(false);
  const { unread, error } = useUnreadCount();

  /**
   * Falha de leitura não vira alarme.
   *
   * Sem `notifications.read` no plano, ou com o backend fora, o sino continua
   * clicável e simplesmente não mostra número — é a central que explica o que
   * houve, com o erro do servidor.
   */
  const showCount = !error && unread > 0;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
          aria-label={
            showCount ? `Notificações — ${unread} não lida(s)` : "Notificações"
          }
        >
          <Bell className="size-4" />
          {showCount ? (
            <span
              className={cn(
                "bg-gradient-orbit absolute flex items-center justify-center rounded-full font-medium text-white tabular-nums",
                unread > 9
                  ? "top-1 right-0.5 h-4 min-w-4 px-1 text-[10px]"
                  : "top-1.5 right-1.5 size-3.5 text-[9px]",
              )}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0">
        {/* Só consulta quando está aberto: o contador já roda em polling, e
            uma segunda consulta permanente custaria a mesma banda para uma
            lista que ninguém está vendo. */}
        {aberto ? <Recentes onNavigate={() => setAberto(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function Recentes({ onNavigate }: { onNavigate: () => void }) {
  const lista = useNotifications({ page: 1, limit: RECENTES });
  const notificacoes = useDeduplicated(lista.data);
  const marcarLida = useMarkNotificationRead();

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-medium">Notificações</p>
        {lista.data?.unread ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {`${lista.data.unread} não lida(s)`}
          </span>
        ) : null}
      </div>

      {/* Alto o bastante para as cinco: uma linha cortada pela metade parece
          defeito de renderização, não convite a rolar. */}
      <div className="max-h-[26rem] overflow-y-auto">
        {lista.isPending ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando…
          </div>
        ) : lista.error ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Não foi possível carregar. A central mostra o motivo.
          </p>
        ) : notificacoes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nada por aqui. Você está em dia.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notificacoes.map((notificacao) => (
              <Linha
                key={notificacao.id}
                notificacao={notificacao}
                onLer={() => marcarLida.mutate(notificacao.id)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Button asChild variant="ghost" size="sm" className="w-full">
          <Link href={ROUTES.notifications} onClick={onNavigate}>
            Ver todas
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Linha({
  notificacao,
  onLer,
  onNavigate,
}: {
  notificacao: OrbitNotification;
  onLer: () => void;
  onNavigate: () => void;
}) {
  const naoLida = !notificacao.readAt;

  return (
    <li className={cn(naoLida && "bg-primary/5")}>
      <Link
        href={ROUTES.notifications}
        onClick={() => {
          /**
           * Clicar lê **e** navega.
           *
           * A marcação é otimista do ponto de vista da navegação: não esperamos
           * a resposta para sair da tela, porque o destino não depende dela. Se
           * o servidor recusar, a central mostra a notificação ainda não lida —
           * que é a verdade.
           */
          if (naoLida) onLer();
          onNavigate();
        }}
        className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
      >
        <NotificationCategoryIcon
          type={notificacao.type}
          className="mt-0.5 size-4 shrink-0"
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span
              className={cn(
                "line-clamp-1 text-sm",
                naoLida ? "font-semibold" : "font-medium",
              )}
            >
              {notificacao.title}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {relativeTime(notificacao.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {notificacao.body}
          </span>
        </span>

        {naoLida ? (
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
            aria-label="Não lida"
          />
        ) : (
          <Check
            className="mt-1 size-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
      </Link>
    </li>
  );
}
