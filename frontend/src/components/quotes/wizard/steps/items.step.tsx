"use client";

/**
 * Passo 3 — o que se vai cobrar.
 *
 * ## Serviços e materiais, nas mesmas colunas
 *
 * São o mesmo registro do Catálogo com `kind` diferente, e o documento os imprime
 * com as mesmas seis colunas. Duas abas aqui separam o que se procura sem
 * inventar dois formatos de linha.
 *
 * ## O preço do Catálogo é ponto de partida
 *
 * Ao escolher, quantidade e preço aparecem preenchidos. Alterá-los é esperado —
 * negociar é o que um orçamento faz — e o que for enviado vira fotografia: mexer
 * no Catálogo depois não muda a proposta.
 *
 * ## Somado no fim, discriminado linha por linha
 *
 * O total geral fica no passo seguinte. Aqui o que importa é conferir cada linha,
 * e um total grande no meio da montagem tira a atenção da linha que está errada.
 */
import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCatalogItems } from "@/hooks/catalog/use-catalog";
import { cn } from "@/lib/utils";
import { FORMATTERS } from "@/metrics";
import type { CatalogItem } from "@/types/catalog";
import type { DraftItem, QuoteDraft } from "../quote-wizard.model";

/** Quantos itens do catálogo oferecer por busca. */
const CATALOG_LIMIT = 20;

type Aba = "SERVICE" | "PRODUCT" | "FREE";

export function ItemsStep({
  draft,
  onChange,
}: {
  draft: QuoteDraft;
  onChange: (patch: Partial<QuoteDraft>) => void;
}) {
  const [aba, setAba] = useState<Aba>("SERVICE");

  const add = (item: DraftItem) => onChange({ items: [...draft.items, item] });

  const remove = (key: string) =>
    onChange({ items: draft.items.filter((item) => item.key !== key) });

  const patch = (key: string, changes: Partial<DraftItem>) =>
    onChange({
      items: draft.items.map((item) =>
        item.key === key ? { ...item, ...changes } : item,
      ),
    });

  return (
    <div className="space-y-5">
      <Tabs value={aba} onValueChange={(value) => setAba(value as Aba)}>
        <TabsList>
          <TabsTrigger value="SERVICE">Serviços</TabsTrigger>
          <TabsTrigger value="PRODUCT">Materiais</TabsTrigger>
          <TabsTrigger value="FREE">Item livre</TabsTrigger>
        </TabsList>

        <TabsContent value="SERVICE">
          <CatalogChooser kind="SERVICE" onAdd={add} />
        </TabsContent>
        <TabsContent value="PRODUCT">
          <CatalogChooser kind="PRODUCT" onAdd={add} />
        </TabsContent>
        <TabsContent value="FREE">
          <FreeItemForm onAdd={add} />
        </TabsContent>
      </Tabs>

      <ChosenItems items={draft.items} onRemove={remove} onPatch={patch} />
    </div>
  );
}

/**
 * A busca é do servidor.
 *
 * `kind` é filtro do contrato de catálogo, e filtrar no cliente filtraria a
 * página carregada — quem digitasse o nome de um item da página três não
 * encontraria nada.
 */
function CatalogChooser({
  kind,
  onAdd,
}: {
  kind: "SERVICE" | "PRODUCT";
  onAdd: (item: DraftItem) => void;
}) {
  const [search, setSearch] = useState("");
  const query = useCatalogItems({
    kind,
    search: search.trim() || undefined,
    page: 1,
    limit: CATALOG_LIMIT,
  });

  const items = query.data?.data ?? [];

  return (
    <div className="space-y-3 pt-3">
      <div className="relative">
        <Search
          className="absolute top-2.5 left-2 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={
            kind === "SERVICE" ? "Buscar serviço" : "Buscar material"
          }
          className="pl-8"
        />
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {query.isPending
            ? "Carregando…"
            : `Nenhum ${kind === "SERVICE" ? "serviço" : "material"} encontrado.`}
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <CatalogRow item={item} onAdd={onAdd} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({
  item,
  onAdd,
}: {
  item: CatalogItem;
  onAdd: (item: DraftItem) => void;
}) {
  const price = Number(item.salePrice ?? 0);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.name}</span>
        <span className="text-xs text-muted-foreground">
          {item.sku ? `${item.sku} · ` : ""}
          {item.unit ?? "UN"} · {FORMATTERS.currency(price)}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        /* Item sem preço de venda seria recusado pelo servidor: o contrato exige
           `unitPrice` explícito, e aqui não há onde informá-lo. */
        disabled={price <= 0}
        onClick={() =>
          onAdd({
            key: `${item.id}-${Date.now()}`,
            catalogItemId: item.id,
            kind: item.kind === "SERVICE" ? "SERVICE" : "PRODUCT",
            description: item.name,
            unit: item.unit ?? "UN",
            quantity: 1,
            unitPrice: price,
          })
        }
      >
        <Plus className="size-4" />
        Adicionar
      </Button>
    </div>
  );
}

