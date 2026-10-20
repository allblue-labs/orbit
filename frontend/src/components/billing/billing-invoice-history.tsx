/** Histórico financeiro reconciliado com o provedor. */
import { ExternalLink, FileDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelFrame } from "@/components/panels";
import { formatDate } from "@/lib/formatters";
import type { BillingInvoice } from "@/types/billing";

const STATUS_LABEL: Readonly<Record<string, string>> = {
  DRAFT: "Rascunho",
  OPEN: "Em aberto",
  PAID: "Paga",
  VOID: "Cancelada",
  UNCOLLECTIBLE: "Não recebida",
  UNKNOWN: "Em processamento",
};

const formatMoney = (amountMinor: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);

export function BillingInvoiceHistory({
  invoices,
}: {
  invoices: readonly BillingInvoice[];
}) {
  return (
    <PanelFrame
      panelId="billing-invoices"
      title="Faturas"
      description="Cobranças confirmadas pelo provedor"
    >
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma fatura emitida até agora.
        </p>
      ) : (
        <ul
          className="divide-y divide-border"
          aria-label="Histórico de faturas"
        >
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {invoice.number ??
                      `Fatura de ${formatDate(invoice.issuedAt)}`}
                  </span>
                  <Badge
                    variant={
                      invoice.status === "PAID" ? "default" : "secondary"
                    }
                  >
                    {STATUS_LABEL[invoice.status] ?? "Em processamento"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(invoice.totalMinor, invoice.currency)} · período
                  de {formatDate(invoice.period.start)} a{" "}
                  {formatDate(invoice.period.end)}
                </p>
                {invoice.status === "OPEN" && invoice.nextPaymentAttemptAt ? (
                  <p className="text-xs text-muted-foreground">
                    Nova tentativa prevista para{" "}
                    {formatDate(invoice.nextPaymentAttemptAt)}
                  </p>
                ) : null}
                {invoice.adjustments.map((adjustment) => (
                  <p
                    key={adjustment.id}
                    className="text-xs text-muted-foreground"
                  >
                    {adjustment.type === "REFUND" ? "Reembolso" : "Disputa"}:{" "}
                    {formatMoney(adjustment.amountMinor, adjustment.currency)} ·{" "}
                    {adjustment.status.toLocaleLowerCase("pt-BR")}
                  </p>
                ))}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {invoice.hostedInvoiceUrl ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      Ver fatura
                    </a>
                  </Button>
                ) : null}
                {invoice.invoicePdfUrl ? (
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={invoice.invoicePdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileDown className="size-4" aria-hidden />
                      PDF
                    </a>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}
