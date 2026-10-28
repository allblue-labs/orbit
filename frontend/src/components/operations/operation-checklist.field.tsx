"use client";

import { useState } from "react";
import { ClipboardList, Plus, X } from "lucide-react";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChecklistItem, ChecklistTemplate } from "@/types/operations";
import { operationKindLabel } from "./operation-badges";

export function OperationChecklistField({
  templates,
  selectedIds,
  onChangeSelected,
  extras,
  onChangeExtras,
  isPending,
  error,
  onRetry,
}: {
  templates: readonly ChecklistTemplate[];
  selectedIds: readonly string[];
  onChangeSelected: (ids: string[]) => void;
  extras: readonly ChecklistItem[];
  onChangeExtras: (items: readonly ChecklistItem[]) => void;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const first = templates.find((template) => template.id === selectedIds[0]);
  const available = templates.filter(
    (template) => !selectedIds.includes(template.id),
  );
  const addExtra = () => {
    const label = draft.trim();
    if (!label || !first || extras.length >= 50) return;
    onChangeExtras([
      ...extras,
      { key: `EXTRA_${crypto.randomUUID()}`, label, type: "BOOLEAN" },
    ]);
    setDraft("");
  };
  return (
    <section
      className="space-y-4 rounded-xl border border-border p-4"
      aria-label="Checklists do atendimento"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <ClipboardList className="size-4 text-primary" aria-hidden />
            Checklists do atendimento
          </h3>
          <p className="max-w-lg text-xs text-muted-foreground">
            Os modelos gerais vêm selecionados inicialmente. Você pode
            removê-los, substituir a seleção ou adicionar outros checklists.
          </p>
        </div>
        {selectedIds.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChangeSelected([])}
          >
            Remover todos
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className="space-y-2">
          <MutationError error={error} />
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Tentar carregar checklists
          </Button>
        </div>
      ) : null}
      {isPending ? (
        <Skeleton className="h-20 rounded-lg" />
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="operation-checklist-add">Adicionar checklist</Label>
            <Select
              value=""
              onValueChange={(id) => onChangeSelected([...selectedIds, id])}
              disabled={!available.length || selectedIds.length >= 20}
            >
              <SelectTrigger id="operation-checklist-add">
                <SelectValue
                  placeholder={
                    available.length
                      ? "Escolha um modelo do catálogo"
                      : "Nenhum outro modelo disponível"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {available.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.isGeneral
                      ? " · Geral"
                      : template.operationKind
                        ? ` · ${operationKindLabel(template.operationKind)}`
                        : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!selectedIds.length ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nenhum checklist selecionado. Adicione um modelo acima ou prossiga
              sem checklist.
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Checklists selecionados">
              {selectedIds.map((id) => {
                const template = templates.find((item) => item.id === id);
                return (
                  <li
                    key={id}
                    className="space-y-3 rounded-lg border border-border bg-surface-strong/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium break-words">
                          {template?.name ?? "Checklist indisponível"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {template?.isGeneral ? (
                            <Badge variant="secondary">Geral</Badge>
                          ) : null}
                          {template ? (
                            <span>{template.items.length} item(ns)</span>
                          ) : (
                            <span>
                              Remova este modelo e escolha outro do catálogo.
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={`Remover checklist ${template?.name ?? "indisponível"}`}
                        onClick={() =>
                          onChangeSelected(
                            selectedIds.filter(
                              (selectedId) => selectedId !== id,
                            ),
                          )
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    {template ? (
                      <ul className="max-h-44 space-y-2 overflow-y-auto border-t border-border pt-3">
                        {template.items.map((item) => (
                          <li
                            key={item.key}
                            className="flex items-start gap-2 text-xs text-muted-foreground"
                          >
                            <span
                              className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 break-words">
                              {item.label}
                            </span>
                            {item.required ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 text-[10px]"
                              >
                                obrigatório
                              </Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {!templates.length ? (
            <p className="text-xs text-muted-foreground">
              Cadastre modelos na página Catálogos → Roteiros.
            </p>
          ) : null}
        </>
      )}
      {extras.length ? (
        <ul className="space-y-2 border-t border-border pt-3">
          {extras.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{item.label}</span>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                só neste
              </Badge>
              <Button
                variant="ghost"
                type="button"
                size="icon"
                className="size-6 shrink-0"
                aria-label={`Remover ${item.label}`}
                onClick={() =>
                  onChangeExtras(
                    extras.filter((extra) => extra.key !== item.key),
                  )
                }
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-2 border-t border-border pt-3">
        <Label htmlFor="operation-checklist-extra" className="text-xs">
          Acrescentar item só para este atendimento
        </Label>
        {first ? (
          <p className="text-xs text-muted-foreground">
            Os itens adicionais entram no checklist “{first.name}”. Os modelos
            do catálogo permanecem iguais.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Input
            id="operation-checklist-extra"
            value={draft}
            maxLength={220}
            placeholder="Ex.: conferir vazamento no duto novo"
            disabled={!first}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addExtra();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addExtra}
            disabled={!first || !draft.trim() || extras.length >= 50}
          >
            <Plus className="size-4" />
            Adicionar item
          </Button>
        </div>
      </div>
    </section>
  );
}
