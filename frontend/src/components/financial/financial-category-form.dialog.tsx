"use client";

/**
 * Criação e edição de categoria financeira.
 *
 * ## `type` só existe na criação
 *
 * `UpdateFinancialCategoryDto` não aceita `type`, e a razão é do domínio:
 * trocar o lado de uma categoria já usada mudaria o sinal de lançamentos
 * passados sem que ninguém os tocasse — a receita de março viraria despesa
 * retroativamente. Quem errou o lado cria a categoria certa e move os
 * lançamentos.
 *
 * A cor é uma classe de token do Design System, não um valor livre: um seletor
 * de cor arbitrário produziria contraste imprevisível sobre o tema.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
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
import {
  useCreateFinancialCategory,
  useUpdateFinancialCategory,
} from "@/hooks/financial/use-financial";
import {
  FINANCIAL_TYPE_LABELS,
  type FinancialCategory,
  type FinancialEntryType,
} from "@/types/financial";

/**
 * Paleta oferecida.
 *
 * São os nomes que o backend guarda em `color` — texto curto, não CSS. A
 * tradução para classe acontece na apresentação; aqui só se escolhe o nome.
 */
const COLORS: readonly { value: string; label: string }[] = [
  { value: "emerald", label: "Verde" },
  { value: "teal", label: "Turquesa" },
  { value: "sky", label: "Azul" },
  { value: "violet", label: "Violeta" },
  { value: "amber", label: "Âmbar" },
  { value: "orange", label: "Laranja" },
  { value: "rose", label: "Rosa" },
  { value: "red", label: "Vermelho" },
  { value: "slate", label: "Cinza" },
];

export function FinancialCategoryFormDialog({
  open,
  onOpenChange,
  editing = null,
  defaultType = "EXPENSE",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: FinancialCategory | null;
  defaultType?: FinancialEntryType;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Body
          key={editing?.id ?? `new:${defaultType}`}
          editing={editing}
          defaultType={defaultType}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  defaultType,
  onOpenChange,
}: {
  editing: FinancialCategory | null;
  defaultType: FinancialEntryType;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [color, setColor] = useState(editing?.color ?? "slate");
  const [type, setType] = useState<FinancialEntryType>(
    editing?.type ?? defaultType,
  );

  const create = useCreateFinancialCategory();
  const update = useUpdateFinancialCategory();
  const mutation = editing ? update : create;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const done = () => onOpenChange(false);
    const base = {
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    };

    if (editing) {
      update.mutate({ id: editing.id, input: base }, { onSuccess: done });
      return;
    }
    create.mutate({ ...base, type }, { onSuccess: done });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {editing ? "Editar categoria" : "Nova categoria"}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? "O sentido não muda: trocá-lo reescreveria o sinal de lançamentos já feitos."
            : "Escolha a que lado ela pertence — isso não muda depois."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {editing ? null : (
          <div className="space-y-2">
            <Label htmlFor="financial-category-type">Sentido</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as FinancialEntryType)}
            >
              <SelectTrigger id="financial-category-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">
                  {FINANCIAL_TYPE_LABELS.INCOME}
                </SelectItem>
                <SelectItem value="EXPENSE">
                  {FINANCIAL_TYPE_LABELS.EXPENSE}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label required htmlFor="financial-category-name">Nome</Label>
          <Input
            id="financial-category-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="Ex.: Peças e materiais"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="financial-category-color">Cor</Label>
          <Select value={color} onValueChange={setColor}>
            <SelectTrigger id="financial-category-color">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLORS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="financial-category-description">Descrição</Label>
          <Textarea
            id="financial-category-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={2}
          />
        </div>
      </div>

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={name.trim().length < 2 || mutation.isPending}
        >
          {mutation.isPending ? "Salvando…" : editing ? "Salvar" : "Criar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
