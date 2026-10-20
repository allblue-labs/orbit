"use client";

/**
 * Histórico da proposta.
 *
 * ## O que existe, e o que não existe
 *
 * `QuoteReadModel` publica **carimbos**: criação, envio, decisão, expiração,
 * cancelamento e conversão — cada um com data e, quando o contrato o traz,
 * autor. É isso que a linha do tempo mostra.
 *
 * **Não existe um endpoint de histórico de orçamento.** O backend grava
 * `AuditLog` para cada transição (`QUOTE_SENT`, `QUOTE_APPROVED`,
 * `QUOTE_ITEM_ADDED`…), mas nenhuma rota o publica para o tenant — a mesma
 * ausência já declarada em Clientes e Equipamentos. Então esta seção mostra o
 * que o próprio orçamento carrega, e diz o que falta, em vez de reconstruir
 * eventos que ninguém publicou.
 */
import { PanelFrame } from "@/components/panels";
import { formatDateTime } from "@/lib/formatters";
import type { Quote } from "@/types/quotes";

interface Moment {
  label: string;
  at: string;
  by?: string | null;
  detail?: string | null;
  tone?: "neutral" | "positive" | "warning" | "negative";
}

export function QuoteTimeline({ quote }: { quote: Quote }) {
  const moments: Moment[] = [
    {
      label: "Criada",
      at: quote.createdAt,
      by: quote.createdBy.displayName,
    },
  ];

  if (quote.sentAt) {
    moments.push({
      label: "Enviada ao cliente",
      at: quote.sentAt,
      by: quote.sentBy?.displayName,
    });
  }

  if (quote.decidedAt) {
    const approved = quote.status === "APPROVED";
    moments.push({
      label: approved ? "Aprovada pelo cliente" : "Recusada pelo cliente",
      at: quote.decidedAt,
      by: quote.decidedBy?.displayName,
      detail: approved ? null : quote.closingReason,
      tone: approved ? "positive" : "negative",
    });
  }

  if (quote.expiredAt) {
    moments.push({
      label: "Expirada",
      at: quote.expiredAt,
      detail: "A validade passou antes de haver decisão.",
      tone: "warning",
    });
  }

  if (quote.cancelledAt) {
    moments.push({
      label: "Cancelada",
      at: quote.cancelledAt,
      detail: quote.closingReason,
      tone: "negative",
    });
  }

  if (quote.convertedAt) {
    moments.push({
      label: "Convertida em operação",
      at: quote.convertedAt,
      detail: quote.operation?.code,
      tone: "positive",
    });
  }

  const ordered = [...moments].sort((left, right) =>
    left.at.localeCompare(right.at),
  );

  return (
    <PanelFrame
      panelId="quote-timeline"
      title="Histórico"
      description="Os carimbos que a proposta carrega"
    >
      <div className="space-y-4">
        <ol className="space-y-3">
          {ordered.map((moment) => (
            <li key={`${moment.label}-${moment.at}`} className="flex gap-3">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[moment.tone ?? "neutral"]}`}
                aria-hidden
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{moment.label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(moment.at)}
                  {moment.by ? ` · ${moment.by}` : ""}
                </p>
                {moment.detail ? (
                  <p className="text-xs text-muted-foreground">
                    {moment.detail}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Alterações de itens ficam registradas, mas essa auditoria ainda não pode ser consultada aqui — a mesma ausência de Clientes e
          Equipamentos. Nada é reconstruído aqui.
        </p>
      </div>
    </PanelFrame>
  );
}

const TONE: Readonly<Record<string, string>> = {
  neutral: "bg-muted-foreground",
  positive: "bg-emerald-400",
  warning: "bg-orange-400",
  negative: "bg-rose-400",
};
