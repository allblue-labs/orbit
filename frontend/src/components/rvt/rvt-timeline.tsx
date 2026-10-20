"use client";

/**
 * A linha do tempo da visita técnica.
 *
 * `/configurations/:id/timeline` devolve **fatos de negócio já redigidos** —
 * configuração criada, agenda reconciliada, visita iniciada, equipamento
 * adicionado, cliente deu ciência, documento gerado. A frase vem pronta do
 * servidor; remontá-la a partir de `data` cru produziria uma segunda narrativa
 * do mesmo evento, e as duas divergiriam na primeira mudança de domínio.
 *
 * A paginação é por cursor real, e a linha do tempo **cresce**: quem está
 * lendo um histórico não quer trocar de página, quer continuar descendo.
 */
import { useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRvtTimeline } from "@/hooks/rvt/use-rvt";
import { formatDateTime } from "@/lib/formatters";
import type { RvtTimelineItem } from "@/types/rvt";
import { ListState } from "@/workspace";

export function RvtTimelinePanel({
  configurationId,
}: {
  configurationId: string;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [items, setItems] = useState<RvtTimelineItem[]>([]);
  const page = useRvtTimeline(configurationId, { cursor, limit: 20 });

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
            "Criação, ajustes na agenda, visitas e documentos aparecem aqui conforme acontecem.",
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
                  {item.actor ? ` · ${item.actor.name}` : ""}
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
