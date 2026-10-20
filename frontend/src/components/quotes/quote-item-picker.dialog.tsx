"use client";

/**
 * Escolha de item para a proposta.
 *
 * ## Do Catálogo, com busca no servidor
 *
 * `PRODUCT`, `SERVICE` e `PART` são o mesmo registro com `kind` diferente, e
 * `kind` é filtro do contrato de catálogo. As três abas são recortes do
 * servidor, não filtragem de array.
 *
 * ## O preço do Catálogo é ponto de partida
 *
 * Ao escolher um item, quantidade e preço aparecem preenchidos — o preço vem
 * de `salePrice`. Alterá-lo é esperado: negociar é o que um orçamento faz, e o
 * backend aceita `unitPrice` justamente para isso. **O que for enviado vira
 * fotografia.**
 *
 * ## Item livre
 *
 * A última aba permite descrever algo que não está no Catálogo. O contrato
 * exige descrição e preço nesse caso, e o formulário só libera o envio quando
 * os dois existem — a recusa continuaria vindo do servidor, mas pedir duas
 * vezes a mesma coisa é desperdício.
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATALOG_KIND_LABELS } from "@/entities";
import { useCatalogItems } from "@/hooks/catalog/use-catalog";
import { useAddQuoteItem } from "@/hooks/quotes/use-quotes";
import { cn } from "@/lib/utils";
import { FORMATTERS } from "@/metrics";
import { ProductKind } from "@/types/contracts";
import type { CatalogItem } from "@/types/catalog";
import type { AddQuoteItemInput } from "@/types/quotes";
import { SnapshotNotice } from "./quote-presentation";

export function QuoteItemPickerDialog({
  quoteId,
  open,
  onOpenChange,
}: {
  quoteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <Body quoteId={quoteId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  quoteId,
  onOpenChange,
}: {
  quoteId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const add = useAddQuoteItem(quoteId);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("UN");
  const [free, setFree] = useState(false);

  const choose = (item: CatalogItem) => {
    setSelected(item);
    setFree(false);
    setUnitPrice(item.salePrice ?? "");
    setUnit(item.unit);
    setDescription("");
  };

  const startFree = () => {
    setFree(true);
    setSelected(null);
    setUnitPrice("");
    setDescription("");
    setUnit("UN");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const input: AddQuoteItemInput = {
      catalogItemId: selected?.id,
      description: description.trim() || undefined,
      unit: unit.trim() || undefined,
      quantity: toNumber(quantity),
      unitPrice: unitPrice.trim() ? toNumber(unitPrice) : undefined,
      discount: discount.trim() ? toNumber(discount) : undefined,
    };
    add.mutate(input, { onSuccess: () => onOpenChange(false) });
  };

  const quantityValue = toNumber(quantity);
  const priceValue = unitPrice.trim() ? toNumber(unitPrice) : NaN;

  const incomplete =
    (!selected && !free) ||
    !Number.isFinite(quantityValue) ||
    quantityValue <= 0 ||
    (free &&
      (description.trim().length < 2 ||
        !Number.isFinite(priceValue) ||
        priceValue < 0));

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Adicionar item</DialogTitle>
        <DialogDescription>
          Escolha do Catálogo ou descreva um item avulso. O preço sugerido pode
          ser alterado — é a proposta, não a tabela.
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue={ProductKind.SERVICE}>
        <TabsList>
          <TabsTrigger value={ProductKind.SERVICE}>Serviços</TabsTrigger>
          <TabsTrigger value={ProductKind.PRODUCT}>Produtos</TabsTrigger>
          <TabsTrigger value={ProductKind.PART}>Peças</TabsTrigger>
          <TabsTrigger value="livre" onClick={startFree}>
            Item avulso
          </TabsTrigger>
        </TabsList>

        {[ProductKind.SERVICE, ProductKind.PRODUCT, ProductKind.PART].map(
          (kind) => (
            <TabsContent key={kind} value={kind}>
              <CatalogPicker
                kind={kind}
                selectedId={selected?.id ?? null}
                onChoose={choose}
              />
            </TabsContent>
          ),
        )}

        <TabsContent value="livre">
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-2">
              <Label htmlFor="quote-item-description">Descrição</Label>
              <Input
                id="quote-item-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={255}
                placeholder="Ex.: Deslocamento até o litoral"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Item avulso não fica no Catálogo — vale só para esta proposta.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {selected || free ? (
        <div className="space-y-4 rounded-lg border border-border p-3">
          {selected ? (
            <p className="text-sm">
              <span className="font-medium">{selected.name}</span>
              {selected.sku ? (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {selected.sku}
                </span>
              ) : null}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="quote-item-quantity">Quantidade</Label>
              <Input
                id="quote-item-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-item-unit">Unidade</Label>
              <Input
                id="quote-item-unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-item-price">Preço unitário</Label>
              <Input
                id="quote-item-price"
                inputMode="decimal"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-item-discount">Desconto</Label>
              <Input
                id="quote-item-discount"
                inputMode="decimal"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          {/*
            Nenhum total é mostrado antes de enviar — quem calcula é o servidor,
            e antecipar aqui um número que ele pode arredondar diferente seria
            exibir uma conta que não é a que vale.
          */}
          <p className="text-xs text-muted-foreground">
            O total do item é calculado quando você adicionar.
          </p>
        </div>
      ) : null}

      <SnapshotNotice />
      <MutationError error={add.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || add.isPending}>
          {add.isPending ? "Adicionando…" : "Adicionar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Uma aba do Catálogo, recortada por `kind` no servidor. */
function CatalogPicker({
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
          placeholder={`Buscar em ${CATALOG_KIND_LABELS[kind]?.toLowerCase() ?? "catálogo"}`}
          autoComplete="off"
          aria-label="Buscar no catálogo"
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
        {query.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <PackageSearch className="size-4" aria-hidden />
            Nada encontrado — use &quot;Item avulso&quot; para descrever algo
            fora do Catálogo.
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
                  <span className="shrink-0 font-mono text-xs">
                    {item.salePrice
                      ? FORMATTERS.currency(Number(item.salePrice))
                      : "sem preço"}
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

/** Texto → número, só na fronteira com a API. Vírgula é como se digita aqui. */
function toNumber(value: string): number {
  return Number(value.trim().replace(/\./g, "").replace(",", "."));
}
