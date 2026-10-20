"use client";

/**
 * Indicadores do Catálogo.
 *
 * ## Não vêm do Analytics — e isso é declarado
 *
 * `AnalyticsDomain` cobre operações, PMOC, equipamentos, técnicos, contratos e
 * ambiente. **Catálogo não está lá**, e `/analytics/kpis` nem aceita um
 * parâmetro `domain` (verificado: `400 property domain should not exist`).
 *
 * Cada número é o `meta.total` de uma consulta filtrada — contagem do banco,
 * feita pelo servidor. **Nada é somado aqui**, e nada é inventado: não há
 * "valor total do catálogo", porque somar preços de itens com unidades
 * diferentes não significa nada, nem "margem média", que dependeria de custo
 * em todos os itens.
 *
 * A apresentação (rótulo, ícone, cor, formato) vem do **Metric Registry**.
 */
import { PanelError } from "@/components/panels";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalogCount } from "@/hooks/catalog/use-catalog";
import { ProductKind, ProductStatus } from "@/types/contracts";
import { MetricCard } from "@/workspace";

/** Ids registrados no Metric Registry para os contadores do catálogo. */
export const CATALOG_METRIC_IDS = {
  products: "catalog.products.total",
  services: "catalog.services.total",
  parts: "catalog.parts.total",
  unavailable: "catalog.unavailable.total",
} as const;

export function CatalogKpis() {
  const products = useCatalogCount({ kind: ProductKind.PRODUCT });
  const services = useCatalogCount({ kind: ProductKind.SERVICE });
  const parts = useCatalogCount({ kind: ProductKind.PART });
  const unavailable = useCatalogCount({ status: ProductStatus.INACTIVE });

  const cards = [
    { metricId: CATALOG_METRIC_IDS.products, count: products },
    { metricId: CATALOG_METRIC_IDS.services, count: services },
    { metricId: CATALOG_METRIC_IDS.parts, count: parts },
    { metricId: CATALOG_METRIC_IDS.unavailable, count: unavailable },
  ];

  const failure = cards.find((card) => card.count.error)?.count;

  if (failure?.error) {
    return (
      <PanelError error={failure.error} onRetry={() => void failure.refetch()} />
    );
  }

  if (cards.every((card) => card.count.isPending)) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Skeleton key={card.metricId} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <MetricCard
            key={card.metricId}
            metricId={card.metricId}
            value={card.count.total}
            isPending={card.count.isPending}
            failed={Boolean(card.count.error)}
            showDescription
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Contagens por recorte. Indicadores de preço e margem consolidados ainda não estão disponíveis.
      </p>
    </div>
  );
}
