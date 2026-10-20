"use client";

/**
 * O checklist do atendimento, no formulário de criação.
 *
 * ## De onde ele vem
 *
 * O dono da organização mantém um modelo por tipo de atendimento
 * (`ChecklistTemplate.operationKind`). Escolher o tipo é o que traz o
 * roteiro — não há seletor de checklist, porque escolher um que não é o do
 * tipo seria contradizer o catálogo.
 *
 * ## Por que os herdados são somente leitura
 *
 * Eles são o padrão da organização. Editá-los aqui só pareceria funcionar:
 * a mudança valeria para este atendimento e o próximo voltaria ao original,
 * sem ninguém entender por quê. Quem quer mudar o padrão muda o modelo.
 *
 * O que se pode fazer é **acrescentar**: um item pedido só para este
 * atendimento entra ao lado dos herdados e vive no snapshot da execução.
 */
import { useState } from "react";
import { ClipboardList, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useChecklistTemplateForKind } from "@/hooks/operations/use-operations";
import type { OperationKind } from "@/types/contracts";
import type { ChecklistItem } from "@/types/operations";

/** Chave de um item acrescentado à mão, estável dentro do formulário. */
function chaveExtra(indice: number): string {
  return `EXTRA_${indice + 1}`;
}

export function OperationChecklistField({
  kind,
  extras,
  onChangeExtras,
  onTemplateChange,
}: {
  kind: OperationKind | null;
  extras: readonly ChecklistItem[];
  onChangeExtras: (items: readonly ChecklistItem[]) => void;
  /** O modelo encontrado, para quem cria saber o que anexar. */
  onTemplateChange: (templateId: string | null) => void;
}) {
  const { template, isPending } = useChecklistTemplateForKind(kind);
  const [rascunho, setRascunho] = useState("");

  /// Avisa quem monta o payload assim que o modelo muda de identidade.
  const idAtual = template?.id ?? null;
  const [ultimoId, setUltimoId] = useState<string | null>(null);
  if (idAtual !== ultimoId) {
    setUltimoId(idAtual);
    onTemplateChange(idAtual);
  }

  if (!kind) return null;

  const acrescentar = () => {
    const label = rascunho.trim();
    if (!label) return;
    onChangeExtras([
      ...extras,
      { key: chaveExtra(extras.length), label, type: "BOOLEAN" },
    ]);
    setRascunho("");
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Checklist do atendimento</p>
        {template ? (
          <Badge variant="outline" className="text-[10px]">
            {template.name}
          </Badge>
        ) : null}
      </div>

      {isPending ? (
        <Skeleton className="h-16 rounded-md" />
      ) : !template ? (
        <p className="text-xs text-muted-foreground">
          Nenhum checklist definido para este tipo de atendimento. Cadastre um
          modelo em Configurações para que ele apareça aqui — o atendimento pode
          ser criado sem checklist.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {template.items.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <span
                  className="size-3.5 shrink-0 rounded-[4px] border border-border"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.required ? (
                  <Badge variant="outline" className="text-[10px]">
                    obrigatório
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            Estes itens vêm do modelo e não se editam aqui — mudá-los valeria só
            para este atendimento. Para mudar o padrão, edite o modelo.
          </p>
        </>
      )}

      {extras.length > 0 ? (
        <ul className="space-y-1.5 border-t border-border pt-3">
          {extras.map((item, indice) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              <span
                className="size-3.5 shrink-0 rounded-[4px] border border-border"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <Badge variant="secondary" className="text-[10px]">
                só neste
              </Badge>
              <button
                type="button"
                aria-label={`Remover ${item.label}`}
                onClick={() =>
                  onChangeExtras(extras.filter((_, i) => i !== indice))
                }
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1.5 border-t border-border pt-3">
        <Label htmlFor="operation-checklist-extra" className="text-xs">
          Acrescentar item só para este atendimento
        </Label>
        <div className="flex gap-2">
          <Input
            id="operation-checklist-extra"
            value={rascunho}
            maxLength={220}
            placeholder="Ex.: conferir vazamento no duto novo"
            onChange={(event) => setRascunho(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                acrescentar();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={acrescentar}
            disabled={!rascunho.trim()}
          >
            <Plus className="size-4" />
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}
