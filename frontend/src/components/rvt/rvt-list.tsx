"use client";

/**
 * A lista de **configurações** de RVT.
 *
 * Cada linha é a regra de uma visita técnica — não uma visita, não uma
 * execução. O que se lê aqui é: para quem, onde, com que periodicidade, e
 * qual a próxima visita prevista.
 *
 * ## A próxima visita vem da lista de ocorrências
 *
 * O Read Model da configuração traz as ocorrências que o servidor gerou, já
 * ordenadas por ele. "Próxima" é a primeira ainda prevista — uma escolha
 * dentro do que veio, não um cálculo de calendário. Nada aqui soma semanas ou
 * meses: quem gera a agenda é o backend.
 */
import { Plus, Route } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRvtConfigurations } from "@/hooks/rvt/use-rvt";
import { formatDate } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import { CONFIGURATION_STATUS, isOneTime, recurrenceLabel } from "@/registry";
import type { RvtConfiguration } from "@/types/rvt";
import { FilterBar, FilterSelect, ListState } from "@/workspace";
import { ConfigurationStatusBadge, DueStateBadge } from "./rvt-presentation";

const STATUS_OPTIONS = Object.entries(CONFIGURATION_STATUS).map(
  ([value, entry]) => ({ value, label: entry.label }),
);

/**
 * A próxima visita prevista, entre as que o servidor devolveu.
 *
 * `SCHEDULED` é o estado de quem ainda não foi visitado; a ordem é a do
 * backend, então a primeira encontrada é a próxima. Comparar datas com o
 * relógio do navegador daria respostas diferentes conforme o fuso de quem
 * abriu a tela.
 */
function nextOccurrence(configuration: RvtConfiguration) {
  return (
    configuration.occurrences.find((item) => item.status === "SCHEDULED") ??
    null
  );
}

export function RvtList({ onCreate }: { onCreate: () => void }) {
  const session = useSession();
  const canManage = session.hasPermission("rvt.manage");
  /**
   * Filtro em estado local, não no `useListController`.
   *
   * O controller emite `page` — e `RvtConfigurationQueryDto` estende
   * `CursorDto`, que recusa paginação por página. Passar a consulta inteira
   * fazia o backend responder `property page should not exist`. O contrato
   * aqui é cursor, e a tela oferece exatamente o filtro que ele aceita.
   */
  const [status, setStatus] = useState("");
  const query = useMemo(() => (status ? { status } : {}), [status]);
  const configurations = useRvtConfigurations(query);

  return (
    <div className="space-y-4">
      {/**
       * Sem campo de busca.
       *
       * `RvtConfigurationQueryDto` aceita unidade, cliente e situação — não
       * aceita texto. Uma caixa de busca que o servidor ignora é pior que
       * nenhuma: promete um recurso e devolve a lista inteira.
       */}
      <FilterBar>
        <FilterSelect
          id="rvt-status"
          label="Situação"
          value={status}
          onChange={(value) => setStatus(value ?? "")}
          options={STATUS_OPTIONS}
        />
        <Button variant="ghost" size="sm" onClick={() => setStatus("")}>
          Limpar
        </Button>
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Ordenado pelas mais recentes.
        </p>
        {canManage ? (
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-3.5" />
            Nova visita técnica
          </Button>
        ) : null}
      </div>

      <ListState
        isPending={configurations.isPending}
        error={configurations.error}
        onRetry={() => void configurations.refetch()}
        items={configurations.data?.data ?? []}
        empty={{
          icon: <Route className="size-5" />,
          title: "Nenhuma visita técnica configurada",
          description:
            "Uma configuração de RVT define o cliente, o local, a periodicidade e o procedimento das visitas técnicas.",
          action: canManage ? (
            <Button size="sm" onClick={onCreate}>
              <Plus className="size-3.5" />
              Nova visita técnica
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visita</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead>Próxima visita</TableHead>
                  <TableHead>Equipamentos</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((configuration) => {
                  const next = nextOccurrence(configuration);
                  return (
                    <TableRow key={configuration.id}>
                      <TableCell>
                        <Link
                          href={`${ROUTES.rvt}/${configuration.id}`}
                          className="block max-w-[16rem] truncate font-medium hover:underline"
                        >
                          {configuration.name}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">
                          {configuration.code}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[13rem] truncate">
                        {configuration.customer.name}
                      </TableCell>
                      <TableCell className="max-w-[11rem] truncate text-sm text-muted-foreground">
                        {configuration.businessUnit.name}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {recurrenceLabel(configuration)}
                          {/**
                           * "Visita avulsa" é derivado de `ONE_TIME`, o modo de
                           * agenda que o servidor publica — não é um estado
                           * inventado para os RVTs que nasceram no celular.
                           */}
                          {isOneTime(configuration) ? (
                            <Badge
                              variant="secondary"
                              className="border-none bg-surface-strong text-[10px] text-muted-foreground"
                            >
                              Visita avulsa
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {next ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="tabular-nums">
                              {formatDate(next.localScheduledDate)}
                            </span>
                            <DueStateBadge state={next.dueState} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Nenhuma prevista
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {configuration.equipment.length}
                      </TableCell>
                      <TableCell>
                        <ConfigurationStatusBadge
                          status={configuration.status}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>
    </div>
  );
}
