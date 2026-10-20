"use client";

/**
 * As cinco transições da proposta.
 *
 * ## A máquina de estados não é reimplementada
 *
 * Cada botão aparece quando **duas** coisas são verdade: a sessão pode ver a
 * ação (Action Registry) e o orçamento aceita a transição agora
 * (`transitions`, publicado pelo backend). Deduzir do status criaria uma
 * segunda máquina de estados, e as duas divergiriam no primeiro estado novo.
 *
 * ## Nenhuma antecipação
 *
 * Toda transição espera a resposta. O backend usa o estado de origem no
 * `where` e devolve 409 para o segundo clique — antecipar mostraria um
 * orçamento aprovado que o servidor vai negar.
 *
 * Recusa e cancelamento pedem motivo porque o contrato o exige; um "tem
 * certeza?" mandaria uma requisição que voltaria 400.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { QuoteReasonDialog } from "./quote-reason.dialog";
import { useAction } from "@/actions";
import {
  useIssueQuoteDocument,
  useQuoteTransition,
} from "@/hooks/quotes/use-quotes";
import { ROUTES } from "@/lib/routes";
import { OPERATION_KIND_LABELS, type Quote } from "@/types/quotes";

type Pending = "reject" | "cancel" | "convert" | null;

export function QuoteActions({ quote }: { quote: Quote }) {
  const send = useAction("quote.send");
  const approve = useAction("quote.approve");
  const reject = useAction("quote.reject");
  const cancel = useAction("quote.cancel");
  const convert = useAction("quote.convert");
  const issue = useAction("quote.issueDocument");

  const transition = useQuoteTransition(quote.id);
  const issueDocument = useIssueQuoteDocument(quote.id);
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);

  const can = quote.transitions;
  const showSend = send.allowed && can.canSend;
  const showApprove = approve.allowed && can.canApprove;
  const showReject = reject.allowed && can.canReject;
  const showCancel = cancel.allowed && can.canCancel;
  const showConvert = convert.allowed && can.canConvert;

  /**
   * Emitir não é transição, e por isso não consulta `transitions`.
   *
   * O que a proposta permite agora é sobre o ciclo dela — enviar, aprovar,
   * converter. Emitir o documento não muda o estado de nada: é criar o papel.
   * Só não se emite rascunho, porque ali o preço ainda muda — e essa é a mesma
   * regra que o servidor aplica, não uma segunda cópia dela.
   */
  const showIssue = issue.allowed && quote.status !== "DRAFT";

  const anything =
    showSend ||
    showApprove ||
    showReject ||
    showCancel ||
    showConvert ||
    showIssue;

  if (!anything) {
    return (
      <p className="text-sm text-muted-foreground">
        Não há ação disponível para esta proposta agora.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {showSend ? (
          <Button
            size="sm"
            onClick={() => transition.mutate({ action: "send" })}
            disabled={transition.isPending}
          >
            <send.definition.icon className="size-4" />
            {send.label}
          </Button>
        ) : null}

        {showApprove ? (
          <Button
            size="sm"
            onClick={() => transition.mutate({ action: "approve" })}
            disabled={transition.isPending}
          >
            <approve.definition.icon className="size-4" />
            {approve.label}
          </Button>
        ) : null}

        {showConvert ? (
          <Button size="sm" onClick={() => setPending("convert")}>
            <convert.definition.icon className="size-4" />
            {convert.label}
          </Button>
        ) : null}

        {/*
          Emitir leva para a execução, e isso é parte do ato.
          O documento ainda precisa da assinatura do proponente, e é lá que se
          assina e se emite. Ficar nesta tela deixaria a pessoa achando que
          terminou — com um documento em rascunho que ninguém recebeu.
        */}
        {showIssue ? (
          <Button
            size="sm"
            variant="outline"
            disabled={issueDocument.isPending}
            onClick={() =>
              issueDocument.mutate(undefined, {
                onSuccess: (execution) =>
                  router.push(`${ROUTES.executions}/${execution.id}`),
              })
            }
          >
            <issue.definition.icon className="size-4" />
            {issueDocument.isPending ? "Emitindo…" : issue.label}
          </Button>
        ) : null}

        {showReject ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPending("reject")}
          >
            <reject.definition.icon className="size-4" />
            {reject.label}
          </Button>
        ) : null}

        {showCancel ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setPending("cancel")}
          >
            <cancel.definition.icon className="size-4" />
            {cancel.label}
          </Button>
        ) : null}
      </div>

      <MutationError error={transition.error} />

      <QuoteReasonDialog
        open={pending === "reject"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Registrar recusa do cliente"
        description="O motivo fica registrado. É a informação comercial que mais falta seis meses depois."
        confirmLabel="Registrar recusa"
        isPending={transition.isPending}
        onConfirm={(reason) =>
          transition.mutate(
            { action: "reject", reason },
            { onSuccess: () => setPending(null) },
          )
        }
      />

      <QuoteReasonDialog
        open={pending === "cancel"}
        onOpenChange={(open) => !open && setPending(null)}
        title={cancel.confirm?.title ?? "Cancelar esta proposta?"}
        description={cancel.confirm?.body ?? ""}
        confirmLabel={cancel.confirm?.confirmLabel ?? "Cancelar proposta"}
        destructive
        isPending={transition.isPending}
        onConfirm={(reason) =>
          transition.mutate(
            { action: "cancel", reason },
            { onSuccess: () => setPending(null) },
          )
        }
      />

      <ConvertDialog
        quote={quote}
        open={pending === "convert"}
        onOpenChange={(open) => !open && setPending(null)}
        isPending={transition.isPending}
        onConfirm={(kind, priority) =>
          transition.mutate(
            { action: "convert", convert: { kind, priority } },
            { onSuccess: () => setPending(null) },
          )
        }
      />
    </div>
  );
}

/**
 * Conversão em operação.
 *
 * Pergunta só o que o orçamento não sabe: tipo de serviço e prioridade.
 * Técnico, agenda e execução **não são escolhidos aqui** — o contrato de
 * operações os trata como decisões posteriores, e adivinhá-los produziria uma
 * ordem de serviço que ninguém combinou.
 */
function ConvertDialog({
  quote,
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (kind: string, priority: string) => void;
}) {
  const [kind, setKind] = useState("MAINTENANCE");
  const [priority, setPriority] = useState("NORMAL");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(kind, priority);
          }}
          className="space-y-5"
        >
          <DialogHeader>
            <DialogTitle>Converter em operação</DialogTitle>
            <DialogDescription>
              Abre a ordem de serviço de {quote.code} para{" "}
              {quote.customer.displayName}. Repetir não cria uma segunda: a
              mesma proposta é devolvida.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quote-convert-kind">Tipo de serviço</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="quote-convert-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OPERATION_KIND_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote-convert-priority">Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="quote-convert-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Baixa</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">Alta</SelectItem>
                  <SelectItem value="URGENT">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
            Técnico, agenda e execução não são atribuídos aqui — a operação
            nasce aberta, e essas decisões acontecem no Workspace de operações.
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Voltar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Convertendo…" : "Converter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reexportado para telas que só precisam do diálogo de exclusão de rascunho. */
export { ConfirmDialog };
