"use client";

/**
 * Scheduling Intelligence.
 *
 * ## O contrato se declara fixture, e a tela repete isso
 *
 * `SchedulingIntelligenceReadModel` carrega `source: 'MOCK'`, e o próprio
 * controller anuncia: *"Return mocked Scheduling Intelligence contracts"*.
 * Olhando o serviço, blocos diferentes têm procedências diferentes:
 *
 * | Bloco | Procedência |
 * | --- | --- |
 * | `conflicts` | **observado** — mesmo cálculo de `/scheduling/conflicts` |
 * | `reschedulingRecommendations` | conflito real, horário sugerido fixo (`fim + 30 min`, confiança 0,78) |
 * | `routeOptimizations` | números fixos no código (14%, 38 min) |
 * | `delayPredictions` | probabilidades fixas (`0,42 + 0,13·i`) |
 * | `weatherImpact` | derivado do nome do segmento; **não há dado meteorológico** |
 *
 * A regra do produto, firmada na PR-03, é que valor marcado como `MOCK` não
 * pode ser apresentado como observação real. Então: os conflitos aparecem no
 * painel próprio, com os dados reais; aqui cada bloco não observado vem com
 * marca explícita e um aviso no topo. Esconder seria pior — a tela existe para
 * mostrar o contrato que os clientes vão consumir quando houver motor de
 * verdade —, mas apresentar como previsão seria falso.
 *
 * **Nada é gerado localmente.**
 */
import {
  CloudSun,
  FlaskConical,
  Route,
  TimerReset,
  TrendingDown,
} from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { formatZonedDateTime } from "@/lib/scheduling";
import type { useSchedulingIntelligence } from "@/hooks/scheduling/use-scheduling";

export function IntelligencePanel({
  query,
  timeZone,
}: {
  query: ReturnType<typeof useSchedulingIntelligence>;
  timeZone: string;
}) {
  return (
    <PanelFrame
      panelId="scheduling-intelligence"
      title="Scheduling Intelligence"
      description="Análise do período"
      actions={<NotObservedBadge />}
    >
      <PanelState query={toPanelQuery(query)} loadingRows={4}>
        {(intelligence) => (
          <div className="space-y-5">
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              A análise indica <code>source: {intelligence.source}</code> nesta
              resposta. Os blocos abaixo existem para o contrato — os números
              não são observações da sua operação. Os conflitos reais estão no
              painel de conflitos.
            </p>

            <Block
              icon={TimerReset}
              title="Sugestões de reagendamento"
              count={intelligence.reschedulingRecommendations.length}
            >
              {intelligence.reschedulingRecommendations.map(
                (recommendation, index) => (
                  <li
                    key={`${recommendation.eventId}-${index}`}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <p>{recommendation.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatZonedDateTime(
                        recommendation.currentStartsAt,
                        timeZone,
                      )}{" "}
                      →{" "}
                      {formatZonedDateTime(
                        recommendation.suggestedStartsAt,
                        timeZone,
                      )}
                    </p>
                  </li>
                ),
              )}
            </Block>

            <Block
              icon={TrendingDown}
              title="Risco de atraso"
              count={intelligence.delayPredictions.length}
            >
              {intelligence.delayPredictions.map((prediction) => (
                <li
                  key={prediction.eventId}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p>
                    Atraso estimado de {prediction.estimatedDelayMinutes} min
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Fatores: {prediction.factors.join(", ")}
                  </p>
                </li>
              ))}
            </Block>

            <Block
              icon={Route}
              title="Otimização de rota"
              count={intelligence.routeOptimizations.length}
            >
              {intelligence.routeOptimizations.map((optimization) => (
                <li
                  key={optimization.id}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p>{optimization.recommendation}</p>
                  <p className="text-xs text-muted-foreground">
                    {optimization.estimatedDistanceReductionPercent}% de
                    distância · {optimization.estimatedTimeSavedMinutes} min ·{" "}
                    {optimization.affectedEventIds.length} evento(s)
                  </p>
                </li>
              ))}
            </Block>

            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
                <CloudSun className="size-3.5" aria-hidden />
                Impacto climático
              </h3>
              {intelligence.weatherImpact.applicable ? (
                <div className="space-y-1 rounded-lg border border-border px-3 py-2 text-sm">
                  <p className="flex items-center gap-2">
                    Risco {intelligence.weatherImpact.risk}
                    <Badge variant="outline" className="text-[10px]">
                      {intelligence.weatherImpact.segment}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {intelligence.weatherImpact.summary}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Derivado do segmento da organização. Não há integração com dados de clima.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {intelligence.weatherImpact.summary}
                </p>
              )}
            </section>
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function NotObservedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
      <FlaskConical className="size-3" aria-hidden />
      Não observado
    </span>
  );
}

function Block({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Route;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
        <span className="tabular-nums">({count})</span>
      </h3>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">Nada para o período.</p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </section>
  );
}
