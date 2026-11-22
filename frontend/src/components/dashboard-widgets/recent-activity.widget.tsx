"use client";

/**
 * Atividades recentes — `GET /dashboard/activity`.
 *
 * Estava marcado como "sem fonte": não havia leitura consolidada. Agora há —
 * atendimentos abertos, iniciados e concluídos, chamados de clientes,
 * orçamentos decididos e manutenções de PMOC e RVT concluídas nos últimos 30
 * dias, cada fonte visível só para quem lê aquele módulo.
 *
 * Paginado de 10 em 10 (até 50 itens): o cartão não cresce além da altura
 * dos vizinhos no painel.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { useDashboardActivity } from "@/hooks/dashboard/use-dashboard";
import { useTimeZone } from "@/hooks/use-timezone";
import { sinceLabel } from "./dashboard-feed.model";
import { FeedList } from "./dashboard-feed";
import type { WidgetProps } from "./widget-registry";

export const ACTIVITY_PAGE_SIZE = 10;

export function RecentActivityWidget({ widget }: WidgetProps) {
  const activity = useDashboardActivity();
  const { timeZone } = useTimeZone();
  const now = new Date();
  const [pagina, setPagina] = useState(0);
  return (
    <PanelFrame panelId={widget.id} title={widget.title} description={widget.description}>
      <PanelState
        query={toPanelQuery(activity)}
        loadingRows={5}
        isEmpty={(data) => data.items.length === 0}
        emptyMessage="Nada nos últimos 30 dias. Atendimentos, chamados, orçamentos e manutenções aparecem aqui assim que acontecem."
      >
        {(data) => {
          const total = Math.max(Math.ceil(data.items.length / ACTIVITY_PAGE_SIZE), 1);
          const atual = Math.min(pagina, total - 1);
          const inicio = atual * ACTIVITY_PAGE_SIZE;
          const fim = Math.min(inicio + ACTIVITY_PAGE_SIZE, data.items.length);
          return (
            <div className="space-y-2">
              <FeedList
                items={data.items.slice(inicio, fim)}
                personPrefix="por"
                when={(item) => sinceLabel(item.at, now, timeZone)}
              />
              {total > 1 ? (
                <nav
                  aria-label="Páginas das atividades"
                  className="flex items-center justify-between gap-2 border-t border-border pt-2"
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {inicio + 1}–{fim} de {data.items.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Página anterior"
                      disabled={atual === 0}
                      onClick={() => setPagina(atual - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">
                      {atual + 1} / {total}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Próxima página"
                      disabled={atual >= total - 1}
                      onClick={() => setPagina(atual + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </span>
                </nav>
              ) : null}
            </div>
          );
        }}
      </PanelState>
    </PanelFrame>
  );
}
