"use client";

/**
 * Configurações da agenda.
 *
 * ## Calendários
 *
 * `GET/POST/PATCH/DELETE /scheduling/calendars` já existia. O `CalendarSetup`
 * (PR-12) é reusado para criar — é o mesmo formulário que a agenda usa quando
 * não há calendário nenhum, e reescrevê-lo aqui daria duas telas para o mesmo
 * contrato.
 *
 * ## O que já é configurável e vive noutro lugar
 *
 * **Escalas e disponibilidade** ficam na Equipe: são por pessoa, e é lá que se
 * escolhe a pessoa. **Lembretes** são eventos da própria agenda, criados no
 * Workspace de Agenda. Configuração vive junto do que ela configura.
 *
 * ## Recorrência não se configura
 *
 * As regras de recorrência são do **motor do backend**, que expande as
 * ocorrências e detecta conflito. Não há parâmetro global: cada evento declara
 * a sua regra no momento em que é criado.
 */
import Link from "next/link";
import { ArrowRight, CalendarClock, Plus } from "lucide-react";

import { CalendarSetup } from "@/components/scheduling/calendar-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelFrame } from "@/components/panels";
import { useAction } from "@/actions";
import { useSchedulingCalendars } from "@/hooks/scheduling/use-scheduling";
import { useSchedulingTimeZone } from "@/components/scheduling/use-scheduling-timezone";
import { ROUTES } from "@/lib/routes";
import { useActiveScope } from "@/providers/use-active-scope";
import { ListState } from "@/workspace";
import { useState } from "react";

export function SchedulingSettingsTab() {
  const { businessUnitId } = useActiveScope();
  const { timeZone } = useSchedulingTimeZone();
  const query = useSchedulingCalendars(businessUnitId ?? undefined);
  const manage = useAction("scheduling-event.create");

  const [creating, setCreating] = useState(false);
  const calendars = query.data ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              Calendários
            </h3>
            <p className="text-xs text-muted-foreground">
              Cada evento pertence a um calendário. O fuso é do calendário, não
              do navegador.
            </p>
          </div>
          {manage.allowed && !creating && calendars.length > 0 ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Novo calendário
            </Button>
          ) : null}
        </div>

        {creating ? (
          <CalendarSetup
            timeZone={timeZone}
            businessUnitId={businessUnitId ?? undefined}
            isFirst={calendars.length === 0}
            onCreated={() => setCreating(false)}
          />
        ) : null}

        <ListState
          isPending={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          items={calendars}
          rows={3}
          empty={{
            icon: <CalendarClock className="size-5" />,
            title: "Nenhum calendário",
            description:
              "Sem calendário, a agenda não tem onde guardar compromissos.",
            action: manage.allowed ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Novo calendário
              </Button>
            ) : undefined,
          }}
        >
          {(rows) => (
            <ul className="glass-panel divide-y divide-border rounded-xl">
              {rows.map((calendar) => (
                <li
                  key={calendar.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {calendar.name}
                      {calendar.isDefault ? (
                        <Badge variant="secondary">padrão</Badge>
                      ) : null}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {calendar.timezone}
                    </p>
                  </div>

                  <span className="text-xs text-muted-foreground">
                    {calendar.color ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ListState>

        {/*
          Editar e remover calendário existem no backend
          (`PATCH`/`DELETE /scheduling/calendars/:id`) e ainda não foram
          expostos no cliente: remover um calendário com eventos é decisão de
          governança que merece a mesma confirmação que as demais destrutivas,
          e não vale meia implementação.
        */}
        <p className="text-xs text-muted-foreground">
          Editar e remover calendário existem no contrato e ainda não foram
          expostos aqui — remover um calendário com compromissos é ação
          destrutiva e entra junto com a confirmação apropriada.
        </p>
      </section>

      <PanelFrame
        panelId="settings-scheduling-elsewhere"
        title="O que se administra em outro lugar"
        description="Configuração vive junto do que ela configura"
      >
        <ul className="space-y-2">
          <li>
            <Button
              variant="ghost"
              className="h-auto w-full justify-between px-3 py-2"
              asChild
            >
              <Link href={ROUTES.team}>
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium">
                    Escalas e disponibilidade
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Janelas por pessoa — na Equipe, onde se escolhe a pessoa
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0" />
              </Link>
            </Button>
          </li>
          <li>
            <Button
              variant="ghost"
              className="h-auto w-full justify-between px-3 py-2"
              asChild
            >
              <Link href={ROUTES.scheduling}>
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium">Lembretes</span>
                  <span className="block text-xs text-muted-foreground">
                    São eventos da agenda, criados no próprio Workspace
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0" />
              </Link>
            </Button>
          </li>
        </ul>

        <p className="mt-3 text-xs text-muted-foreground">
          As regras de recorrência são da plataforma, que gera as ocorrências e
          detecta conflito — cada evento declara a sua no momento em que é
          criado, e não há parâmetro global.
        </p>
      </PanelFrame>
    </div>
  );
}