/**
 * Item que não está no Catálogo.
 *
 * O contrato exige descrição e preço quando não há `catalogItemId`; o formulário
 * só libera com os dois, porque a recusa continuaria vindo do servidor e pedir
 * duas vezes a mesma coisa é desperdício.
 */
function FreeItemForm({ onAdd }: { onAdd: (item: DraftItem) => void }) {
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("SERV");
  const [price, setPrice] = useState("");

  const valor = Number(price.replace(",", "."));
  const pronto = description.trim().length >= 2 && valor > 0;

  return (
    <div className="grid gap-3 pt-3 sm:grid-cols-[2fr_auto_auto_auto]">
      <div className="space-y-1.5">
        <Label htmlFor="wizard-free-desc">Descrição</Label>
        <Input
          id="wizard-free-desc"
          value={description}
          maxLength={255}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-free-unit">Unidade</Label>
        <Input
          id="wizard-free-unit"
          value={unit}
          maxLength={20}
          className="w-24"
          onChange={(event) => setUnit(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-free-price">Valor unitário</Label>
        <Input
          id="wizard-free-price"
          value={price}
          inputMode="decimal"
          className="w-32"
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>
      <div className="flex items-end">
        <Button
          type="button"
          size="sm"
          disabled={!pronto}
          onClick={() => {
            onAdd({
              key: `livre-${Date.now()}`,
              catalogItemId: null,
              kind: "SERVICE",
              description: description.trim(),
              unit: unit.trim() || "UN",
              quantity: 1,
              unitPrice: valor,
            });
            setDescription("");
            setPrice("");
          }}
        >
          <Plus className="size-4" />
          Adicionar
        </Button>
      </div>
    </div>
  );
}

/** Os itens escolhidos, discriminados e editáveis. */
function ChosenItems({
  items,
  onRemove,
  onPatch,
}: {
  items: readonly DraftItem[];
  onRemove: (key: string) => void;
  onPatch: (key: string, changes: Partial<DraftItem>) => void;
}) {
  const grupos = useMemo(
    () =>
      [
        ["Serviços", items.filter((item) => item.kind === "SERVICE")],
        [
          "Materiais e fornecimentos",
          items.filter((item) => item.kind !== "SERVICE"),
        ],
      ] as const,
    [items],
  );

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
        Nenhum item ainda. Uma proposta sem item não pode ser enviada.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {grupos.map(([titulo, lista]) =>
        lista.length === 0 ? null : (
          <div key={titulo} className="space-y-2">
            {/* O rótulo do grupo é o mesmo do documento — quem confere aqui
                reconhece a seção no PDF. */}
            <h4 className="text-xs font-medium text-muted-foreground uppercase">
              {titulo}
            </h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-24 text-right">Qtd.</TableHead>
                    <TableHead className="w-20">Un.</TableHead>
                    <TableHead className="w-32 text-right">Unitário</TableHead>
                    <TableHead className="w-32 text-right">Subtotal</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lista.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="max-w-[16rem] truncate">
                        {item.description}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Quantidade de ${item.description}`}
                          value={String(item.quantity)}
                          inputMode="decimal"
                          className={cn(
                            "h-8 text-right",
                            item.quantity <= 0 && "border-destructive",
                          )}
                          onChange={(event) =>
                            onPatch(item.key, {
                              quantity: Number(
                                event.target.value.replace(",", "."),
                              ),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.unit}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Valor unitário de ${item.description}`}
                          value={String(item.unitPrice)}
                          inputMode="decimal"
                          className="h-8 text-right"
                          onChange={(event) =>
                            onPatch(item.key, {
                              unitPrice: Number(
                                event.target.value.replace(",", "."),
                              ),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {FORMATTERS.currency(item.quantity * item.unitPrice)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover ${item.description}`}
                          onClick={() => onRemove(item.key)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
