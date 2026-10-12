"use client";

/**
 * Detalhe de uma proposta — o editor.
 *
 * ## Editor e visualização são a mesma tela
 *
 * O que muda entre rascunho e proposta enviada não é o layout, é o que aceita
 * interação — e quem decide isso é o `transitions` publicado pelo backend, não
 * uma dedução a partir do status. Duas telas separadas divergiriam na primeira
 * mudança de contrato.
 *
 * ## O cabeçalho é editável enquanto o servidor permitir
 *
 * Título, validade, observações e desconto do orçamento entram em
 * `PATCH /quotes/:id`, que o backend só aceita em rascunho. Cliente e unidade
 * **não** são editáveis: trocar o destinatário de uma proposta é criar outra
 * proposta, e o DTO não os aceita.
 */
import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { useAction } from "@/actions";
import { EntityBadge, EntityLink } from "@/entities";
import { useQuote, useRemoveQuote, useUpdateQuote } from "@/hooks/quotes/use-quotes";
import { ROUTES } from "@/lib/routes";
import { QUOTE_STATUS_DESCRIPTIONS } from "@/types/quotes";
import type { Quote } from "@/types/quotes";
import { TabBoundary } from "@/workspace";
import { QuoteActions } from "./quote-actions";
import { QuoteFlow } from "./quote-flow";
import { QuoteItemsPanel } from "./quote-items.panel";
import { QuoteTimeline } from "./quote-timeline";
import { Money, SendRequirements, ValidUntil } from "./quote-presentation";
import { useRouter } from "next/navigation";

export function QuoteWorkspace({ quoteId }: { quoteId: string }) {
  const query = useQuote(quoteId);

  if (query.isPending) {
    return (
      <ContentContainer size="wide">
        <PanelLoading rows={8} />
      </ContentContainer>
    );
  }

  if (query.error || !query.data) {
    return (
      <ContentContainer size="wide">
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      </ContentContainer>
    );
  }

  return <Body quote={query.data} onRefresh={() => void query.refetch()} />;
}

function Body({
  quote,
  onRefresh,
}: {
  quote: Quote;
  onRefresh: () => void;
}) {
  return (
    <ContentContainer size="wide" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {quote.code}
            </h1>
            <EntityBadge entity="quote" group="status" value={quote.status} />
            {quote.operation ? (
              <Badge variant="secondary">convertido</Badge>
            ) : null}
          </div>
          <p className="text-sm">{quote.title}</p>
          <p className="text-xs text-muted-foreground">
            {QUOTE_STATUS_DESCRIPTIONS[quote.status] ?? ""}
          </p>
        </div>

        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-4" />
          Atualizar
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="min-w-0 space-y-6">
          <TabBoundary id="quote-header" label="o cabeçalho">
            <HeaderPanel quote={quote} />
          </TabBoundary>

          <TabBoundary id="quote-items" label="os itens">
            <QuoteItemsPanel quote={quote} />
          </TabBoundary>
        </div>

        <div className="min-w-0 space-y-6">
          <PanelFrame
            panelId="quote-actions"
            title="Ações"
            description="O que a proposta aceita agora"
          >
            <div className="space-y-3">
              <SendRequirements quote={quote} />
              <QuoteActions quote={quote} />
              <DraftDeletion quote={quote} />
            </div>
          </PanelFrame>

          <TabBoundary id="quote-flow" label="o fluxo">
            <QuoteFlow quote={quote} />
          </TabBoundary>

          <TabBoundary id="quote-timeline" label="o histórico">
            <QuoteTimeline quote={quote} />
          </TabBoundary>
        </div>
      </div>
    </ContentContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Cabeçalho                                                           */
/* ------------------------------------------------------------------ */

function HeaderPanel({ quote }: { quote: Quote }) {
  const edit = useAction("quote.update");
  const update = useUpdateQuote(quote.id);
  const editable = edit.allowed && quote.transitions.canEdit;

  const [title, setTitle] = useState(quote.title);
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [validUntil, setValidUntil] = useState(quote.validUntil ?? "");
  const [discount, setDiscount] = useState(quote.discount);
  const [dirty, setDirty] = useState(false);

  const save = () => {
    update.mutate(
      {
        title: title.trim(),
        notes: notes.trim() || undefined,
        validUntil: validUntil || undefined,
        discount: Number(discount.replace(/\./g, "").replace(",", ".")),
      },
      { onSuccess: () => setDirty(false) },
    );
  };

  const touch = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  return (
    <PanelFrame
      panelId="quote-header"
      title="Proposta"
      description={
        editable
          ? "Cliente e organização não mudam: trocar o destinatário é criar outra proposta."
          : "Enviada ao cliente — o conteúdo não muda mais."
      }
      actions={
        editable && dirty ? (
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Cliente</dt>
            <dd className="text-sm">
              <EntityLink entity="customer" id={quote.customer.id}>
                {quote.customer.displayName}
              </EntityLink>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Organização</dt>
            <dd className="text-sm">{quote.businessUnit.name}</dd>
          </div>
        </dl>

        {editable ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quote-edit-title">Título</Label>
              <Input
                id="quote-edit-title"
                value={title}
                onChange={(event) => touch(setTitle)(event.target.value)}
                maxLength={220}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quote-edit-valid">Validade</Label>
                <Input
                  id="quote-edit-valid"
                  type="date"
                  value={validUntil}
                  onChange={(event) =>
                    touch(setValidUntil)(event.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-edit-discount">
                  Desconto sobre o total
                </Label>
                <Input
                  id="quote-edit-discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(event) => touch(setDiscount)(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  O desconto não pode ser maior que o subtotal.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote-edit-notes">Observações</Label>
              <Textarea
                id="quote-edit-notes"
                value={notes}
                onChange={(event) => touch(setNotes)(event.target.value)}
                rows={3}
                maxLength={4000}
              />
            </div>

            <MutationError error={update.error} />
          </div>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Validade</dt>
              <dd className="text-sm">
                <ValidUntil quote={quote} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="text-sm">
                <Money value={quote.total} />
              </dd>
            </div>
            {quote.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Observações</dt>
                <dd className="text-sm whitespace-pre-wrap">{quote.notes}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Exclusão de rascunho                                                */
/* ------------------------------------------------------------------ */

/**
 * Só rascunho é apagável.
 *
 * Proposta enviada é **cancelada**, para que o motivo e o histórico
 * permaneçam — apagar o que o cliente já viu destruiria a explicação de um
 * negócio perdido. O botão só aparece quando o servidor aceitaria.
 */
function DraftDeletion({ quote }: { quote: Quote }) {
  const router = useRouter();
  const action = useAction("quote.delete");
  const remove = useRemoveQuote();
  const [confirming, setConfirming] = useState(false);

  if (!action.allowed || quote.status !== "DRAFT") return null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" />
        {action.label}
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={action.confirm?.title ?? "Excluir este rascunho?"}
        body={action.confirm?.body}
        confirmLabel={action.confirm?.confirmLabel ?? "Excluir"}
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(quote.id, {
            onSuccess: () => router.push(ROUTES.quotes),
          })
        }
      />
    </>
  );
}
