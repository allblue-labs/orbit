"use client";

/**
 * Escolher um equipamento para a cobertura.
 *
 * ## O catálogo não vem inteiro
 *
 * `GET /assets` pagina e busca **no servidor**, e recebe o cliente e a unidade
 * do plano como filtro. Carregar tudo e filtrar aqui pareceria mais simples até
 * o primeiro cliente com trezentas máquinas — e ainda ofereceria equipamentos
 * de outra unidade, que o backend recusaria depois.
 *
 * ## Duplicidade
 *
 * Quem já está coberto não aparece: a lista de cobertura vem junto e some da
 * oferta. Isso é conveniência, não regra — o servidor recusa a repetição de
 * qualquer forma, com `CONFLICT`, e é a recusa dele que a tela mostra se algo
 * escapar (uma inclusão feita por outra pessoa entre a abertura do diálogo e a
 * escolha, por exemplo).
 */
import { useState } from "react";
import { Package } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAssetsList } from "@/hooks/assets/use-assets";
import { useAddPmocCoverage } from "@/hooks/pmoc/use-pmoc";
import { cn } from "@/lib/utils";
import type { Asset } from "@/types/assets";
import {
  ListState,
  Pagination,
  SearchField,
  useListController,
} from "@/workspace";
import type { AssetQuery } from "@/types/assets";

export function EquipmentSelectorDialog({
  open,
  onOpenChange,
  planId,
  customerId,
  businessUnitId,
  coveredAssetIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  customerId: string;
  businessUnitId: string;
  /** Já cobertos — some da oferta; o servidor mantém a regra. */
  coveredAssetIds: readonly string[];
}) {
  /**
   * O controlador já traz o debounce da busca e reinicia a página a cada
   * filtro — o mesmo de todas as listagens do produto.
   */
  const controller = useListController<AssetQuery>({
    limit: 10,
    initial: { customerId, businessUnitId },
  });
  const assets = useAssetsList(controller.query);
  const add = useAddPmocCoverage(planId);
  const [selected, setSelected] = useState<Asset | null>(null);

  const candidates = (assets.data?.data ?? []).filter(
    (asset) => !coveredAssetIds.includes(asset.id),
  );

  const close = () => {
    setSelected(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar equipamento à cobertura</DialogTitle>
          <DialogDescription>
            Equipamentos do cliente nesta unidade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SearchField
            id="pmoc-equipment-search"
            value={controller.searchTerm}
            onChange={controller.setSearchTerm}
            label="Buscar"
            placeholder="Nome, identificação, série ou fabricante"
          />

          <ListState
            isPending={assets.isPending}
            error={assets.error}
            onRetry={() => void assets.refetch()}
            items={candidates}
            rows={4}
            empty={{
              icon: <Package className="size-5" />,
              title: "Nenhum equipamento disponível para inclusão",
              description:
                "Todos os equipamentos deste cliente nesta unidade já estão cobertos, ou a busca não encontrou nenhum.",
            }}
          >
            {(rows) => (
              <ul
                className="max-h-72 space-y-1 overflow-y-auto"
                aria-label="Equipamentos disponíveis"
              >
                {rows.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(asset)}
                      aria-pressed={selected?.id === asset.id}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        selected?.id === asset.id
                          ? "border-primary/40 bg-primary/5"
                          : "border-border hover:bg-surface-strong",
                      )}
                    >
                      <span className="block truncate text-sm font-medium">
                        {asset.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          asset.identifier ?? asset.serialNumber,
                          asset.manufacturer,
                          asset.model,
                        ]
                          .filter(Boolean)
                          .join(" · ") || asset.category}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ListState>

          <Pagination
            meta={assets.data?.meta}
            onPrevious={controller.previousPage}
            onNext={controller.nextPage}
            isFetching={assets.isFetching}
          />
        </div>

        <MutationError error={add.error} />

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={!selected || add.isPending}
            onClick={() =>
              selected &&
              add.mutate({ assetId: selected.id }, { onSuccess: close })
            }
          >
            {add.isPending ? "Adicionando…" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
