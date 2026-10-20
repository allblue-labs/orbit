"use client";

/**
 * As marcas e os blocos que todas as telas de relatório repetem.
 *
 * ## Procedência é informação, não decoração
 *
 * `OBSERVED`, `DERIVED`, `PROXY` e `MOCK` aparecem **ao lado do número**, com
 * cor e explicação. Esconder a diferença faria um valor aproximado parecer
 * medido — e é justamente num relatório gerencial, lido para decidir, que essa
 * confusão custa caro.
 *
 * ## Ausência é conteúdo
 *
 * Uma seção sem dados por falta de acesso ou por falta de fonte autoritativa
 * mostra **o motivo publicado pelo backend**, não um vazio. O snapshot já traz
 * o texto; a tela não inventa nem esconde.
 */
import { Info, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  REPORT_PROVENANCE_CLASSES,
  REPORT_PROVENANCE_DESCRIPTIONS,
  REPORT_PROVENANCE_LABELS,
  REPORT_STATUS_CLASSES,
  REPORT_STATUS_LABELS,
  reportDomainLabel,
  type ReportMetric,
  type ReportSection,
  type ReportSource,
  type ReportTable,
} from "@/types/management-reports";

export function ReportStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        REPORT_STATUS_CLASSES[status] ?? "bg-surface-strong text-muted-foreground",
        className,
      )}
    >
      {REPORT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** A procedência de um número, com o que ela significa ao alcance do cursor. */
export function ProvenanceBadge({ provenance }: { provenance: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "border-transparent text-[0.65rem] font-medium",
            REPORT_PROVENANCE_CLASSES[provenance] ??
              "bg-surface-strong text-muted-foreground",
          )}
        >
          {REPORT_PROVENANCE_LABELS[provenance] ?? provenance}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {REPORT_PROVENANCE_DESCRIPTIONS[provenance] ??
          "Procedência de cada número."}
      </TooltipContent>
    </Tooltip>
  );
}

export function DomainBadges({ domains }: { domains: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {domains.map((domain) => (
        <Badge
          key={domain}
          variant="outline"
          className="border-border text-[0.65rem] text-muted-foreground"
        >
          {reportDomainLabel(domain)}
        </Badge>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O snapshot                                                          */
/* ------------------------------------------------------------------ */

/**
 * Um número do relatório.
 *
 * O valor é exibido **como veio** — texto, sempre. Nem `Number()`, nem
 * `toFixed`, nem separador de milhar recalculado: dinheiro é `Decimal` no
 * servidor e quantidade tem três casas, e é ali que a formatação foi decidida.
 */
function MetricCell({ metric }: { metric: ReportMetric }) {
  return (
    <div className="space-y-1 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{metric.label}</p>
        <ProvenanceBadge provenance={metric.provenance} />
      </div>
      <p className="font-mono text-lg">
        {metric.value}
        {metric.unit ? (
          <span className="ml-1 text-xs text-muted-foreground">
            {metric.unit}
          </span>
        ) : null}
      </p>
      {metric.note ? (
        <p className="text-[0.7rem] text-muted-foreground">{metric.note}</p>
      ) : null}
      <p className="text-[0.65rem] text-muted-foreground/70">
        fonte: {metric.source}
      </p>
    </div>
  );
}

function TableBlock({ table }: { table: ReportTable }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{table.title}</p>
        <ProvenanceBadge provenance={table.provenance} />
      </div>

      {table.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Sem registros no período.
        </p>
      ) : (
        /** Tabela larga rola sozinha; a página nunca rola na horizontal. */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-surface-strong/50">
              <tr>
                {table.columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "px-3 py-2 text-xs font-medium text-muted-foreground",
                      column.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {table.columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-3 py-2",
                        column.align === "right"
                          ? "text-right font-mono"
                          : "text-left",
                      )}
                    >
                      {row[column.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {table.note ? (
        <p className="text-xs text-muted-foreground">{table.note}</p>
      ) : null}
    </div>
  );
}

export function SectionBlock({ section }: { section: ReportSection }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{section.title}</h3>
        {section.description ? (
          <p className="text-xs text-muted-foreground">{section.description}</p>
        ) : null}
      </div>

      {/*
        A ausência declarada pelo servidor, com o motivo dele.

        Dois motivos possíveis, e os dois precisam ser lidos: o ator não tem
        acesso àquele domínio, ou não existe fonte autoritativa para aquele
        número. Nenhum dos dois é "zero".
      */}
      {section.unavailableReason ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-muted-foreground">
            {section.unavailableReason}
          </p>
        </div>
      ) : null}

      {section.metrics.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {section.metrics.map((metric) => (
            <MetricCell key={metric.id} metric={metric} />
          ))}
        </div>
      ) : null}

      {section.tables.map((table) => (
        <TableBlock key={table.id} table={table} />
      ))}
    </section>
  );
}

/**
 * As fontes do relatório — inclusive as que **não** entraram.
 *
 * É a parte que responde "por que este número não está aqui?". O backend
 * publica cada fonte com `included` e o motivo; a tela mostra as duas listas
 * lado a lado em vez de omitir a segunda.
 */
export function SourcesPanel({ sources }: { sources: readonly ReportSource[] }) {
  const included = sources.filter((source) => source.included);
  const excluded = sources.filter((source) => !source.included);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase">
          Fontes usadas
        </p>
        <ul className="space-y-1">
          {included.map((source) => (
            <li
              key={`${source.domain}-${source.source}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="text-muted-foreground">
                {reportDomainLabel(source.domain)}
              </span>
              <span className="font-mono text-xs">{source.source}</span>
              <ProvenanceBadge provenance={source.provenance} />
            </li>
          ))}
        </ul>
      </div>

      {excluded.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">
            Fontes deixadas de fora
          </p>
          <ul className="space-y-2">
            {excluded.map((source) => (
              <li
                key={`${source.domain}-${source.source}`}
                className="flex items-start gap-2 rounded-lg border border-border px-3 py-2"
              >
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    {reportDomainLabel(source.domain)}
                    <ProvenanceBadge provenance={source.provenance} />
                  </p>
                  {source.reason ? (
                    <p className="text-xs text-muted-foreground">
                      {source.reason}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
