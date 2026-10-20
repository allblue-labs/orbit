"use client";

/**
 * O uso do plano.
 *
 * Dois números do servidor, lado a lado: quanto se tem e quanto o plano
 * permite. A barra é desenho — quem recusa a próxima criação é o backend, no
 * momento da escrita, e nenhuma decisão desta tela depende do percentual.
 *
 * Alocação conta estado ativo agora; uso conta eventos na janela mensal, e a
 * janela vem do servidor: nada aqui assume mês do calendário.
 */
import { Gauge } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  HIDDEN_ENTITLEMENT_RESOURCES,
  type OrganizationEntitlementsView,
  type ResourceEntitlement,
} from "@/types/billing";
import { PlanKpis } from "./plan-kpis";
import {
  diasAte,
  faixaDeUso,
  formatConsumo,
  percentualDeUso,
  rotuloDoRecurso,
} from "./billing-format";

const COR_DA_FAIXA: Readonly<Record<string, string>> = {
  normal: "",
  atencao: "[&>div]:bg-amber-500",
  alto: "[&>div]:bg-destructive",
};

function LinhaDeConsumo({ item }: { item: ResourceEntitlement }) {
  const percentual = percentualDeUso(item);
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{rotuloDoRecurso(item.resource)}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatConsumo(item)}
        </span>
      </div>
      {/*
        Ilimitado não recebe barra: uma proporção sobre um teto inexistente
        não significaria nada, e um traço cheio sugeriria o contrário.
      */}
      {percentual === null ? null : (
        <Progress
          value={percentual}
          className={cn("h-1.5", COR_DA_FAIXA[faixaDeUso(percentual)])}
          aria-label={`${rotuloDoRecurso(item.resource)}: ${formatConsumo(item)}`}
        />
      )}
    </li>
  );
}

function visiveis(
  itens: readonly ResourceEntitlement[],
): readonly ResourceEntitlement[] {
  return itens.filter(
    (item) => !HIDDEN_ENTITLEMENT_RESOURCES.has(item.resource),
  );
}

export function PlanUsageSection({
  entitlements,
}: {
  entitlements: OrganizationEntitlementsView;
}) {
  const alocacao = visiveis(entitlements.allocation);
  const uso = visiveis(entitlements.usage);
  const diasParaRenovar = diasAte(entitlements.window.end);

  return (
    <PanelFrame
      panelId="billing-usage"
      title="Uso do plano"
      description="O que está em uso agora e o que foi consumido no período"
    >
      {/*
        Os quatro tetos que travam a operação, com proporção.

        Abaixo continuam todos os recursos, em texto: a faixa é o resumo do que
        aperta, não um substituto da lista completa.
      */}
      <PlanKpis allocation={alocacao} usage={uso} />

      <div className="mt-6 grid gap-8 border-t border-border pt-6 lg:grid-cols-2">
        <section className="space-y-3" aria-labelledby="uso-alocacao">
          <h3
            id="uso-alocacao"
            className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"
          >
            <Gauge className="size-3.5" aria-hidden />
            Em uso agora
          </h3>
          <ul className="space-y-3">
            {alocacao.map((item) => (
              <LinhaDeConsumo key={item.resource} item={item} />
            ))}
          </ul>
        </section>

        <section className="space-y-3" aria-labelledby="uso-mensal">
          <h3
            id="uso-mensal"
            className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"
          >
            <Gauge className="size-3.5" aria-hidden />
            No período
          </h3>
          <ul className="space-y-3">
            {uso.map((item) => (
              <LinhaDeConsumo key={item.resource} item={item} />
            ))}
          </ul>
          {/* A data é do servidor; a contagem de dias é apresentação dela. */}
          <p className="pt-1 text-xs text-muted-foreground">
            O período recomeça em {formatDate(entitlements.window.end)}
            {diasParaRenovar > 0 ? ` · em ${diasParaRenovar} dias` : null}.
          </p>
        </section>
      </div>
    </PanelFrame>
  );
}
