"use client";

/**
 * As visitas previstas de uma configuração.
 *
 * ## Número vem do servidor
 *
 * `sequence` já chega formatado (`001`, `002`…) e `sequenceNumber` é o valor
 * canônico. A tela nunca usa a posição na lista: uma visita cancelada continua
 * ocupando o seu número, e renumerar pela posição faria a segunda linha dizer
 * "002" quando o servidor diz "003".
 *
 * ## Ocorrência não é execução
 *
 * Uma visita prevista existe sem execução — é o estado normal de tudo que
 * ainda vai acontecer. A coluna de execução mostra o vazio como vazio, sem
 * inventar uma execução em branco para preencher a tabela.
 *
 * ## O Web não inicia visita
 *
 * Não há "Iniciar visita" aqui. `POST /occurrences/:id/start` exige
 * `rvt.execute` e existe para o técnico diante do equipamento; um botão no
 * navegador criaria visita que ninguém fez. É a mesma regra do PMOC.
 */
import { CalendarClock, ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import type { RvtOccurrence } from "@/types/rvt";
import { ListState } from "@/workspace";
import { DueStateBadge, OccurrenceStatusBadge } from "./rvt-presentation";

export function RvtOccurrencesPanel({
  occurrences,
}: {
  occurrences: readonly RvtOccurrence[];
}) {
  return (
    <ListState
      isPending={false}
      error={null}
      items={occurrences}
      empty={{
        icon: <CalendarClock className="size-5" />,
        title: "Nenhuma visita prevista",
        description:
          "As visitas são geradas a partir da periodicidade e da vigência configuradas.",
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
                    {occurrence.executionId ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          href={`${ROUTES.rvt}/execucoes/${occurrence.executionId}`}
                        >
                          Abrir visita
                          <ExternalLink className="size-3.5" />
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
  );
}
