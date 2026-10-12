"use client";

/**
 * O histórico — a lista do que já foi perguntado.
 *
 * Filtro, contagem e paginação são **do servidor**. A linha mostra o tipo, o
 * período analisado, a unidade, quem gerou, quando, a situação e o formato:
 * é o suficiente para achar um relatório entre dezenas sem abrir nenhum.
 *
 * ## Período analisado ≠ data da geração
 *
 * São duas datas diferentes e as duas aparecem, porque a confusão entre elas é
 * a mais fácil de fazer aqui: um relatório de **março** pode ter sido gerado
 * em **setembro**, e o filtro por data recorta a geração — é o que o contrato
 * publica.
 */
import { useState } from "react";
import { ArrowRight, RotateCw } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useManagementReports } from "@/hooks/management-reports/use-management-reports";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type {
  ManagementReportQuery,
  ManagementReportSummary,
  ReportCatalog,
} from "@/types/management-reports";
import { isInFlight } from "@/types/management-reports";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  useListController,
} from "@/workspace";
import { useActiveScope } from "@/providers/use-active-scope";
import { ReportStatusBadge } from "./report-presentation";

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Na fila" },
  { value: "GENERATING", label: "Compondo" },
  { value: "READY", label: "Pronto" },
  { value: "FAILED", label: "Falhou" },
];

export function ReportHistory({
  catalog,
  onOpen,
  onRepeat,
}: {
  /** Ausente quando o catálogo falhou: a lista continua funcionando. */
  catalog: ReportCatalog | undefined;
  onOpen: (report: ManagementReportSummary) => void;
  onRepeat?: (report: ManagementReportSummary) => void;
}) {
  const scope = useActiveScope();
  const list = useListController<ManagementReportQuery>({ limit: 20 });
  const reports = useManagementReports(list.query);

  /** Enquanto algo está sendo composto, a lista se atualiza sozinha. */
  const [manualRefresh, setManualRefresh] = useState(0);

  return (
    <PanelFrame
      panelId="reports-history"
      title="Histórico"
      description="Cada linha é uma pergunta feita ao sistema, com a resposta congelada."
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setManualRefresh((value) => value + 1);
            void reports.refetch();
          }}
          disabled={reports.isFetching}
          aria-label="Atualizar"
        >
          <RotateCw className="size-4" />
          Atualizar
        </Button>
      }
    >
      <div className="space-y-4" data-refresh={manualRefresh}>
        <FilterBar onClear={list.reset} canClear={list.isFiltered}>
          <FilterSelect
            id="report-type-filter"
            label="Tipo"
            value={list.query.type}
            onChange={(value) => list.setFilter("type", value)}
            options={(catalog?.types ?? []).map((type) => ({
              value: type.type,
              label: type.name,
            }))}
          />
          <FilterSelect
            id="report-status-filter"
            label="Situação"
            value={list.query.status}
            onChange={(value) => list.setFilter("status", value)}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            id="report-unit-filter"
            label="Organização"
            value={list.query.businessUnitId}
            onChange={(value) => list.setFilter("businessUnitId", value)}
            options={scope.businessUnits.map((unit) => ({
              value: unit.id,
              label: unit.tradeName ?? unit.legalName,
            }))}
          />
        </FilterBar>

        <ResultSummary
          meta={reports.data?.meta}
          noun="relatório"
          note="Contagem total de relatórios."
        />

        <ListState
          isPending={reports.isPending}
          error={reports.error}
          onRetry={() => void reports.refetch()}
          items={reports.data?.data ?? []}
          empty={{
            title: list.isFiltered
              ? "Nenhum relatório neste recorte"
              : "Nenhum relatório gerado ainda",
            description: list.isFiltered
              ? "Ajuste os filtros para ver outros."
              : "Um relatório gerencial congela os números de um período — o dashboard mostra agora, o relatório mostra março.",
          }}
        >
          {(items) => (
            <ul className="space-y-2">
              {items.map((report) => (
                <HistoryRow
                  key={report.id}
                  report={report}
                  onOpen={() => onOpen(report)}
                  onRepeat={onRepeat ? () => onRepeat(report) : undefined}
                />
              ))}
            </ul>
          )}
        </ListState>

        <Pagination
          meta={reports.data?.meta}
          onPrevious={list.previousPage}
          onNext={list.nextPage}
          isFetching={reports.isFetching}
        />
      </div>
    </PanelFrame>
  );
}

function HistoryRow({
  report,
  onOpen,
  onRepeat,
}: {
  report: ManagementReportSummary;
  onOpen: () => void;
  onRepeat?: () => void;
}) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium">{report.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Período analisado: {formatDate(report.period.from)} a{" "}
            {formatDate(report.period.to)} · {report.period.timezone}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ReportStatusBadge status={report.status} />
            <Badge
              variant="outline"
              className="border-border text-muted-foreground"
            >
              {report.businessUnit?.name ?? "Toda a organização"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border text-muted-foreground"
            >
              {report.format}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {report.generatedAt
                ? `gerado em ${formatDateTime(report.generatedAt)}`
                : `solicitado em ${formatDateTime(report.createdAt)}`}{" "}
              por {report.generatedBy.displayName}
            </span>
          </div>
          {report.error ? (
            <p className="mt-2 text-xs text-destructive">{report.error}</p>
          ) : null}
        </button>

        <div className="flex items-center gap-2">
          {onRepeat && !isInFlight(report.status) ? (
            <Button variant="ghost" size="sm" onClick={onRepeat}>
              <RotateCw className="size-4" />
              Gerar de novo
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onOpen}>
            Abrir
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}
