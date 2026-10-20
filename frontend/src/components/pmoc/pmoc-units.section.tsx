"use client";

/**
 * O cadastro das unidades de PMOC.
 *
 * ## Por que é uma tela própria, e não um campo do plano
 *
 * As mesmas unidades — condensadora, evaporadora — voltam em todo plano. Se
 * fossem digitadas dentro do assistente, cada plano teria a sua grafia e o
 * relatório de dois clientes do mesmo contrato sairia descrevendo coisas
 * diferentes. Cadastradas uma vez, com o roteiro de cada uma, o assistente só
 * marca as que o plano atende.
 *
 * ## Remover é desativar
 *
 * O servidor faz soft delete: a unidade sai das listas e dos planos novos, e os
 * planos que já a declararam continuam íntegros. Apagar de verdade reescreveria
 * relatórios já emitidos.
 */
import { useState } from "react";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePmocUnits, useRemovePmocUnit } from "@/hooks/pmoc/use-pmoc";
import { PmocUnitFormDialog } from "./pmoc-unit-form.dialog";
import type { PmocUnit } from "@/types/pmoc";

export function PmocUnitsSection() {
  const unidades = usePmocUnits();
  const remove = useRemovePmocUnit();

  /** `null` fechado; `"new"` criando; uma unidade editando. */
  const [editando, setEditando] = useState<PmocUnit | "new" | null>(null);
  const [removendo, setRemovendo] = useState<PmocUnit | null>(null);

  return (
    <PanelFrame
      panelId="pmoc-units"
      title="Unidades atendidas"
      description="As partes do sistema que recebem manutenção, e o roteiro de cada uma"
      actions={
        <Button size="sm" onClick={() => setEditando("new")}>
          <Plus className="size-3.5" />
          Nova unidade
        </Button>
      }
    >
      <div className="space-y-4">
        <PanelState
          query={toPanelQuery(unidades)}
          loadingRows={3}
          isEmpty={(data) => data.length === 0}
          emptyMessage="Nenhuma unidade cadastrada. Cadastre condensadora, evaporadora e as demais que sua operação atende."
        >
          {(data) => (
            <ul className="space-y-2">
              {data.map((unidade) => (
                <li
                  key={unidade.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <ClipboardList
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {unidade.name}
                      {unidade.isActive ? null : (
                        <Badge variant="secondary" className="text-[10px]">
                          inativa
                        </Badge>
                      )}
                    </p>
                    {/*
                      A chave desce para a linha de apoio.
                      É metadado — identifica a unidade no relatório —, e ao
                      lado do nome disputava a leitura com ele, ainda mais
                      quando é derivada e fica longa.
                    */}
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{unidade.key}</span>
                      {" · "}
                      {unidade.checklist
                        ? `Roteiro: ${unidade.checklist.name} · ${
                            unidade.checklist.items.length
                          } ${
                            unidade.checklist.items.length === 1
                              ? "item"
                              : "itens"
                          }`
                        : "Sem roteiro"}
                      {unidade.description ? ` · ${unidade.description}` : ""}
                    </p>
                  </div>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() => setEditando(unidade)}
                    aria-label={`Editar ${unidade.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive"
                    disabled={remove.isPending}
                    onClick={() => setRemovendo(unidade)}
                    aria-label={`Remover ${unidade.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PanelState>

        <MutationError error={remove.error} />

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Unidade é a parte do sistema que recebe manutenção. O equipamento sob
          contrato — a máquina em si — é cadastrado em Equipamentos e escolhido
          na cobertura do plano.
        </p>
      </div>

      <PmocUnitFormDialog
        unit={editando === "new" ? null : editando}
        open={editando !== null}
        onOpenChange={(open) => {
          if (!open) setEditando(null);
        }}
      />

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(open) => {
          if (!open) setRemovendo(null);
        }}
        title="Remover unidade"
        body={
          removendo
            ? `"${removendo.name}" sai das listas e dos planos novos. Os planos que já a declararam continuam como estão.`
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
    </PanelFrame>
  );
}
