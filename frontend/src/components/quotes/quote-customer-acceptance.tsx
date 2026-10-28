"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PenLine,
  CircleCheck,
  MessageSquare,
  XCircle,
  Clock,
} from "lucide-react";
import { quoteAcceptanceService } from "@/services/quote-acceptance.service";
import { quotesService } from "@/services/quotes.service";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { CustomerLinkDialog } from "@/components/signature/customer-link.dialog";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { Quote } from "@/types/quotes";

export function QuoteCustomerAcceptance({
  quote,
  canGenerate,
}: {
  quote: Quote;
  canGenerate: boolean;
}) {
  const cache = useQueryClient();
  const { formatDateTime } = useDateFormatters();
  const response = useQuery({
    queryKey: queryKeys.nested("quotes", quote.id, "customer-response"),
    queryFn: () => quoteAcceptanceService.latest(quote.id),
    refetchInterval: 15000,
  });
  const create = useApiMutation(() => quoteAcceptanceService.create(quote.id), {
    invalidate: [quotesService.keys.all()],
    notify: "Link de aprovação criado.",
  });
  const answeredAt = response.data?.respondedAt;
  useEffect(() => {
    if (answeredAt) {
      void cache.invalidateQueries({
        queryKey: quotesService.keys.all(),
      });
      void cache.invalidateQueries({ queryKey: queryKeys.module("financial") });
    }
  }, [answeredAt, cache, quote.id]);
  const answer = response.data;
  const label =
    answer?.decision === "APPROVE"
      ? "Orçamento aprovado e assinado pelo cliente"
      : answer?.decision === "REJECT"
        ? "Orçamento recusado pelo cliente"
        : answer?.decision === "REQUEST_CHANGES"
          ? "Cliente solicitou alterações"
          : answer?.state === "AVAILABLE"
            ? "Aguardando resposta do cliente"
            : answer
              ? "Link encerrado — gere outro para continuar"
              : "Aceite do cliente por link";
  const Icon =
    answer?.decision === "APPROVE"
      ? CircleCheck
      : answer?.decision === "REJECT"
        ? XCircle
        : answer?.decision === "REQUEST_CHANGES"
          ? MessageSquare
          : Clock;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <MutationError error={response.error} />
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0 text-primary" />
        {label}
      </p>
      {answer?.respondedAt ? (
        <p className="text-xs text-muted-foreground">
          {answer.signerName} · {formatDateTime(answer.respondedAt)}
        </p>
      ) : null}
      {answer?.reason ? (
        <p className="whitespace-pre-wrap text-sm">{answer.reason}</p>
      ) : null}
      {answer?.decision === "REQUEST_CHANGES" && quote.status === "DRAFT" ? (
        <p className="text-xs text-muted-foreground">
          A proposta voltou para edição. Ajuste o orçamento e gere um novo link
          para o cliente conferir.
        </p>
      ) : null}
      {canGenerate ? (
        <>
          <p className="text-xs text-muted-foreground">
            Compartilhe uma cópia da proposta para o cliente conferir, baixar e
            responder pelo celular. A aprovação é registrada automaticamente
            após a assinatura.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={
              create.isPending ||
              !(quote.transitions.canSend || quote.transitions.canApprove)
            }
            onClick={() => create.mutate(undefined)}
          >
            <PenLine className="size-4" />
            {create.isPending ? "Preparando link…" : "Gerar link de aprovação"}
          </Button>
        </>
      ) : null}
      <CustomerLinkDialog
        result={create.data ?? null}
        error={create.error}
        pending={create.isPending}
        onClose={create.reset}
      />
    </section>
  );
}
