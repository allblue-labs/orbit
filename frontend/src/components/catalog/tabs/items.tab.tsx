"use client";

/**
 * Aba de itens do catálogo — serve Produtos, Serviços e Peças.
 *
 * ## Um componente, três abas
 *
 * Produtos e serviços são o **mesmo registro** com `kind` diferente, e `kind`
 * é filtro do servidor. Escrever duas listagens quase idênticas seria a
 * duplicação que o Workspace Core existe para evitar — o que muda entre elas é
 * a coluna que faz sentido destacar, e isso é uma prop.
 *
 * ## O que a tela não faz
 *
 * Não soma, não calcula margem, não deriva imposto. Preço de venda e custo são
 * dois campos independentes publicados pelo backend; quando existir Orçamento,
 * quem multiplica quantidade por preço é o servidor.
 */
import { useState } from "react";
import { PackageSearch, Plus } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/actions";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { CATALOG_STATUS_LABELS, EntityBadge } from "@/entities";
import {
  useCatalogCategories,
  useCatalogItems,
  useRemoveCatalogItem,
  useUpdateCatalogItem,
} from "@/hooks/catalog/use-catalog";
import { ProductKind, ProductStatus } from "@/types/contracts";
import type { CatalogItem, CatalogQuery } from "@/types/catalog";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  optionsFrom,
  useListController,
} from "@/workspace";
import { CatalogItemFormDialog } from "../catalog-item-form.dialog";
import { CatalogItemSheet } from "../catalog-item.sheet";
import { PriceLabel, SkuLabel } from "../catalog-presentation";

const STATUS_OPTIONS = optionsFrom(
  Object.values(ProductStatus),
  CATALOG_STATUS_LABELS,
);

export function CatalogItemsTab({
  kind,
  noun,
  gender,
  emptyTitle,
  emptyDescription,
}: {
  kind: ProductKind;
  /** Como contar: "produto", "serviço", "peça". */
  noun: string;
  /** Gênero do substantivo, repassado para a contagem concordar. */
  gender?: "m" | "f";
  emptyTitle: string;
  emptyDescription: string;
}) {
  const list = useListController<CatalogQuery>({ limit: 20 });
  const categories = useCatalogCategories();

  /** `kind` é do servidor e não é escolha do usuário nesta aba. */
  const query = useCatalogItems({ ...list.query, kind });

  const create = useAction("catalog-item.create");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [selected, setSelected] = useState<CatalogItem | null>(null);

  const items = query.data?.data ?? [];
  const meta = query.data?.meta;

  const categoryOptions = (categories.data ?? []).map((category) => ({
    value: category.id,
    label: category.name,
  }));

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={meta}
          noun={noun}
          gender={gender}
          note="Ordenado por nome"
        />
        {create.allowed ? (
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" />
            {create.label}
          </Button>
        ) : null}
      </div>

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id={`catalog-${kind}-search`}
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Nome, SKU ou descrição"
          hint="A busca cobre nome, SKU e descrição."
        />
        <FilterSelect
          id={`catalog-${kind}-category`}
          label="Categoria"
          value={list.query.categoryId}
          onChange={(value) => list.setFilter("categoryId", value)}
          options={categoryOptions}
          anyLabel="Todas"
        />
        <FilterSelect
          id={`catalog-${kind}-status`}
          label="Disponibilidade"
          value={list.query.status}
          onChange={(value) =>
            list.setFilter("status", value as CatalogQuery["status"])
          }
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={items}
        empty={{
          icon: <PackageSearch className="size-5" />,
          title: emptyTitle,
          description: emptyDescription,
          action: create.allowed ? (
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" />
              {create.label}
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Disponibilidade</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onOpen={() => setSelected(item)}
                    onEdit={() => {
                      setEditing(item);
                      setFormOpen(true);
                    }}
                  />
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

      <CatalogItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultKind={kind}
      />

      <CatalogItemSheet
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onEdit={(item) => {
          setSelected(null);
          setEditing(item);
          setFormOpen(true);
        }}
      />
    </div>
  );
}

function ItemRow({
  item,
  onOpen,
  onEdit,
}: {
  item: CatalogItem;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const edit = useAction("catalog-item.update");
  const activate = useAction("catalog-item.activate");
  const deactivate = useAction("catalog-item.deactivate");
  const excluir = useAction("catalog-item.delete");

  const update = useUpdateCatalogItem(item.id);
  const remove = useRemoveCatalogItem();
  const inactive = item.status === ProductStatus.INACTIVE;
  const toggle = inactive ? activate : deactivate;

  const [excluindo, setExcluindo] = useState(false);

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0 space-y-1">
          <button
            type="button"
            onClick={onOpen}
            className="text-left font-medium hover:underline"
          >
            {item.name}
          </button>
          <SkuLabel sku={item.sku} />
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.category?.name ?? "—"}
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <EntityBadge
            entity="catalog-item"
            group="status"
            value={item.status}
          />
          <MutationError error={update.error} />
        </div>
      </TableCell>
      <TableCell>
        <PriceLabel item={item} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.businessUnit
          ? (item.businessUnit.tradeName ?? item.businessUnit.legalName)
          : "Toda a organização"}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {edit.allowed || toggle.allowed || excluir.allowed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Ações de ${item.name}`}
                  disabled={update.isPending}
                >
                  <span aria-hidden>⋯</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onOpen}>Detalhes</DropdownMenuItem>
                {edit.allowed ? (
                  <DropdownMenuItem onSelect={onEdit}>
                    <edit.definition.icon className="size-4" />
                    {edit.label}
                  </DropdownMenuItem>
                ) : null}
                {toggle.allowed ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      update.mutate({
                        status: inactive
                          ? ProductStatus.ACTIVE
                          : ProductStatus.INACTIVE,
                      })
                    }
                  >
                    <toggle.definition.icon className="size-4" />
                    {toggle.label}
                  </DropdownMenuItem>
                ) : null}

                {/* Retirar de circulação e excluir são coisas diferentes, e
                    o texto de confirmação do registry diz qual é qual. A
                    ação existia declarada e nenhuma tela a oferecia. */}
                {excluir.allowed ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      setExcluindo(true);
                    }}
                  >
                    <excluir.definition.icon className="size-4" />
                    {excluir.label}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <ConfirmDialog
          open={excluindo}
          onOpenChange={setExcluindo}
          title={excluir.confirm?.title ?? "Excluir este item?"}
          body={excluir.confirm?.body ?? ""}
          confirmLabel={excluir.confirm?.confirmLabel ?? "Excluir"}
          isPending={remove.isPending}
          error={remove.error}
          onConfirm={() =>
            remove.mutate(item.id, { onSuccess: () => setExcluindo(false) })
          }
        />
      </TableCell>
    </TableRow>
  );
}
