"use client";

/**
 * A fila de atribuições esperando autorização.
 *
 * ## Por que esta tela existe
 *
 * A chave que exige autorização já funcionava, e o carimbo individual também — pela
 * tela do atendimento, um por um. Faltava o lugar onde o dono **vê o que está
 * esperando**: com a exigência ligada, cada atendimento atribuído fica invisível para
 * quem vai executar até alguém liberar, e descobrir quais eram exigia abrir a lista
 * de operações e conferir uma por uma.
 *
 * ## Agrupada por técnico, e por dia dentro dele
 *
 * É a ordem em que a decisão acontece: o dono olha a carga de uma pessoa e libera
 * tudo, ou desce um nível e libera só o dia de amanhã. A arrumação e os conjuntos de
 * ids de cada botão vêm de `authorization-queue`, onde são testados — a parte que
 * erra é o agrupamento por dia civil, não o JSX.
 *
 * ## Os botões enviam ids, não critérios
 *
 * "Autorizar todas do Eduardo" manda os ids que esta tela mostrou. Um comando que
 * resolvesse "todas do Eduardo" no servidor liberaria para o campo um atendimento
 * criado entre a tela carregar e o botão ser clicado — e o dono teria autorizado algo
 * que nunca viu.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { queryKeys } from "@/api/query-keys";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { CACHE } from "@/hooks/api/cache-policy";
import { recurringAuthorizationsService } from "@/services/recurring-authorizations.service";
import { CalendarCheck, ShieldCheck, Users } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityLink } from "@/entities/entity-components";
import {
  useAuthorizeOperations,
  useOperationsList,
} from "@/hooks/operations/use-operations";
import { useFieldTechnicians } from "@/hooks/workforce/use-workforce";
import { useActiveScope } from "@/providers/use-active-scope";
import { formatDate } from "@/lib/formatters";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { OperationQuery } from "@/types/operations";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";
import { agruparFila } from "./authorization-queue";

export function AuthorizationQueuePanel({
  timeZone,
  recurring = false,
}: {
  timeZone: string;
  recurring?: boolean;
}) {
  const { formatDateTime } = useDateFormatters();
  const { businessUnitId, businessUnits } = useActiveScope();
  const list = useListController<OperationQuery>({ limit: 50 });
  const authorize = useAuthorizeOperations();

  /**
   * Quem aparece no filtro de técnico.
   *
   * A lista da unidade em contexto, pelo mesmo motivo do formulário de operação: é
   * nela que o atendimento acontece, e oferecer o elenco da organização inteira daria
   * um filtro que não casa com nada.
   */
  const scope = businessUnitId ? { businessUnitId } : undefined;
  const technicians = useFieldTechnicians(scope);

  const query = useMemo<OperationQuery>(
    () => ({
      ...list.query,
      businessUnitId: businessUnitId ?? list.query.businessUnitId,
      pendingAuthorization: true,
      /*
       * Cinquenta por página, e não vinte: a fila é para decidir em lote, e paginar
       * de vinte em vinte faria o botão do técnico autorizar "todas" que são só as
       * desta página — o conjunto certo, com o rótulo errado.
       */
      limit: 50,
    }),
    [list.query, businessUnitId],
  );

  const operations = useOperationsList(query, !recurring);
  const recurringQuery = {
    page: query.page,
    businessUnitId: query.businessUnitId,
    assignedUserId: query.assignedUserId,
    search: query.search,
  };
  const recurringQueue = useApiQuery(
    queryKeys.list("recurring-authorizations", recurringQuery),
    ({ signal }) =>
      recurringAuthorizationsService.list(recurringQuery, { signal }),
    { ...CACHE.live, enabled: recurring },
  );
  const authorizeRecurring = useApiMutation(
    recurringAuthorizationsService.authorize,
    {
      invalidate: [
        queryKeys.module("recurring-authorizations"),
        queryKeys.module("operations"),
        queryKeys.module("pmoc"),
        queryKeys.module("rvt"),
      ],
      notify: "Atendimentos autorizados para o aplicativo.",
    },
  );
  const recurringItems = useMemo(
    () =>
      new Map(
        (recurringQueue.data?.data ?? []).map((item) => [
          `${item.kind}:${item.id}`,
          item,
        ]),
      ),
    [recurringQueue.data],
  );
  const pendentes = recurring ? recurringQueue : operations;
  const itens = useMemo(
    () =>
      recurring
        ? [...recurringItems.entries()].map(([id, item]) => ({ ...item, id }))
        : (operations.data?.data ?? []),
    [recurring, recurringItems, operations.data],
  );
  const meta = pendentes.data?.meta;
  const grupos = useMemo(() => agruparFila(itens, timeZone), [itens, timeZone]);

  /** Qual botão está em voo, para desabilitar só ele. */
  const [enviando, setEnviando] = useState<string | null>(null);

  const autorizar = (chave: string, ids: readonly string[]) => {
    setEnviando(chave);
    if (recurring) {
      authorizeRecurring.mutate(
        ids
          .map((id) => recurringItems.get(id)!)
          .map(({ id, kind, version }) => ({ id, kind, version })),
        { onSettled: () => setEnviando(null) },
      );
    } else authorize.mutate(ids, { onSettled: () => setEnviando(null) });
  };

  return (
    <PanelFrame
      panelId={
        recurring
          ? "recurring-authorization-queue"
          : "operations-authorization-queue"
      }
      title={
        recurring
          ? "Visitas RVT e ciclos PMOC aguardando autorização"
          : "Esperando autorização"
      }
      description={
        recurring
          ? "Libere cada visita ou ciclo atribuído antes de disponibilizá-lo no aplicativo. A autorização do ciclo PMOC abrange seus equipamentos."
          : "Atendimentos atribuídos que ainda não chegaram ao aplicativo de quem vai executar."
      }
    >
      <div className="space-y-5">
        <FilterBar onClear={list.reset} canClear={list.isFiltered}>
          <SearchField
            id={
              recurring
                ? "recurring-authorization-search"
                : "authorization-search"
            }
            value={list.searchTerm}
            onChange={list.setSearchTerm}
            placeholder="Código, título ou descrição"
            hint="A busca convive com o filtro de técnico: as duas condições valem."
          />

          <FilterSelect
            id={
              recurring
                ? "recurring-authorization-technician"
                : "authorization-technician"
            }
            label="Técnico"
            value={list.query.assignedUserId}
            onChange={(value) => list.setFilter("assignedUserId", value)}
            options={(technicians.data ?? []).map((pessoa) => ({
              value: pessoa.id,
              label: pessoa.name,
            }))}
            anyLabel="Todos"
          />

          {businessUnits.length > 1 && !businessUnitId ? (
            <FilterSelect
              id={
                recurring
                  ? "recurring-authorization-unit"
                  : "authorization-unit"
              }
              label="Unidade"
              value={list.query.businessUnitId}
              onChange={(value) => list.setFilter("businessUnitId", value)}
              options={businessUnits.map((unit) => ({
                value: unit.id,
                label: unit.tradeName ?? unit.legalName,
              }))}
              anyLabel="Todas"
            />
          ) : null}
        </FilterBar>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ResultSummary
            meta={meta}
            noun="atendimento"
            note="Atribuídos e sem autorização"
          />
        </div>

        <MutationError
          error={recurring ? authorizeRecurring.error : authorize.error}
        />

        <ListState
          isPending={pendentes.isPending}
          error={pendentes.error}
          onRetry={() => void pendentes.refetch()}
          items={grupos}
          empty={{
            icon: <ShieldCheck className="size-5" />,
            title: list.isFiltered
              ? "Nada pendente com esses filtros"
              : "Nenhuma atribuição esperando",
            description: list.isFiltered
              ? "Ajuste a busca ou o técnico."
              : "Quando você atribuir um atendimento, ele aparece aqui até ser liberado para o aplicativo.",
          }}
        >
          {(linhas) => (
            <div className="space-y-4">
              {linhas.map((grupo) => (
                <section
                  key={grupo.tecnicoId}
                  className="glass-panel space-y-3 rounded-xl p-4"
                >
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="font-medium">{grupo.tecnico}</span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {grupo.total}
                      </Badge>
                    </div>

                    <Button
                      size="sm"
                      disabled={enviando !== null}
                      onClick={() =>
                        autorizar(`tecnico-${grupo.tecnicoId}`, grupo.ids)
                      }
                    >
                      <ShieldCheck className="size-4" />
                      {enviando === `tecnico-${grupo.tecnicoId}`
                        ? "Autorizando…"
                        : `Autorizar todas (${grupo.total})`}
                    </Button>
                  </header>

                  {grupo.dias.map((dia) => (
                    <div
                      key={dia.dia ?? "sem-data"}
                      className="space-y-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CalendarCheck className="size-3.5" aria-hidden />
                          {/* `formatDate` sobre `YYYY-MM-DD` seria lido no fuso de
                              quem olha e voltaria um dia; o dia já veio civil, então
                              só a ordem muda. */}
                          {dia.dia ? diaLegivel(dia.dia) : "Sem data agendada"}
                        </span>

                        {/* O botão do dia só faz sentido havendo mais de um dia: com
                            um só, ele e o do técnico fariam a mesma coisa. */}
                        {grupo.dias.length > 1 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={enviando !== null}
                            onClick={() =>
                              autorizar(
                                `dia-${grupo.tecnicoId}-${dia.dia ?? "sem"}`,
                                dia.ids,
                              )
                            }
                          >
                            {enviando ===
                            `dia-${grupo.tecnicoId}-${dia.dia ?? "sem"}`
                              ? "Autorizando…"
                              : `Autorizar o dia (${dia.ids.length})`}
                          </Button>
                        ) : null}
                      </div>

                      <ul className="space-y-1.5">
                        {dia.itens.map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                              {recurring ? (
                                <>
                                  <Badge variant="outline">
                                    {recurringItems.get(item.id)?.kind}
                                  </Badge>
                                  <Link
                                    className="text-primary hover:underline"
                                    href={`${recurringItems.get(item.id)?.kind === "PMOC" ? ROUTES.pmoc : ROUTES.rvt}/${recurringItems.get(item.id)?.parentId}`}
                                  >
                                    {item.code}
                                  </Link>
                                </>
                              ) : (
                                <EntityLink entity="operation" id={item.id}>
                                  {item.serviceOrderCode ?? item.code}
                                </EntityLink>
                              )}
                              <span className="truncate">{item.title}</span>
                              {item.scheduledStart ? (
                                <span className="text-xs text-muted-foreground">
                                  {/^\d{4}-\d{2}-\d{2}$/.test(
                                    item.scheduledStart,
                                  )
                                    ? diaLegivel(item.scheduledStart)
                                    : formatDateTime(item.scheduledStart)}
                                </span>
                              ) : null}
                            </span>

                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={enviando !== null}
                              onClick={() =>
                                autorizar(`item-${item.id}`, [item.id])
                              }
                            >
                              {enviando === `item-${item.id}`
                                ? "Autorizando…"
                                : "Autorizar"}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </ListState>

        <Pagination
          meta={meta}
          onPrevious={list.previousPage}
          onNext={list.nextPage}
          isFetching={pendentes.isFetching}
        />
      </div>
    </PanelFrame>
  );
}

/**
 * `2026-10-07` como "07 de outubro de 2026".
 *
 * Montado a partir das partes, sem `new Date("2026-10-07")`: essa string é lida como
 * meia-noite UTC e, num fuso negativo, `formatDate` devolveria o dia anterior — o
 * mesmo erro que o agrupamento existe para não cometer.
 */
function diaLegivel(dia: string): string {
  return formatDate(dia, "UTC");
}
