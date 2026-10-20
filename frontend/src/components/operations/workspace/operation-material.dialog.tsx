"use client";

/**
 * Registrar material utilizado numa operação.
 *
 * Item + unidade + quantidade, e nada além. `POST /inventory/consumptions` com
 * `operationId` — sem contrato novo.
 *
 * ## O item vem do Catálogo, filtrado por quem tem estoque
 *
 * A busca é do servidor e cobre `PRODUCT` e `PART`. `SERVICE` não aparece:
 * serviço não sai da prateleira, e oferecê-lo aqui levaria a um 400 depois de
 * a pessoa já ter preenchido o resto.
 *
 * ## A unidade é a da operação
 *
 * O material sai da prateleira de quem executa. É editável, porque acontece de
 * a peça vir de outra filial — mas o padrão é o certo na maioria das vezes.
 */
import { useState } from "react";
import { PackageSearch, Search } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCatalogItems } from "@/hooks/catalog/use-catalog";
import { useInventoryConsume } from "@/hooks/inventory/use-inventory";
import { useActiveScope } from "@/providers/use-active-scope";
import { cn } from "@/lib/utils";
import { ProductKind } from "@/types/contracts";
import type { CatalogItem } from "@/types/catalog";

export function OperationMaterialDialog({
  operationId,
  businessUnitId,
  open,
  onOpenChange,
}: {
  operationId: string;
  businessUnitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <Body
          operationId={operationId}
          businessUnitId={businessUnitId}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  operationId,
  businessUnitId,
  onOpenChange,
}: {
  operationId: string;
  businessUnitId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { businessUnits } = useActiveScope();
  const consume = useInventoryConsume();

  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState(businessUnitId);
  const [reason, setReason] = useState("");

  const amount = Number(quantity.trim().replace(/\./g, "").replace(",", "."));
  const incomplete = !selected || !Number.isFinite(amount) || amount <= 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected) return;
        consume.mutate(
          {
            catalogItemId: selected.id,
            businessUnitId: unit,
            quantity: amount,
            operationId,
            reason: reason.trim() || undefined,
          },
          { onSuccess: () => onOpenChange(false) },
        );
      }}
      className="space-y-5"
    >
      <DialogHeader>
        <DialogTitle>Registrar material utilizado</DialogTitle>
        <DialogDescription>
          Dá baixa no estoque da unidade e vincula o consumo a esta ordem de
          serviço. É o material que de fato saiu — não o que foi orçado.
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue={ProductKind.PART}>
        <TabsList>
          <TabsTrigger value={ProductKind.PART}>Peças</TabsTrigger>
          <TabsTrigger value={ProductKind.PRODUCT}>Produtos</TabsTrigger>
        </TabsList>

        {[ProductKind.PART, ProductKind.PRODUCT].map((kind) => (
          <TabsContent key={kind} value={kind}>
            <ItemPicker
              kind={kind}
              selectedId={selected?.id ?? null}
              onChoose={setSelected}
            />
          </TabsContent>
        ))}
      </Tabs>

      {selected ? (
        <div className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-1">
            <Label htmlFor="material-quantity">
              Quantidade ({selected.unit})
            </Label>
            <Input
              id="material-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="material-unit">Unidade de estoque</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger id="material-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {businessUnits.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.tradeName ?? option.legalName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Padrão: a unidade da operação — a prateleira de quem executa.
            </p>
          </div>

          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="material-reason">Observação (opcional)</Label>
            <Input
              id="material-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="Ex.: substituição do filtro da evaporadora 2"
            />
          </div>
        </div>
      ) : null}

      {/*
        Saldo insuficiente chega como 409 com o disponível. A invalidação do
        hook já revalidou os saldos exibidos — a mensagem e a tela concordam.
      */}
      <MutationError error={consume.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || consume.isPending}>
          {consume.isPending ? "Registrando…" : "Registrar consumo"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Uma aba do Catálogo, recortada por `kind` no servidor. */
function ItemPicker({
  kind,
  selectedId,
  onChoose,
}: {
  kind: ProductKind;
  selectedId: string | null;
  onChoose: (item: CatalogItem) => void;
}) {
  const [term, setTerm] = useState("");
  const query = useCatalogItems({
    kind,
    search: term.trim() || undefined,
    status: "ACTIVE",
    page: 1,
    limit: 8,
  });

  const items = query.data?.data ?? [];

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar por nome ou SKU"
          autoComplete="off"
          aria-label="Buscar material"
        />
      </div>

      <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
        {query.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <PackageSearch className="size-4" aria-hidden />
            Nada encontrado no catálogo.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onChoose(item)}
                  aria-pressed={item.id === selectedId}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                    item.id === selectedId
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-surface-strong",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.sku ? `${item.sku} · ` : ""}
                      {item.unit}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
