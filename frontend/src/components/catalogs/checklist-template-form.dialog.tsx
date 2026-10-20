"use client";

/**
 * Cadastro de um roteiro de atendimento.
 *
 * ## Por que o tipo de atendimento importa tanto
 *
 * `operationKind` é o que faz o formulário de nova operação **achar** o
 * roteiro: escolher "Manutenção" traz o roteiro de manutenção, sem seletor de
 * checklist. Um roteiro sem tipo serve a qualquer um e não aparece sozinho em
 * lugar nenhum — é uma escolha legítima, e a tela diz o que ela custa.
 *
 * ## A chave não é o nome
 *
 * Ela identifica o roteiro nas execuções já gravadas. O nome pode ser
 * reescrito; a chave, não — e por isso ela é derivada do nome só enquanto
 * ninguém a editou, e some da edição de um roteiro que já existe.
 */
import { useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { operationKindLabel } from "@/components/operations/operation-badges";
import {
  useCreateChecklistTemplate,
  useUpdateChecklistTemplate,
} from "@/hooks/operations/use-operations";
import { OperationKind } from "@/types/contracts";
import {
  CHECKLIST_ITEM_TYPES,
  type ChecklistItem,
  type ChecklistTemplate,
} from "@/types/operations";

/** `Select` não aceita item de valor vazio; este é o "serve a qualquer tipo". */
const QUALQUER_TIPO = "__any__";

/** A chave derivada de um rótulo: maiúsculas, sem acento, sem pontuação. */
function chaveDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function ChecklistTemplateFormDialog({
  template,
  open,
  onOpenChange,
}: {
  /** `null` cria; preenchido edita. */
  template: ChecklistTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* `key` remonta o corpo ao trocar de roteiro. */}
        <Body
          key={template?.id ?? "new"}
          template={template}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  template,
  onOpenChange,
}: {
  template: ChecklistTemplate | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateChecklistTemplate();
  const update = useUpdateChecklistTemplate(template?.id ?? "");
  const mutation = template ? update : create;

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [kind, setKind] = useState<string>(
    template?.operationKind ?? QUALQUER_TIPO,
  );
  const [items, setItems] = useState<ChecklistItem[]>(() => [
    ...(template?.items ?? []),
  ]);
  const [rascunho, setRascunho] = useState("");

  const acrescentar = () => {
    const rotulo = rascunho.trim();
    if (!rotulo) return;
    setItems((atual) => [
      ...atual,
      {
        key: chaveDe(rotulo) || `ITEM_${atual.length + 1}`,
        label: rotulo,
        type: "BOOLEAN",
        required: false,
      },
    ]);
    setRascunho("");
  };

  const alterar = (indice: number, patch: Partial<ChecklistItem>) =>
    setItems((atual) =>
      atual.map((item, posicao) =>
        posicao === indice ? { ...item, ...patch } : item,
      ),
    );

  const remover = (indice: number) =>
    setItems((atual) => atual.filter((_, posicao) => posicao !== indice));

  /** Subir e descer: a ordem do roteiro é a ordem do trabalho em campo. */
  const mover = (indice: number, direcao: -1 | 1) =>
    setItems((atual) => {
      const destino = indice + direcao;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      const [movido] = copia.splice(indice, 1);
      copia.splice(destino, 0, movido!);
      return copia;
    });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      ...(kind === QUALQUER_TIPO
        ? {}
        : { operationKind: kind as CreateKind }),
      items,
    };
    const fechar = () => onOpenChange(false);

    if (template) {
      update.mutate(payload, { onSuccess: fechar });
      return;
    }
    create.mutate({ ...payload, key: chaveDe(name) }, { onSuccess: fechar });
  };

  const incompleto = name.trim().length < 2 || items.length === 0;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{template ? "Editar roteiro" : "Novo roteiro"}</DialogTitle>
        <DialogDescription>
          Os itens que o técnico percorre em campo. Quem cria o atendimento
          recebe este roteiro ao escolher o tipo.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="template-name">Nome</Label>
          <Input
            id="template-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Manutenção preventiva — padrão"
            required
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="template-kind">Tipo de atendimento</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="template-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={QUALQUER_TIPO}>Qualquer tipo</SelectItem>
              {Object.values(OperationKind).map((valor) => (
                <SelectItem key={valor} value={valor}>
                  {operationKindLabel(valor)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {kind === QUALQUER_TIPO
              ? "Sem tipo, o roteiro não aparece sozinho no formulário de atendimento."
              : `Quem escolher "${operationKindLabel(kind)}" recebe este roteiro.`}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="template-description">Descrição</Label>
          <Textarea
            id="template-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="Opcional — quando usar este roteiro"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Itens do roteiro</Label>
          <span className="text-xs text-muted-foreground">
            {items.length === 0
              ? "Nenhum item ainda"
              : `${items.length} item(ns)`}
          </span>
        </div>

        {items.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {items.map((item, indice) => (
              <li
                key={`${item.key}:${indice}`}
                className="flex flex-wrap items-center gap-2 p-2.5"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={indice === 0}
                    onClick={() => mover(indice, -1)}
                    aria-label={`Subir ${item.label}`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={indice === items.length - 1}
                    onClick={() => mover(indice, 1)}
                    aria-label={`Descer ${item.label}`}
                  >
                    ▼
                  </button>
                </div>

                <GripVertical
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />

                <Input
                  value={item.label}
                  onChange={(event) =>
                    alterar(indice, { label: event.target.value })
                  }
                  className="min-w-0 flex-1"
                  aria-label={`Rótulo do item ${indice + 1}`}
                />

                <Select
                  value={item.type}
                  onValueChange={(valor) => alterar(indice, { type: valor })}
                >
                  <SelectTrigger
                    className="w-36"
                    aria-label={`Tipo de resposta de ${item.label}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHECKLIST_ITEM_TYPES.map((tipo) => (
                      <SelectItem key={tipo.value} value={tipo.value}>
                        {tipo.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={item.required === true}
                    onCheckedChange={(marcado) =>
                      alterar(indice, { required: marcado === true })
                    }
                    aria-label={`${item.label} é obrigatório`}
                  />
                  obrigatório
                </label>

                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => remover(indice)}
                  aria-label={`Remover ${item.label}`}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Um roteiro sem itens não descreve trabalho nenhum. Acrescente ao
            menos um.
          </p>
        )}

        <div className="flex gap-2">
          <Input
            id="template-new-item"
            value={rascunho}
            onChange={(event) => setRascunho(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              /* Enter acrescenta o item, e não envia o formulário. */
              event.preventDefault();
              acrescentar();
            }}
            placeholder="Ex.: Limpeza dos filtros"
          />
          <Button type="button" variant="outline" onClick={acrescentar}>
            <Plus className="size-4" />
            Adicionar
          </Button>
        </div>
      </div>

      {template ? (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1.5 font-mono text-[10px]">
            {template.key}
          </Badge>
          Execuções já gravadas citam esta chave; ela não muda ao editar.
        </p>
      ) : null}

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incompleto || mutation.isPending}>
          {mutation.isPending ? "Salvando…" : template ? "Salvar" : "Criar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type CreateKind = NonNullable<ChecklistTemplate["operationKind"]>;
