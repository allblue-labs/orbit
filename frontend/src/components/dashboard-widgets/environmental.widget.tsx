"use client";

/**
 * Clima e impacto ambiental — `GET /analytics/environmental-impact`.
 *
 * **Procedência**: o contrato declara `source: 'MOCK_DERIVED'` no impacto e
 * `source: 'MOCK'` no clima que o alimenta — o backend ainda não integra um
 * provedor meteorológico real. O widget carrega essa marca de forma visível,
 * porque apresentar previsão simulada como observação induziria decisão
 * operacional errada.
 */
import { CloudSun, Droplets, Thermometer, Wind } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KpiCard } from "@/components/ui/stat-card";
import type { EnvironmentalImpactReadModel } from "@/types/dashboard";
import { presentValue, SimulatedSourceNotice } from "@/metrics";
import type { WidgetProps } from "./widget-registry";
import { PanelFrame, PanelState } from "@/components/panels";

/** Chaves do contrato → ids registrados no Metric Registry. */
type EnvironmentalIndicator = keyof EnvironmentalImpactReadModel["indicators"];

const METRIC_ID: Readonly<Record<EnvironmentalIndicator, string>> = {
  coolingLoadIndex: "environment.coolingLoadIndex",
  fieldWorkRiskIndex: "environment.fieldWorkRiskIndex",
  delayRiskPercent: "environment.delayRiskPercent",
  equipmentStressIndex: "environment.equipmentStressIndex",
};

export function EnvironmentalWidget({ widget, analytics }: WidgetProps) {
  const source = analytics.environmentalImpact.data?.source;

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
      actions={source ? <SimulatedSourceNotice source={source} /> : null}
    >
      <PanelState query={analytics.environmentalImpact} loadingRows={4}>
        {(data) => (
          <div className="space-y-5">
            <Alert>
              <CloudSun className="size-4" />
              <AlertTitle>Fonte meteorológica simulada</AlertTitle>
              <AlertDescription>
                Os dados de clima ainda não estão integrados ao Orbit. Estes números
                não descrevem as condições reais da sua operação e não devem
                embasar decisão de campo.
              </AlertDescription>
            </Alert>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(data.indicators) as EnvironmentalIndicator[]).map(
                (key) => {
                  /** Procedência do bloco: o contrato declara `MOCK_DERIVED`. */
                  const metric = presentValue(
                    METRIC_ID[key],
                    data.indicators[key],
                    { quality: "MOCK" },
                  );
                  return (
                    <KpiCard
                      key={key}
                      label={metric.label}
                      value={metric.value}
                      progress={Math.min(
                        100,
                        Math.max(0, data.indicators[key]),
                      )}
                    />
                  );
                },
              )}
            </div>

            <CurrentConditions environment={data.environment} />

            {data.impacts.length > 0 || data.recommendations.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <TextList title="Impactos previstos" items={data.impacts} />
                <TextList title="Recomendações" items={data.recommendations} />
              </div>
            ) : null}
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function CurrentConditions({
  environment,
}: {
  environment: EnvironmentalImpactReadModel["environment"];
}) {
  const { current, location } = environment;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {location.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {current.condition}
          </span>
        </p>
        <SimulatedSourceNotice source={environment.source} />
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Thermometer className="size-3.5" aria-hidden />
          {current.temperatureCelsius} °C
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Droplets className="size-3.5" aria-hidden />
          {current.humidityPercent}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wind className="size-3.5" aria-hidden />
          {current.windKilometersPerHour} km/h
        </span>
      </div>
    </div>
  );
}

function TextList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-sm text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
