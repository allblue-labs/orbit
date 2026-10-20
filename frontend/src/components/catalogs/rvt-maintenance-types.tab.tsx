"use client";

/**
 * Tipos de manutenção de RVT.
 *
 * ## O que este catálogo substitui
 *
 * O ritmo de uma visita técnica era um literal de dois valores gravado na
 * configuração — semanal ou semestral, e nada mais. Quem precisasse de
 * trimestral não tinha onde dizer isso. Agora a organização cadastra os seus
 * ritmos, e cada um carrega **a cadência** que gera as ocorrências e **o
 * roteiro** que o técnico preenche na visita.
 *
 * ## Cadência é dia ou mês, nunca os dois
 *
 * Trimestral não é "90 dias": três meses civis variam de 89 a 92 conforme a
 * data de partida, e um contrato que começa em 31/01 vence em 30/04 e 31/07 —
 * não em 01/05 e 30/07. A regra é do servidor (`assertCadence`); o formulário
 * a espelha só para não enviar o que já se sabe recusado.
 *
 * ## O que o roteiro alcança
 *
 * O roteiro vale para as visitas **daqui em diante**. As já executadas guardam
 * uma cópia do checklist que preencheram — trocar o roteiro do tipo não
 * reescreve relatório nenhum já emitido.
 */
import { useMemo, useState } from "react";
import { CalendarClock, ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useRemoveRvtMaintenanceType,
  useRvtMaintenanceTypes,
} from "@/hooks/rvt/use-rvt";
import { cadenciaDe } from "@/registry";
import type { RvtMaintenanceType } from "@/types/rvt";
import { ListState } from "@/workspace";
import { RvtMaintenanceTypeFormDialog } from "./rvt-maintenance-type-form.dialog";

export function RvtMaintenanceTypesTab() {
  const tipos = useRvtMaintenanceTypes();
  const remove = useRemoveRvtMaintenanceType();

  const [editando, setEditando] = useState<RvtMaintenanceType | "new" | null>(
    null,
  );
  const [removendo, setRemovendo] = useState<RvtMaintenanceType | null>(null);

  const linhas = useMemo(() => tipos.data ?? [], [tipos.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Tipos de manutenção</p>
          <p className="text-sm text-muted-foreground">
            O ritmo de cada contrato de visita técnica e o roteiro que o técnico
            preenche na visita.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditando("new")}>
          <Plus className="size-3.5" />
          Novo tipo
        </Button>
      </div>

      <ListState
        isPending={tipos.isPending}
        error={tipos.error}
        onRetry={() => void tipos.refetch()}
        items={linhas}
        empty={{
          icon: <CalendarClock className="size-5" />,
          title: "Nenhum tipo cadastrado",
          description:
            "Cadastre os ritmos que sua operação contrata — mensal, trimestral, semestral.",
          action: (
            <Button size="sm" onClick={() => setEditando("new")}>
              <Plus className="size-3.5" />
              Novo tipo
            </Button>
          ),
        }}
      >
        {(itens) => (
          <ul className="space-y-2">
            {itens.map((tipo) => (
              <li
                key={tipo.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <CalendarClock
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {tipo.label}
                    <Badge variant="outline" className="text-[10px]">
                      {cadenciaDe(tipo)}
                    </Badge>
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {/*
                      Sem roteiro o tipo continua válido — ele agenda visitas do
                      mesmo jeito. O que falta é o que o técnico confere, e isso
                      se diz, em vez de deixar a linha em branco.
                    */}
                    <ClipboardList className="size-3" aria-hidden />
                    {tipo.checklist
                      ? `${tipo.checklist.name} · versão ${tipo.checklist.version}`
                      : "Sem roteiro — a visita não tem checagens a preencher"}
                  </p>
                </div>

                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setEditando(tipo)}
                  aria-label={`Editar ${tipo.label}`}
                >
                  <Pencil className="size-4" />
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-destructive"
                  disabled={remove.isPending}
                  onClick={() => setRemovendo(tipo)}
                  aria-label={`Remover ${tipo.label}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ListState>

      <MutationError error={remove.error} />

      <RvtMaintenanceTypeFormDialog
        tipo={editando === "new" ? null : editando}
        open={editando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setEditando(null);
        }}
      />

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setRemovendo(null);
        }}
        title="Remover tipo de manutenção"
        body={
          removendo
            ? `"${removendo.label}" sai da lista dos contratos novos. Se algum contrato ainda usa este tipo, troque o tipo desses contratos antes de removê-lo.`
            : undefined
        }
        confirmLabel="Remover"
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (removendo) remove.mutate(removendo.id);
          setRemovendo(null);
        }}
      />
    </div>
  );
}
