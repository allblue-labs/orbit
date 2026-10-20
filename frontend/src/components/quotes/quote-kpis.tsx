"use client";

/**
 * Indicadores do funil comercial.
 *
 * Cada número é o `meta.total` de uma consulta server-side com `limit: 1` —
 * a mesma técnica do Catálogo e do Execution Center. **Não existe Analytics
 * comercial**: `AnalyticsDomain` cobre operações, PMOC, equipamentos,
 * técnicos, contratos e ambiente.
 *
 * ## O pendente aparece em dois níveis
 *
 * "Aguardando decisão" é o total com o cliente. "Vencendo em 7 dias" é o
 * recorte que diz o que fazer hoje: vinte propostas em aberto não sugerem ação,
 * três vencendo esta semana sugerem. As duas são contagens do servidor —
 * `status=SENT`, a segunda cruzada com `validUntilBefore`.
 *
 * ## Não há indicador de valor, e a ausência é deliberada
 *
 * `/quotes` não publica soma de totais por situação, e somar a página daria o
 * valor da página — um número que muda ao paginar e que ninguém conseguiria
 * explicar. O valor previsto que existe de verdade é o do Financeiro: receita
 * `PENDING`, publicada lá.
 */
import { useQuoteCount } from "@/hooks/quotes/use-quotes";
import { MetricCard } from "@/workspace";

/** Uma semana: o horizonte em que ligar para o cliente ainda muda o desfecho. */
const EXPIRING_WINDOW_DAYS = 7;

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function QuoteKpis() {
  const draft = useQuoteCount({ status: "DRAFT" });
  const sent = useQuoteCount({ status: "SENT" });
  const expiring = useQuoteCount({
    status: "SENT",
    validUntilBefore: inDays(EXPIRING_WINDOW_DAYS),
  });
  const approved = useQuoteCount({ status: "APPROVED" });
  const expired = useQuoteCount({ status: "EXPIRED" });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard
        metricId="quotes.draft.total"
        value={draft.total}
        isPending={draft.isPending}
        failed={draft.failed}
      />
      <MetricCard
        metricId="quotes.sent.total"
        value={sent.total}
        isPending={sent.isPending}
        failed={sent.failed}
        showDescription
      />
      <MetricCard
        metricId="quotes.expiring.total"
        value={expiring.total}
        isPending={expiring.isPending}
        failed={expiring.failed}
        showDescription
      />
      <MetricCard
        metricId="quotes.approved.total"
        value={approved.total}
        isPending={approved.isPending}
        failed={approved.failed}
      />
      <MetricCard
        metricId="quotes.expired.total"
        value={expired.total}
        isPending={expired.isPending}
        failed={expired.failed}
      />
    </div>
  );
}
