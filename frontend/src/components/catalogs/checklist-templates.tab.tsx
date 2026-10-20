"use client";

/**
 * Roteiros de atendimento.
 *
 * ## Por que esta tela faltava
 *
 * O roteiro que o técnico percorre em campo existia no contrato desde sempre
 * (`ChecklistTemplate`, com CRUD completo) e **nenhuma tela o oferecia**. Os
 * roteiros que existiam tinham entrado por seed ou por chamada direta à API;
 * um dono de organização não tinha como criar o seu, nem corrigir um item
 * errado, nem ver o que a equipe recebe ao abrir um atendimento.
 *
 * ## A ordem dos itens é a ordem do trabalho
 *
 * Por isso subir e descer existem. Um roteiro é uma sequência — purgar antes de
 * desligar, medir antes de purgar — e reordenar por arrastar seria bonito e
 * pior num celular, que é onde metade desta equipe trabalha.
 */
import { useMemo, useState } from "react";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { operationKindLabel } from "@/components/operations/operation-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useChecklistTemplates,
  useRemoveChecklistTemplate,
} from "@/hooks/operations/use-operations";
import type { ChecklistTemplate } from "@/types/operations";
import {
  FilterBar,
  FilterSelect,
  ListState,
  SearchField,
  useListController,
} from "@/workspace";
import { ChecklistTemplateFormDialog } from "./checklist-template-form.dialog";

interface Filtros {
  search?: string;
  operationKind?: string;
}

export function ChecklistTemplatesTab() {
  const list = useListController<Filtros>({ limit: 100 });
  const templates = useChecklistTemplates();
  const remove = useRemoveChecklistTemplate();

  const [editando, setEditando] = useState<ChecklistTemplate | "new" | null>(
    null,
  );
  const [removendo, setRemovendo] = useState<ChecklistTemplate | null>(null);

  const todos = useMemo(() => templates.data?.data ?? [], [templates.data]);

  const filtrados = useMemo(() => {
    const termo = list.query.search?.toLowerCase() ?? "";
    return todos.filter((roteiro) => {
      if (
        list.query.operationKind &&
        roteiro.operationKind !== list.query.operationKind
      ) {
        return false;
      }
      if (!termo) return true;
      return roteiro.name.toLowerCase().includes(termo);
    });
  }, [todos, list.query.operationKind, list.query.search]);

  /** Os tipos que **realmente** aparecem, e não um catálogo inventado. */
  const tipos = useMemo(
    () =>
      [
        ...new Set(
          todos.flatMap((roteiro) =>
            roteiro.operationKind ? [roteiro.operationKind] : [],
          ),
        ),
      ].map((valor) => ({ value: valor, label: operationKindLabel(valor) })),
    [todos],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Roteiros de atendimento</p>
          <p className="text-sm text-muted-foreground">
            O que o técnico percorre em campo. Quem cria o atendimento recebe o
            roteiro do tipo escolhido.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditando("new")}>
          <Plus className="size-3.5" />
          Novo roteiro
        </Button>
      </div>

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id="templates-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Nome do roteiro"
        />
        <FilterSelect
          id="templates-kind"
          label="Tipo de atendimento"
          value={list.query.operationKind}
          onChange={(valor) => list.setFilter("operationKind", valor)}
          options={tipos}
          anyLabel="Todos"
        />
      </FilterBar>

      <ListState
        isPending={templates.isPending}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        items={filtrados}
        empty={{
          icon: <ClipboardList className="size-5" />,
          title: list.isFiltered
            ? "Nenhum roteiro encontrado"
            : "Nenhum roteiro cadastrado",
          description: list.isFiltered
            ? "Ajuste a busca ou o filtro."
            : "Cadastre o que sua equipe confere em cada tipo de atendimento.",
          action: list.isFiltered ? undefined : (
            <Button size="sm" onClick={() => setEditando("new")}>
              <Plus className="size-3.5" />
              Novo roteiro
            </Button>
          ),
        }}
      >
        {(linhas) => (
          <ul className="space-y-2">
            {linhas.map((roteiro) => (
              <li
                key={roteiro.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <ClipboardList
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {roteiro.name}
                    {roteiro.operationKind ? (
                      <Badge variant="outline" className="text-[10px]">
                        {operationKindLabel(roteiro.operationKind)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        qualquer tipo
                      </Badge>
                    )}
                    {roteiro.isActive ? null : (
                      <Badge variant="outline" className="text-[10px]">
                        inativo
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {`${roteiro.items.length} ${
                      roteiro.items.length === 1 ? "item" : "itens"
                    } · versão ${roteiro.version}`}
                    {roteiro.description ? ` · ${roteiro.description}` : ""}
                  </p>
                </div>

                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setEditando(roteiro)}
                  aria-label={`Editar ${roteiro.name}`}
                >
                  <Pencil className="size-4" />
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-destructive"
                  disabled={remove.isPending}
                  onClick={() => setRemovendo(roteiro)}
                  aria-label={`Remover ${roteiro.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ListState>

      <MutationError error={remove.error} />

      <ChecklistTemplateFormDialog
        template={editando === "new" ? null : editando}
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
        title="Remover roteiro"
        body={
          removendo
            ? `"${removendo.name}" sai do catálogo e dos atendimentos novos. Os checklists já preenchidos continuam como estão — eles guardam uma cópia do roteiro.`
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
