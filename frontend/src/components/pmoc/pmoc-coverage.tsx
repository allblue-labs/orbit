"use client";

/**
 * A cobertura do plano — quais equipamentos ele mantém.
 *
 * ## Cursor, não página numerada
 *
 * O backend pagina por cursor (`equipment-page`), porque a cobertura de um
 * contrato grande passa de centenas de máquinas. Traduzir para "página 3" no
 * cliente reintroduziria o salto de registros que o cursor evita — e exigiria
 * saber o total, que o contrato de cursor deliberadamente não devolve.
 *
 * A navegação é a que o cursor permite: avançar enquanto houver próxima
 * página, e recomeçar. Voltar exigiria guardar os cursores anteriores; a pilha
 * local resolve isso sem inventar contrato.
 */
import { useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePmocCoverage, useRemovePmocCoverage } from "@/hooks/pmoc/use-pmoc";
import { useSession } from "@/providers/session-provider";
import { formatDate } from "@/lib/formatters";
import type { PmocCoveragePageQuery } from "@/types/pmoc";
import { ListState, SearchField } from "@/workspace";
import { EquipmentSelectorDialog } from "./equipment-selector.dialog";

export function PmocCoveragePanel({
  planId,
  customerId,
  businessUnitId,
}: {
  planId: string;
  customerId: string;
  businessUnitId: string;
}) {
  const session = useSession();
  const canManage = session.hasPermission("pmoc.manage");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const remove = useRemovePmocCoverage(planId);
  const [search, setSearch] = useState("");
  /** Pilha de cursores já visitados — é o que torna "Anterior" possível. */
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  const query: PmocCoveragePageQuery = {
    cursor: cursors[cursors.length - 1],
    limit: 20,
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const page = usePmocCoverage(planId, query);

  const restart = (term: string) => {
    setSearch(term);
    setCursors([undefined]);
  };

  const covered = (page.data?.data ?? []).map((item) => item.asset.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField
          id="pmoc-coverage-search"
          className="min-w-64 flex-1"
          value={search}
          onChange={restart}
          label="Buscar"
          placeholder="Nome, identificação ou número de série"
          hint="A busca considera toda a cobertura, não apenas esta página."
        />
        {canManage ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Adicionar equipamento
          </Button>
        ) : null}
      </div>

      <ListState
        isPending={page.isPending}
        error={page.error}
        onRetry={() => void page.refetch()}
        items={page.data?.data ?? []}
        empty={{
          icon: <Package className="size-5" />,
          title: "Nenhum equipamento coberto",
          description:
            "A cobertura define quais equipamentos este plano mantém. Sem cobertura, as execuções nascem vazias.",
          action: canManage ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Adicionar equipamento
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipamento</TableHead>
                  <TableHead>Identificação</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Coberto desde</TableHead>
                  {canManage ? <TableHead className="w-16" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((coverage) => (
                  <TableRow key={coverage.id}>
                    <TableCell className="max-w-[16rem] truncate font-medium">
                      {coverage.asset.name}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">
                      {coverage.asset.identifier ??
                        coverage.asset.serialNumber ??
                        "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {coverage.asset.category}
                    </TableCell>
                    <TableCell className="text-sm">
                      {coverage.asset.status === "ACTIVE" ? "Ativo" : "Inativo"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(coverage.startsOn)}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover ${coverage.asset.name} da cobertura`}
                          disabled={remove.isPending}
                          onClick={() =>
                            setRemoving({
                              id: coverage.id,
                              name: coverage.asset.name,
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={cursors.length === 1 || page.isFetching}
          onClick={() => setCursors((stack) => stack.slice(0, -1))}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!page.data?.hasNextPage || page.isFetching}
          onClick={() =>
            setCursors((stack) => [
              ...stack,
              page.data?.nextCursor ?? undefined,
            ])
          }
        >
          Próxima
        </Button>
      </div>

      <EquipmentSelectorDialog
        open={adding}
        onOpenChange={setAdding}
        planId={planId}
        customerId={customerId}
        businessUnitId={businessUnitId}
        coveredAssetIds={covered}
      />

      {/**
       * Remover da cobertura não apaga histórico.
       *
       * As execuções já cumpridas continuam apontando para o equipamento; o que
       * muda é que ele deixa de entrar nos próximos. Por isso a confirmação é
       * simples — a operação não é destrutiva no domínio, e um alerta grave
       * ensinaria o contrário.
       */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remover da cobertura"
        body={`${removing?.name ?? ""} deixará de entrar nas próximas execuções. As execuções já cumpridas permanecem no histórico.`}
        confirmLabel="Remover"
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (removing) {
            remove.mutate(removing.id, { onSuccess: () => setRemoving(null) });
          }
        }}
      />
    </div>
  );
}
