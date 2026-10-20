"use client";

/**
 * As visitas de toda a operação, não as de uma configuração.
 *
 * É a leitura de quem abre o sistema para saber o que há pela frente:
 * `GET /rvt/occurrences` atravessa as configurações e a unidade ativa recorta.
 *
 * O filtro de situação é o do backend. "Atrasada" e "Hoje" vêm de `dueState`,
 * decidido no fuso da configuração — comparar datas aqui daria respostas
 * diferentes para duas pessoas em fusos diferentes olhando a mesma visita.
 */
import { CalendarClock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRvtOccurrences } from "@/hooks/rvt/use-rvt";
import { formatDate } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { OCCURRENCE_STATUS } from "@/registry";
import { FilterBar, FilterSelect, ListState } from "@/workspace";
import { DueStateBadge, OccurrenceStatusBadge } from "./rvt-presentation";

const STATUS_OPTIONS = Object.entries(OCCURRENCE_STATUS).map(
  ([value, entry]) => ({ value, label: entry.label }),
);

export function RvtUpcomingPanel() {
  /** Cursor, como a configuração: `page` não existe neste contrato. */
  const [status, setStatus] = useState("");
  const query = useMemo(() => (status ? { status } : {}), [status]);
  const occurrences = useRvtOccurrences(query);

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterSelect
          id="rvt-occurrence-status"
          label="Situação"
          value={status}
          onChange={(value) => setStatus(value ?? "")}
          options={STATUS_OPTIONS}
        />
        <Button variant="ghost" size="sm" onClick={() => setStatus("")}>
          Limpar
        </Button>
      </FilterBar>

      <ListState
        isPending={occurrences.isPending}
        error={occurrences.error}
        onRetry={() => void occurrences.refetch()}
        items={occurrences.data?.data ?? []}
        empty={{
          icon: <CalendarClock className="size-5" />,
          title: "Nenhuma visita disponível",
          description:
            "As visitas aparecem aqui conforme as configurações de RVT as geram.",
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Visita</TableHead>
                  <TableHead>Data prevista</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Configuração</TableHead>
                  <TableHead>Execução</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((occurrence) => (
                  <TableRow key={occurrence.id}>
                    <TableCell className="font-mono text-sm tabular-nums">
                      {occurrence.sequence}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm tabular-nums">
                          {formatDate(occurrence.localScheduledDate)}
                        </span>
                        <DueStateBadge state={occurrence.dueState} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <OccurrenceStatusBadge status={occurrence.status} />
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          href={`${ROUTES.rvt}/${occurrence.configurationId}`}
                        >
                          Abrir configuração
                          <ExternalLink className="size-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                    <TableCell>
                      {occurrence.executionId ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`${ROUTES.rvt}/execucoes/${occurrence.executionId}`}
                          >
                            Abrir visita
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Não iniciada
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>
    </div>
  );
}
