"use client";

/**
 * As execuções de um plano, e os equipamentos de cada uma.
 *
 * ## "Execução", e não "ciclo"
 *
 * O modelo do servidor sempre se chamou `PmocExecution`; "ciclo" era nome
 * só desta tela, e a divergência obrigava quem lê o código a traduzir duas
 * vezes. Ficou o nome do domínio.
 *
 * ## Execução do plano não é ordem de serviço
 *
 * É uma **competência**: a janela com vencimento em que a manutenção daquele
 * período deve acontecer. Não tem status de OS, não tem responsável único, e
 * **não gera documento** — quem gera é cada equipamento executado, no nível
 * de baixo (`PmocEquipmentExecution`).
 *
 * ## O progresso vem do que o servidor devolve
 *
 * "3 de 8 concluídos" é contado sobre a lista de equipamentos que o backend
 * publica para a execução — uma consulta, não uma por equipamento. A execução
 * não publica um campo de progresso, e inventar um exigiria carregar tudo de
 * qualquer forma; contar o que já está em mãos é honesto e não custa
 * requisição nenhuma.
 */
import { useState } from "react";
import { CalendarClock, Package, Play } from "lucide-react";

import {
  CycleStatusBadge,
  DocumentStatusBadge,
  ExecutionStatusBadge,
} from "@/components/pmoc/pmoc-presentation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  usePmocCycles,
  usePmocEquipmentExecutions,
} from "@/hooks/pmoc/use-pmoc";
import { PmocAttendanceDialog } from "./attendance/attendance.dialog";
import { useSession } from "@/providers/session-provider";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { executionBlockedLabel, knownBlockedReason } from "@/registry";
import type { PmocCycle, PmocCycleEquipmentRow } from "@/types/pmoc";
import { ListState } from "@/workspace";

export function PmocCyclesPanel({ planId }: { planId: string }) {
  const cycles = usePmocCycles(planId);
  const [selected, setSelected] = useState<string | null>(null);

  const current = selected ?? cycles.data?.[0]?.id ?? null;

  return (
    <div className="space-y-4">
      <ListState
        isPending={cycles.isPending}
        error={cycles.error}
        onRetry={() => void cycles.refetch()}
        items={cycles.data ?? []}
        empty={{
          icon: <CalendarClock className="size-5" />,
          title: "Nenhuma execução disponível",
          description:
            "As execuções são abertas quando o plano é ativado, seguindo a periodicidade contratada.",
        }}
      >
        {(rows) => (
          <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
            <CycleList
              cycles={rows}
              selectedId={current}
              onSelect={setSelected}
            />
            {current ? (
              <EquipmentExecutions planId={planId} cycleId={current} />
            ) : null}
          </div>
        )}
      </ListState>
    </div>
  );
}

