"use client";

/**
 * Atividades recentes — `GET /dashboard/activity`.
 *
 * Estava marcado como "sem fonte": não havia leitura consolidada. Agora há —
 * atendimentos abertos, iniciados e concluídos, chamados de clientes,
 * orçamentos decididos e manutenções de PMOC e RVT concluídas nos últimos 30
 * dias, cada fonte visível só para quem lê aquele módulo.
 */
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { useDashboardActivity } from "@/hooks/dashboard/use-dashboard";
import { useTimeZone } from "@/hooks/use-timezone";
import { sinceLabel } from "./dashboard-feed.model";
import { FeedList } from "./dashboard-feed";
import type { WidgetProps } from "./widget-registry";

export function RecentActivityWidget({ widget }: WidgetProps) {
  const activity = useDashboardActivity();
  const { timeZone } = useTimeZone();
  const now = new Date();
  return (
    <PanelFrame panelId={widget.id} title={widget.title} description={widget.description}>
      <PanelState
        query={toPanelQuery(activity)}
        loadingRows={5}
        isEmpty={(data) => data.items.length === 0}
        emptyMessage="Nada nos últimos 30 dias. Atendimentos, chamados, orçamentos e manutenções aparecem aqui assim que acontecem."
      >
        {(data) => (
          <FeedList
            items={data.items}
            personPrefix="por"
            when={(item) => sinceLabel(item.at, now, timeZone)}
          />
        )}
      </PanelState>
    </PanelFrame>
  );
}
