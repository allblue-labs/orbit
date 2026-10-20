"use client";

/**
 * A linha do tempo do plano.
 *
 * O endpoint público (`/timeline`) devolve **fatos de negócio** já redigidos —
 * criação, ativação, execução, evidência, documento —, não o log de auditoria.
 * A tela mostra a frase que o servidor escreveu; montar texto a partir de
 * `data` cru aqui produziria uma segunda narrativa do mesmo evento.
 */
import { useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePmocTimeline } from "@/hooks/pmoc/use-pmoc";
import { formatDateTime } from "@/lib/formatters";
import type { PmocTimelineItem } from "@/types/pmoc";
import { ListState } from "@/workspace";

export function PmocTimelinePanel({ planId }: { planId: string }) {
  /** Cursor acumulado: a linha do tempo cresce, não troca de página. */
  const [cursor, setCursor] = useState<string | undefined>();
  const [items, setItems] = useState<PmocTimelineItem[]>([]);
  const page = usePmocTimeline(planId, { cursor, limit: 20 });

  const visible = cursor ? items : (page.data?.data ?? []);

  return (
    <div className="space-y-4">
      <ListState
        isPending={page.isPending}
        error={page.error}
        onRetry={() => void page.refetch()}
        items={visible}
        empty={{
          icon: <History className="size-5" />,
          title: "Nenhum registro na linha do tempo",
          description:
            "Criação, ativação, execuções e documentos aparecem aqui conforme acontecem.",
        }}
      >
        {(rows) => (
          <ol className="space-y-3">
            {rows.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-border px-4 py-3"
              >
                <p className="text-sm">{item.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(item.occurredAt)}
                  {item.actor ? ` · ${item.actor.displayName}` : ""}
                  {item.equipment ? ` · ${item.equipment.name}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </ListState>

      {page.data?.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={page.isFetching}
            onClick={() => {
              setItems([...visible, ...(page.data?.data ?? [])]);
              setCursor(page.data?.nextCursor ?? undefined);
            }}
          >
            {page.isFetching ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
