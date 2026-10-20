"use client";

/**
 * Itens da proposta.
 *
 * ## Nenhum total é calculado aqui
 *
 * Cada linha mostra o `total` que o servidor gravou; o rodapé mostra
 * `subtotal`, `discount` e `total` do orçamento. Multiplicar quantidade por
 * preço no navegador daria um número que pode divergir do banco por
 * arredondamento — e a tela passaria a discordar do documento.
 *
 * ## A edição é por linha, e confirmada
 *
 * Alterar quantidade ou desconto manda `PATCH` e usa a **resposta** para
 * redesenhar tudo: o servidor devolve o orçamento inteiro já recalculado. Não
 * há estado local de totais para ficar desatualizado.
 */
import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PanelFrame } from "@/components/panels";
import { useAction } from "@/actions";
import { CATALOG_KIND_LABELS } from "@/entities";
import {
  useRemoveQuoteItem,
  useUpdateQuoteItem,
} from "@/hooks/quotes/use-quotes";
import type { Quote, QuoteItem } from "@/types/quotes";
import { Money, Quantity, SnapshotNotice } from "./quote-presentation";
import { QuoteItemPickerDialog } from "./quote-item-picker.dialog";

export function QuoteItemsPanel({ quote }: { quote: Quote }) {
  const edit = useAction("quote.update");
  const [pickerOpen, setPickerOpen] = useState(false);

  /** `canEdit` é do servidor — não deduzido do status. */
  const editable = edit.allowed && quote.transitions.canEdit;

  return (
    <PanelFrame
      panelId="quote-items"
      title="Itens"
      description={`${quote.itemCount} ${quote.itemCount === 1 ? "linha" : "linhas"} na proposta`}
      actions={
        editable ? (
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="size-4" />
            Adicionar
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {quote.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum item ainda. Uma proposta sem itens não pode ser enviada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Unitário</TableHead>
                  <TableHead className="text-right">Desconto</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {editable ? <TableHead className="w-24" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    quoteId={quote.id}
                    item={item}
                    editable={editable}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Totals quote={quote} />
        <SnapshotNotice />
      </div>

      <QuoteItemPickerDialog
        quoteId={quote.id}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />
    </PanelFrame>
  );
}

function ItemRow({
  quoteId,
  item,
  editable,
}: {
  quoteId: string;
  item: QuoteItem;
  editable: boolean;
}) {
  const update = useUpdateQuoteItem(quoteId);
  const remove = useRemoveQuoteItem(quoteId);
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unitPrice, setUnitPrice] = useState(item.unitPrice);
  const [discount, setDiscount] = useState(item.discount);

  const save = () => {
    update.mutate(
      {
        itemId: item.id,
        input: {
          quantity: toNumber(quantity),
          unitPrice: toNumber(unitPrice),
          discount: toNumber(discount),
        },
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const cancel = () => {
    setQuantity(item.quantity);
    setUnitPrice(item.unitPrice);
    setDiscount(item.discount);
    setEditing(false);
  };

  const failure = update.error ?? remove.error;

  return (
    <>
    <TableRow>
      <TableCell>
        <span className="font-medium">{item.description}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {CATALOG_KIND_LABELS[item.kind] ?? item.kind}
          {item.sku ? ` · ${item.sku}` : ""} · {item.unit}
          {item.catalogItemId ? "" : " · avulso"}
        </span>
      </TableCell>

      {editing ? (
        <>
          <TableCell className="text-right">
            <Input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              className="h-8 w-20 text-right"
              aria-label="Quantidade"
            />
          </TableCell>
          <TableCell className="text-right">
            <Input
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
              inputMode="decimal"
              className="h-8 w-24 text-right"
              aria-label="Preço unitário"
            />
          </TableCell>
          <TableCell className="text-right">
            <Input
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              inputMode="decimal"
              className="h-8 w-24 text-right"
              aria-label="Desconto"
            />
          </TableCell>
          <TableCell className="text-right text-xs text-muted-foreground">
            recalculado ao salvar
          </TableCell>
          <TableCell>
            <div className="flex justify-end gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={save}
                disabled={update.isPending}
                aria-label="Salvar"
              >
                <Check className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={cancel}
                aria-label="Descartar"
              >
                <X className="size-4" />
              </Button>
            </div>
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="text-right text-muted-foreground">
            <Quantity value={item.quantity} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={item.unitPrice} />
          </TableCell>
          <TableCell className="text-right">
            {Number(item.discount) > 0 ? (
              <Money value={item.discount} className="text-amber-400" />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell className="text-right font-medium">
            <Money value={item.total} />
          </TableCell>
          {editable ? (
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditing(true)}
                  aria-label="Editar item"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => remove.mutate(item.id)}
                  disabled={remove.isPending}
                  aria-label="Remover item"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </TableCell>
          ) : null}
        </>
      )}
    </TableRow>
    {/*
      A recusa aparece na linha que a causou.
      Um erro no rodapé do painel obrigaria a adivinhar de qual item ele é.
    */}
    {failure ? (
      <TableRow>
        <TableCell colSpan={editable ? 6 : 5} className="py-2">
          <MutationError error={failure} />
        </TableCell>
      </TableRow>
    ) : null}
    </>
  );
}

/**
 * Rodapé de valores.
 *
 * Os três números vêm do orçamento. O desconto aparece só quando existe —
 * uma linha "desconto R$ 0,00" ocuparia espaço para não dizer nada.
 */
function Totals({ quote }: { quote: Quote }) {
  const hasDiscount = Number(quote.discount) > 0;

  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd>
          <Money value={quote.subtotal} />
        </dd>
      </div>
      {hasDiscount ? (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Desconto</dt>
          <dd>
            <Money value={quote.discount} className="text-amber-400" />
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
        <dt>Total</dt>
        <dd>
          <Money value={quote.total} />
        </dd>
      </div>
      <p className="text-right text-xs text-muted-foreground">
        Calculado automaticamente.
      </p>
    </dl>
  );
}


function toNumber(value: string): number {
  return Number(value.trim().replace(/\./g, "").replace(",", "."));
}
