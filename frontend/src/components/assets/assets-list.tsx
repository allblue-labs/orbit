"use client";

/**
 * Listagem geral de equipamentos.
 *
 * **Filtros.** `AssetQueryDto` aceita busca, unidade, cliente, categoria e
 * status — e só isso. A busca cobre nome, identificador, número de
 * série, fabricante e modelo, então "tipo, fabricante e modelo" são
 * alcançáveis pela busca, não por filtro próprio.
 *
 * **Criticidade não existe no contrato** — não há campo no modelo `Asset` nem
 * parâmetro na consulta. A coluna e o filtro não são oferecidos, em vez de
 * derivar criticidade de status ou de `specifications`, que é JSON livre do
 * tenant. Ver `docs/customer-equipment.md`.
 *
 * **Ordenação** é do backend (`name asc, id asc`) e está declarada na tela: o
 * contrato não aceita parâmetro de ordenação, e reordenar a página atual daria
 * impressão falsa de ordem global.
 *
 * Busca, filtros, contagem, paginação e estados vêm do Workspace Core; o que
 * é desta tela são as colunas e quais filtros o backend aceita.
 */
import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Boxes } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityBadge, entityHref } from "@/entities";
import { useAssetsList } from "@/hooks/assets/use-assets";
import { useActiveScope } from "@/providers/use-active-scope";
import { AssetCategory, AssetStatus } from "@/types/contracts";
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS } from "@/entities";
import { ASSET_LIMITS, type Asset, type AssetQuery } from "@/types/assets";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";

const CATEGORY_OPTIONS = Object.values(AssetCategory).map((category) => ({
  value: category,
  label: ASSET_CATEGORY_LABELS[category] ?? category,
}));

const STATUS_OPTIONS = Object.values(AssetStatus).map((status) => ({
  value: status,
  label: ASSET_STATUS_LABELS[status] ?? status,
}));

export function AssetsList() {
  const { businessUnitId } = useActiveScope();
  const list = useListController<AssetQuery>({ limit: 20 });

  const scoped = useMemo<AssetQuery>(
    () => ({
      ...list.query,
      businessUnitId: list.query.businessUnitId ?? businessUnitId ?? undefined,
    }),
    [list.query, businessUnitId],
  );

  const query = useAssetsList(scoped);
  const assets = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-6">
      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id="assets-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Nome, identificador, série, fabricante ou modelo"
          maxLength={ASSET_LIMITS.searchMaxLength}
        />
        <FilterSelect
          id="assets-category"
          label="Categoria"
          value={list.query.category}
          onChange={(value) =>
            list.setFilter("category", value as AssetQuery["category"])
          }
          options={CATEGORY_OPTIONS}
          anyLabel="Todas"
        />
        <FilterSelect
          id="assets-status"
          label="Status"
          value={list.query.status}
          onChange={(value) =>
            list.setFilter("status", value as AssetQuery["status"])
          }
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      <ResultSummary
        meta={meta}
        noun="equipamento"
        note="Ordenado por nome"
      />

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={assets}
        empty={{
          icon: <Boxes className="size-5" />,
          title: "Nenhum equipamento encontrado",
          description: "Ajuste a busca ou os filtros para ver mais resultados.",
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipamento</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fabricante e modelo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((asset) => (
                  <AssetRow key={asset.id} asset={asset} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={query.isFetching}
      />
    </div>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  const href = entityHref("asset", asset.id) ?? "#";

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0 space-y-1">
          <Link href={href} className="font-medium hover:underline">
            {asset.name}
          </Link>
          {asset.identifier ? (
            <p className="font-mono text-xs text-muted-foreground">
              {asset.identifier}
            </p>
          ) : asset.serialNumber ? (
            <p className="font-mono text-xs text-muted-foreground">
              série {asset.serialNumber}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <EntityBadge entity="asset" group="category" value={asset.category} />
      </TableCell>
      <TableCell>
        <EntityBadge entity="asset" group="status" value={asset.status} />
      </TableCell>
      <TableCell className="text-sm">
        {(asset.manufacturer ?? asset.model) ? (
          <>
            {asset.manufacturer ?? "—"}
            {asset.model ? (
              <span className="block text-xs text-muted-foreground">
                {asset.model}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {asset.customer ? (
          (asset.customer.tradeName ?? asset.customer.legalName)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {asset.businessUnit
          ? (asset.businessUnit.tradeName ?? asset.businessUnit.legalName)
          : "—"}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" asChild>
          <Link href={href} aria-label={`Abrir ${asset.name}`}>
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