function CycleList({
  cycles,
  selectedId,
  onSelect,
}: {
  cycles: readonly PmocCycle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-2" aria-label="Execuções do plano">
      {cycles.map((cycle) => (
        <li key={cycle.id}>
          <button
            type="button"
            onClick={() => onSelect(cycle.id)}
            aria-current={cycle.id === selectedId ? "true" : undefined}
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
              cycle.id === selectedId
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:bg-surface-strong",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                Execução {cycle.sequenceNumber}
              </span>
              <CycleStatusBadge status={cycle.status} />
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {/** `dueOn` é data civil — exibida como o servidor a resolveu. */}
              Vencimento {formatDate(cycle.dueOn)}
            </span>
            {cycle.performedAt ? (
              <span className="block text-xs text-muted-foreground">
                Cumprido em {formatDate(cycle.performedAt)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EquipmentExecutions({
  planId,
  cycleId,
}: {
  planId: string;
  cycleId: string;
}) {
  const rows = usePmocEquipmentExecutions(planId, cycleId);
  const items = rows.data ?? [];
  const done = items.filter((row) => row.status === "COMPLETED").length;
  /** Qual equipamento está sendo atendido agora. `null` fecha o diálogo. */
  const [attending, setAttending] = useState<string | null>(null);

  return (
    <section className="space-y-3" aria-label="Equipamentos desta execução">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Equipamentos desta execução</h3>
        {items.length > 0 ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {done} de {items.length} equipamentos concluídos
          </p>
        ) : null}
      </div>

      <ListState
        isPending={rows.isPending}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        items={items}
        empty={{
          icon: <Package className="size-5" />,
          title: "Nenhum equipamento nesta execução",
          description:
            "A execução abrange os equipamentos cobertos pelo plano no momento em que foi aberta.",
        }}
      >
        {(equipment) => (
          <ul className="space-y-3">
            {equipment.map((row) => (
              <EquipmentRow
                key={row.coverageId}
                row={row}
                onAttend={() => setAttending(row.equipment.id)}
              />
            ))}
          </ul>
        )}
      </ListState>

      <PmocAttendanceDialog
        planId={planId}
        cycleId={cycleId}
        assetId={attending}
        open={attending !== null}
        onOpenChange={(open) => !open && setAttending(null)}
      />
    </section>
  );
}

/**
 * Um equipamento da execução — atendido ou não.
 *
 * Quando há execução, mostra quem fez, quando, com quantas evidências e qual
 * documento. Quando não há, mostra o que o servidor respondeu na própria
 * linha: pronto para execução, ou o motivo do bloqueio.
 *
 * A disponibilidade vinha de uma consulta de preparação **por linha** — vinte
 * equipamentos, vinte requisições, só para escrever uma frase em cada. Agora
 * ela chega na mesma resposta que traz a lista, calculada pela mesma regra do
 * domínio. A preparação continua existindo onde decide algo: no momento de
 * iniciar a execução.
 */
function EquipmentRow({
  row,
  onAttend,
}: {
  row: PmocCycleEquipmentRow;
  onAttend: () => void;
}) {
  const eligibility = row.eligibility;
  const session = useSession();

  /*
   * O portão espelha o que o servidor exige para abrir a execução.
   *
   * A rota pede `pmoc.manage` **e** `operations.create` — ela cria a ordem de
   * serviço 1:1 do atendimento. Exigir menos ofereceria um botão cujo destino é
   * uma recusa; exigir mais esconderia o botão de quem o servidor aceitaria, que
   * é o erro mais difícil de descobrir, porque nada aparece.
   */
  const canAttend =
    session.hasPermission("pmoc.manage") &&
    session.hasPermission("operations.create");

  return (
    <li className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.equipment.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.equipment.identifier ??
              row.equipment.serialNumber ??
              row.equipment.category}
          </p>
        </div>
        {row.status === "NOT_STARTED" ? (
          <span className="text-xs text-muted-foreground">Não iniciada</span>
        ) : (
          <ExecutionStatusBadge status={row.status} />
        )}
      </div>

      {row.execution ? (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <p className="min-w-0 truncate">
              <span className="text-muted-foreground">Manutenção: </span>
              <span className="tabular-nums">
                {row.execution.sequenceNumber}
              </span>
            </p>
            <p className="min-w-0 truncate">
              <span className="text-muted-foreground">Técnico em Campo: </span>
              {row.execution.responsibleFieldTechnician.displayName}
            </p>
            {row.execution.auxiliaryTechnicians.length > 0 ? (
              <p className="min-w-0 truncate">
                <span className="text-muted-foreground">
                  auxiliares técnico:{" "}
                </span>
                {row.execution.auxiliaryTechnicians
                  .map((person) => person.displayName)
                  .join(", ")}
              </p>
            ) : null}
            {row.execution.performedAt ? (
              <p>
                <span className="text-muted-foreground">Executado em: </span>
                {formatDateTime(row.execution.performedAt)}
              </p>
            ) : null}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            {/**
             * As evidências vêm dentro da execução deste equipamento — são
             * coleções distintas por linha, então não há como as fotos de uma
             * máquina aparecerem na outra.
             */}
            <span className="text-muted-foreground">
              {row.execution.evidence.length === 0
                ? "Nenhuma evidência registrada"
                : `${row.execution.evidence.length} evidência(s)`}
            </span>

            {/**
             * O documento é **deste** equipamento. Cada máquina executada tem
             * o próprio PMOC; não existe um PDF único da execução.
             */}
            {row.execution.artifactExecution ? (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Documento:</span>
                <DocumentStatusBadge
                  status={row.execution.artifactExecution.status}
                />
                <Button asChild variant="ghost" size="sm">
                  <a href={`/execucoes/${row.execution.artifactExecution.id}`}>
                    Abrir
                  </a>
                </Button>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Documento ainda não emitido
              </span>
            )}

            {/*
             * A porta para uma execução **já aberta**.
             *
             * É o caso mais provável: o técnico começou em campo e o dono fecha na
             * web, ou emite o relatório que ficou pendente. Sem isto, uma execução
             * em andamento não tinha como ser concluída pela página — e um
             * documento não emitido ficava assim para sempre.
             *
             * O mesmo diálogo atende os dois estados, porque é a preparação que
             * decide em qual passo ele abre.
             */}
            {canAttend &&
            (row.status === "IN_PROGRESS" ||
              !row.execution.artifactExecution) ? (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={onAttend}
              >
                <Play className="size-3.5" />
                {row.status === "IN_PROGRESS"
                  ? "Continuar atendimento"
                  : "Emitir relatório"}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {eligibility.ready ? (
            <>
              <span className="text-muted-foreground">
                Pronto para execução.
              </span>
              {/* A porta que faltava: a tela dizia "pronto para execução em
                  campo" e não oferecia como executar. O dono precisava do
                  aplicativo — ou de ninguém, quando o técnico faltou. */}
              {canAttend ? (
                <Button size="sm" onClick={onAttend}>
                  <Play className="size-3.5" />
                  Atender
                </Button>
              ) : null}
            </>
          ) : (
            <ul className="space-y-0.5">
              {eligibility.blockedReasons.map((reason) => (
                <li key={reason} className="text-amber-400">
                  {executionBlockedLabel(reason, knownBlockedReason)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
