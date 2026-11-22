"use client";

/**
 * Próximos compromissos — `GET /dashboard/upcoming`.
 *
 * Antes lia só a agenda da semana corrente, e só o que estava no módulo de
 * agenda: as visitas de RVT e os vencimentos de PMOC — o grosso do que uma
 * empresa de climatização tem marcado — não apareciam, e no fim de semana a
 * lista já começava vazia. Agora são os próximos 14 dias de atendimentos
 * agendados, visitas de RVT e vencimentos de PMOC.
 */
import { CalendarClock } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { useDashboardUpcoming } from "@/hooks/dashboard/use-dashboard";
import { useTimeZone } from "@/hooks/use-timezone";
import { whenLabel } from "./dashboard-feed.model";
import { FeedList } from "./dashboard-feed";
import type { WidgetProps } from "./widget-registry";

export function UpcomingEventsWidget({ widget }: WidgetProps) {
  const upcoming = useDashboardUpcoming();
  const { timeZone } = useTimeZone();
  const now = new Date();
  const total = upcoming.data?.items.length;
  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
      actions={
        total ? (
          <Badge variant="secondary">
            <CalendarClock className="size-3" aria-hidden />
            {total}
          </Badge>
        ) : null
      }
    >
      <PanelState
        query={toPanelQuery(upcoming)}
        loadingRows={5}
        isEmpty={(data) => data.items.length === 0}
        emptyMessage="Nada marcado para os próximos 14 dias: nenhum atendimento agendado, visita de RVT ou vencimento de PMOC."
      >
        {(data) => (
          <FeedList
            items={data.items}
            personPrefix="com"
            when={(item) => whenLabel(item, now, timeZone)}
          />
        )}
      </PanelState>
    </PanelFrame>
  );
}
