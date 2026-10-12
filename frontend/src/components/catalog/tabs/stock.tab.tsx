"use client";

/**
 * Estoque — implementado.
 *
 * Esta aba declarava a ausência do domínio até a Backend PR-23. A declaração
 * estava certa enquanto durou: não havia modelo, coluna nem endpoint, e
 * estimar teria sido pior que dizer que não existia. Agora existe.
 *
 * ## O Catálogo continua sendo a porta
 *
 * Estoque não virou domínio de menu. O caminho é
 * **Catálogo → Estoque → Item → Histórico**: quem procura uma peça procura no
 * catálogo, e o saldo é um atributo dela naquela unidade — não um cadastro
 * paralelo.
 *
 * ## Três recortes, um contrato
 *
 * Saldos, movimentações e o panorama saem de `/inventory/**`. Nada é somado no
 * navegador: `trackedItems`, `lowStockItems` e `outOfStockItems` são contagens
 * do banco, e `meta.total` é do servidor.
 */
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelFrame } from "@/components/panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryBalancesPanel } from "@/components/inventory/inventory-balances.panel";
import { InventoryConsumptionPanel } from "@/components/inventory/inventory-consumption.panel";
import { InventoryHistoryPanel } from "@/components/inventory/inventory-history.panel";
import { InventoryKpis } from "@/components/inventory/inventory-kpis";
import { useActiveScope } from "@/providers/use-active-scope";
import { useSession } from "@/providers/session-provider";
import { TabBoundary } from "@/workspace";
import type { InventoryAnalyticsQuery } from "@/types/inventory";

/** Últimos 30 dias — o mesmo padrão que o backend usa sem período. */
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { from: day(from), to: day(to) };
}

/**
 * Sem `inventory.read`, nada de estoque chega.
 *
 * A capability é independente de `catalog.read`: quem consulta a tabela de
 * preços não vê necessariamente o que há na prateleira. A verificação fica
 * **fora** do componente que consulta — um `return` antecipado antes dos hooks
 * quebraria a ordem deles na primeira vez que a capability mudasse.
 */
export function CatalogStockTab() {
  const session = useSession();

  if (!session.hasCapability("inventory.read")) {
    return (
      <PanelFrame
        panelId="catalog-stock-denied"
        title="Estoque"
        description="Saldos e movimentações"
      >
        <p className="text-sm text-muted-foreground">
          Seu acesso inclui o catálogo, mas não o estoque. As duas permissões
          são concedidas separadamente: consultar preço e descrição não é o
          mesmo que ver — ou mexer — no que há fisicamente em cada unidade.
        </p>
      </PanelFrame>
    );
  }

  return <StockContent />;
}

function StockContent() {
  const { businessUnitId, businessUnits } = useActiveScope();
  const [period, setPeriod] = useState(defaultPeriod);

  const analytics = useMemo<InventoryAnalyticsQuery>(
    () => ({
      from: period.from,
      to: period.to,
      businessUnitId: businessUnitId ?? undefined,
    }),
    [period.from, period.to, businessUnitId],
  );

  const unit = businessUnits.find((option) => option.id === businessUnitId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {unit
              ? `${unit.tradeName ?? unit.legalName}`
              : "Todas as organizações acessíveis"}{" "}
            · movimentos de {period.from} a {period.to}
          </p>
          <p className="text-xs text-muted-foreground">
            Saldo é consequência de movimentações. Não existe campo de
            quantidade editável — nem aqui, nem na API.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="inventory-period-from">De</Label>
            <Input
              id="inventory-period-from"
              type="date"
              value={period.from}
              onChange={(event) =>
                setPeriod((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inventory-period-to">Até</Label>
            <Input
              id="inventory-period-to"
              type="date"
              value={period.to}
              onChange={(event) =>
                setPeriod((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
        </div>
      </div>

      <TabBoundary id="inventory-kpis" label="os indicadores">
        <InventoryKpis query={analytics} />
      </TabBoundary>

      <Tabs defaultValue="saldos">
        <TabsList>
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>
          <TabsTrigger value="consumo">Mais consumidos</TabsTrigger>
        </TabsList>

        <TabsContent value="saldos">
          <TabBoundary id="inventory-balances" label="os saldos">
            <InventoryBalancesPanel />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="movimentacoes">
          <TabBoundary id="inventory-history" label="as movimentações">
            <InventoryHistoryPanel />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="consumo">
          <TabBoundary id="inventory-consumption" label="o consumo">
            <InventoryConsumptionPanel query={analytics} />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
