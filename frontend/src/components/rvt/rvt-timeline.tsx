"use client";

import { useState } from "react";
import { CheckCircle2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useRvtTimeline } from "@/hooks/rvt/use-rvt";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { RvtTimelineItem } from "@/types/rvt";
import { ListState } from "@/workspace";
import { RvtExecutionWorkspace } from "./rvt-execution";

export function RvtTimelinePanel({
  configurationId,
}: {
  configurationId: string;
}) {
  const { formatDateTime } = useDateFormatters();
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<RvtTimelineItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const page = useRvtTimeline(configurationId, { cursor, limit: 20 });
  const visible = [
    ...new Map(
      [...previous, ...(page.data?.data ?? [])].map((item) => [item.id, item]),
    ).values(),
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Visitas concluídas para este cliente nesta unidade. Selecione uma visita
        para consultar os detalhes.
      </p>
      <ListState
        isPending={page.isPending}
        error={page.error}
        onRetry={() => void page.refetch()}
        items={visible}
        empty={{
          icon: <History className="size-5" />,
          title: "Nenhuma visita concluída",
          description: "Os atendimentos aparecerão aqui após a conclusão.",
        }}
      >
        {(rows) => (
          <ol className="ml-3 border-l border-border pl-6">
            {rows.map((item) => (
              <li key={item.id} className="relative pb-5">
                <CheckCircle2 className="absolute -left-[33px] top-4 size-4 bg-background text-emerald-500" />
                <button
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className="w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="text-sm font-medium">{item.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(item.occurredAt)}
                    {item.actor ? ` · ${item.actor.name}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ol>
        )}
      </ListState>
      {page.data?.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={page.isFetching}
          onClick={() => {
            setPrevious(visible);
            setCursor(page.data?.nextCursor ?? undefined);
          }}
        >
          {page.isFetching ? "Carregando…" : "Carregar mais"}
        </Button>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Detalhes da visita concluída</DialogTitle>
            <DialogDescription>
              Equipe, equipamentos, registros e relatório deste atendimento.
            </DialogDescription>
          </DialogHeader>
          {selected && <RvtExecutionWorkspace executionId={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
