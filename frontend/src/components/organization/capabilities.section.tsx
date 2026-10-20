"use client";

/**
 * Recursos do plano: o que está incluído, o que não, e onde se consegue.
 *
 * ## O que havia aqui
 *
 * Sessenta linhas de `artifact_manifests.read` em `<code>`, com a lista de
 * planos ao lado. Correto e ilegível: é o vocabulário dos decorators
 * `@Capabilities(...)` do backend, não o de quem está decidindo se precisa
 * mudar de plano.
 *
 * A tradução está em `plan-features.model.ts`, testável sem DOM; aqui só sobra
 * o desenho. O porquê de cada escolha está lá.
 *
 * ## Esta tela não decide nada
 *
 * É consulta. Quem autoriza é o `ActivePlanGuard` no servidor, que recusa com
 * 403 independentemente do que apareça aqui.
 */
import { useMemo } from "react";
import { Check, Sparkles } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import {
  useOrganizationEntitlements,
  usePlanCatalog,
} from "@/hooks/organization/use-organization";
import { cn } from "@/lib/utils";

import { buildPlanFeatures, type PlanFeature } from "./plan-features.model";

export function CapabilitiesSection() {
  const entitlements = useOrganizationEntitlements();
  const catalog = usePlanCatalog();

  const features = useMemo(
    () =>
      buildPlanFeatures(
        catalog.data ?? [],
        entitlements.data?.capabilities ?? [],
      ),
    [catalog.data, entitlements.data],
  );

  const incluidos = features.filter((feature) => feature.included.length > 0);

  return (
    <PanelFrame
      /* O id sobreviveu à renomeação: é a chave do layout salvo de quem já usa
         a tela, não um texto exibido. */
      panelId="organization-capabilities"
      title="Recursos do plano"
      description="O que a sua assinatura inclui, e o que existe em outros planos"
      actions={
        entitlements.data ? (
          <Badge variant="secondary">
            {incluidos.length} de {features.length}
          </Badge>
        ) : null
      }
    >
      <PanelState
        query={toPanelQuery(catalog)}
        loadingRows={5}
        isEmpty={() => features.length === 0}
        emptyMessage="Nenhum plano publicado."
      >
        {() => (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {features.map((feature) => (
                <Row key={feature.id} feature={feature} />
              ))}
            </ul>

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Os recursos que existem no produto são os publicados pelos planos
              disponíveis. Quando algo não está incluído, os planos que o
              habilitam aparecem ao lado.
            </p>
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function Row({ feature }: { feature: PlanFeature }) {
  const incluido = feature.included.length > 0;

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2",
        incluido ? "border-border" : "border-dashed border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {incluido ? (
          <Check
            className="size-3.5 shrink-0 translate-y-0.5 text-emerald-500"
            aria-label="incluído"
          />
        ) : (
          <Sparkles
            className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground"
            aria-label="não incluído"
          />
        )}
        <span className="text-sm font-medium">{feature.name}</span>
        <span className="min-w-0 text-xs text-muted-foreground">
          {incluido ? feature.included.join(", ") : "não incluído"}
        </span>
      </div>

      {feature.missing.length > 0 ? (
        <p className="mt-1 pl-[1.375rem] text-xs text-muted-foreground">
          {incluido ? "Falta " : ""}
          {feature.missing.join(", ")}
          {feature.availableIn.length > 0
            ? ` — ${feature.availableIn.length === 1 ? "no plano" : "nos planos"} ${feature.availableIn.join(", ")}`
            : ""}
          .
        </p>
      ) : null}
    </li>
  );
}
