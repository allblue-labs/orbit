"use client";

/**
 * Central de notificações.
 *
 * ## Navegação contextual
 *
 * Ao selecionar uma notificação, na ordem:
 *
 * 1. marca como lida (`PATCH /:id/read`), quando ainda não está;
 * 2. lê a **Resource Reference** do `payload`;
 * 3. resolve o destino pelo **Entity Registry**;
 * 4. navega — ou permanece na central, se a entidade não tem rota.
 *
 * A notificação **não conhece rota**. Não há URL vinda do backend sendo usada
 * como destino: uma rota renomeada quebraria notificações antigas, e cada
 * cliente precisa de caminhos diferentes para o mesmo registro.
 *
 * ## O que não existe no contrato, e por isso não está aqui
 *
 * Busca textual (`NotificationQueryDto` não a tem), arquivamento, fixação e
 * prioridade (não existem no modelo `Notification`). Marcar em lote **existe**
 * (`PATCH /read-all`) e está implementado.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, Filter, RefreshCw } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  readResourceReference,
  resourceHref,
  resourceLabel,
} from "@/entities/resource-reference";
import {
  NOTIFICATIONS_POLL_MS,
  useDeduplicated,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/notifications/use-notifications";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { NotificationStatus } from "@/types/contracts";
import type {
  NotificationQuery,
  OrbitNotification,
} from "@/types/notifications";
import {
  FilterSelect,
  ListState,
  Pagination,
  useListController,
} from "@/workspace";
import {
  groupByDay,
  NotificationCategoryIcon,
  notificationCategory,
  notificationStatusLabel,
} from "./notification-presentation";

const STATUS_OPTIONS = Object.values(NotificationStatus).map((status) => ({
  value: status,
  label: notificationStatusLabel(status),
}));

export function NotificationCenter() {
  const router = useRouter();
  const list = useListController<NotificationQuery>({ limit: 20 });

  const query = useNotifications(list.query);
  const notifications = useDeduplicated(query.data);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const meta = query.data?.meta;
  const unread = query.data?.unread ?? 0;

  /**
   * Categorias oferecidas no filtro.
   *
   * Saem dos tipos que apareceram na página — o backend não publica catálogo
   * de tipos, e inventar uma lista fixa criaria taxonomia paralela.
   */
  const typeOptions = useMemo(() => {
    const seen = new Set(notifications.map((item) => item.type));
    return [...seen]
      .sort()
      .map((type) => ({ value: type, label: notificationCategory(type).label }));
  }, [notifications]);

  const groups = useMemo(() => groupByDay(notifications), [notifications]);
  const byId = useMemo(
    () => new Map(notifications.map((item) => [item.id, item])),
    [notifications],
  );

  const open = (notification: OrbitNotification) => {
    if (!notification.readAt) markRead.mutate(notification.id);

    const reference = readResourceReference(notification.payload);
    const href = reference ? resourceHref(reference) : null;
    if (href) router.push(href);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect
            id="notifications-type"
            label="Categoria"
            value={list.query.type}
            onChange={(value) => list.setFilter("type", value)}
            options={typeOptions}
            anyLabel="Todas"
            className="w-56"
          />

          <FilterSelect
            id="notifications-status"
            label="Status"
            value={list.query.status}
            onChange={(value) =>
              list.setFilter("status", value as NotificationQuery["status"])
            }
            options={STATUS_OPTIONS}
            className="w-48"
          />

          <Button
            variant={list.query.unreadOnly ? "default" : "outline"}
            onClick={() =>
              list.setFilter("unreadOnly", list.query.unreadOnly ? undefined : true)
            }
          >
            <Filter className="size-4" />
            Somente não lidas
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-4" />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck className="size-4" />
            {markAllRead.isPending
              ? "Marcando…"
              : `Marcar todas como lidas${unread > 0 ? ` (${unread})` : ""}`}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {meta
            ? meta.total === 0
              ? "Nenhuma notificação"
              : `${meta.total} notificação(ões) · ${unread} não lida(s)`
            : "Carregando…"}
        </p>
        <p className="text-xs text-muted-foreground">
          Atualiza a cada {Math.round(NOTIFICATIONS_POLL_MS / 1000)}s — a atualização em tempo real ainda não está disponível nesta tela
        </p>
      </div>

      <MutationError error={markRead.error ?? markAllRead.error} />

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={notifications}
        empty={{
          icon: <BellOff className="size-5" />,
          title: "Nenhuma notificação",
          description: list.query.unreadOnly
            ? "Nada pendente de leitura no momento."
            : "Você verá aqui os avisos de operações, agenda, artefatos e sistema.",
        }}
      >
        {() => (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {group.label}
                </h2>
                <ul className="space-y-2">
                  {group.ids.map((id) => {
                    const notification = byId.get(id);
                    if (!notification) return null;
                    return (
                      <NotificationRow
                        key={id}
                        notification={notification}
                        pending={markRead.isPending && markRead.variables === id}
                        onOpen={() => open(notification)}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ListState>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={query.isFetching}
      />
    </div>
  );
}

function NotificationRow({
  notification,
  pending,
  onOpen,
}: {
  notification: OrbitNotification;
  pending: boolean;
  onOpen: () => void;
}) {
  const reference = readResourceReference(notification.payload);
  const href = reference ? resourceHref(reference) : null;
  const unread = notification.readAt === null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full flex-wrap items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
          unread
            ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
            : "border-border hover:bg-surface-strong",
        )}
      >
        <NotificationCategoryIcon type={notification.type} className="mt-0.5" />

        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-sm",
                unread ? "font-semibold" : "font-medium",
              )}
            >
              {notification.title}
            </span>
            {unread ? (
              <span
                className="size-1.5 rounded-full bg-primary"
                aria-label="não lida"
              />
            ) : null}
            <Badge variant="secondary" className="text-[10px]">
              {notificationCategory(notification.type).label}
            </Badge>
          </p>

          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {notification.body}
          </p>

          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {formatDateTime(notification.createdAt)}
            {reference ? (
              <span>
                ·{" "}
                {href
                  ? `abre ${resourceLabel(reference).toLowerCase()}`
                  : `${resourceLabel(reference)} sem tela registrada`}
              </span>
            ) : null}
            {pending ? <span>· marcando como lida…</span> : null}
          </p>
        </div>
      </button>
    </li>
  );
}
