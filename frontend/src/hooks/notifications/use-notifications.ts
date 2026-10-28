"use client";

/**
 * Query Layer do Notification Center.
 *
 * ## Realtime: existe no backend, não alcança este cliente
 *
 * Há um `NotificationGateway` (Socket.IO, namespace `/notifications`) que
 * autentica pelo **access token no handshake** e emite para
 * `user:{id}`/`organization:{id}`.
 *
 * O frontend web não pode usá-lo. Desde a PR-02 os tokens vivem **apenas em
 * cookies `HttpOnly`**: o JavaScript da página não os acessa, por decisão de
 * segurança, e é o BFF que injeta o `Authorization` a cada requisição. Um
 * Socket.IO no browser precisaria do token no handshake — ou seja, exigiria
 * expor o token à página e desfazer justamente a propriedade que o BFF existe
 * para garantir.
 *
 * Alternativas avaliadas e por que não:
 *
 * - **proxy WebSocket pelo BFF** — Route Handlers do App Router não fazem
 *   upgrade de conexão;
 * - **endpoint que devolva um token efêmero para o socket** — não existe, e
 *   criá-lo reintroduziria o token no browser.
 *
 * Então: **polling**, com intervalo configurável, e a lacuna documentada. Não
 * há simulação de realtime. O aplicativo móvel, que guarda o token em
 * armazenamento seguro, **pode** usar o gateway — a lacuna é do web.
 *
 * ## Concorrência entre polling e mutações
 *
 * O polling e o "marcar como lida" disputam a mesma lista. Três medidas:
 *
 * 1. **`cancelQueries` antes de escrever** — evita que uma leitura em voo
 *    aterrisse depois da mutação e reponha o estado anterior;
 * 2. **a resposta confirmada prevalece** — a mutação devolve a notificação
 *    atualizada, e é ela que entra no cache, não um palpite;
 * 3. **`scope` por notificação** — cliques repetidos na mesma notificação são
 *    serializados.
 *
 * Não há atualização otimista: marcar como lida pode ser recusado (403 por
 * capability, 404 se a notificação não é do usuário), e antecipar mostraria um
 * estado que o servidor talvez rejeite.
 */
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { notificationsService } from "@/services/notifications.service";
import type {
  NotificationListResult,
  NotificationQuery,
  OrbitNotification,
} from "@/types/notifications";

/**
 * Intervalo do polling.
 *
 * Configurável por `NEXT_PUBLIC_NOTIFICATIONS_POLL_MS` para que ambientes com
 * volume diferente possam ajustar sem alterar código. O padrão de 60 s é o
 * meio-termo entre "chegou agora" e não bater no servidor a cada respiração.
 */
const DEFAULT_POLL_MS = 60_000;

export const NOTIFICATIONS_POLL_MS = readPollInterval();

function readPollInterval(): number {
  const raw = process.env.NEXT_PUBLIC_NOTIFICATIONS_POLL_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  /** Piso de 10 s: intervalo menor é engano de configuração, não intenção. */
  return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : DEFAULT_POLL_MS;
}

export const NOTIFICATIONS_REFRESH = {
  list: {
    staleTime: CACHE.live.staleTime,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchOnWindowFocus: true,
    /** O contador precisa continuar andando com a aba em segundo plano. */
    refetchIntervalInBackground: false,
  },
} as const;

/** Listagem paginada. `unread` vem junto e não depende do filtro. */
export function useNotifications(query: NotificationQuery) {
  return useApiQuery(
    notificationsService.keys.list(query),
    ({ signal }) => notificationsService.list(query, { signal }),
    {
      ...NOTIFICATIONS_REFRESH.list,
      /** Mantém a lista visível durante a troca de página e o polling. */
      placeholderData: (previous) => previous,
    },
  );
}

/**
 * Contador de não lidas para o badge.
 *
 * Consulta com `limit: 1` porque só `unread` interessa — a contagem é do
 * banco, não da página. É uma consulta separada da central para que o badge
 * continue correto mesmo com a lista filtrada por tipo ou status.
 */
export function useUnreadCount() {
  const query = useApiQuery(
    notificationsService.keys.unread(),
    ({ signal }) =>
      notificationsService.list({ limit: 1, page: 1 }, { signal }),
    NOTIFICATIONS_REFRESH.list,
  );

  return {
    unread: query.data?.unread ?? 0,
    isPending: query.isPending,
    error: query.error,
  };
}

/**
 * Deduplicação por identificador.
 *
 * O polling pode trazer a mesma notificação em páginas diferentes se algo for
 * criado entre duas leituras — a ordenação é `createdAt desc`, então um
 * registro novo desloca os demais. Deduplicar por `id` evita a linha repetida
 * sem esconder nada: o que sai é a segunda cópia do mesmo registro.
 */
export function useDeduplicated(
  result: NotificationListResult | undefined,
): readonly OrbitNotification[] {
  return useMemo(() => {
    if (!result) return [];
    const seen = new Set<string>();
    return result.data.filter((notification) => {
      if (seen.has(notification.id)) return false;
      seen.add(notification.id);
      return true;
    });
  }, [result]);
}

/** Efeitos comuns às marcações: a resposta do servidor manda. */
function useNotificationInvalidation() {
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.cancelQueries({
      queryKey: notificationsService.keys.module(),
    });
    await queryClient.invalidateQueries({
      queryKey: notificationsService.keys.module(),
    });
  };
}

export function useMarkNotificationRead() {
  const invalidate = useNotificationInvalidation();

  return useApiMutation((id: string) => notificationsService.markRead(id), {
    /** Cliques repetidos na mesma notificação não disputam. */
    scope: { id: "notifications:mark-read" },
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useNotificationInvalidation();

  return useApiMutation(() => notificationsService.markAllRead(), {
    onSuccess: invalidate,
  });
}
