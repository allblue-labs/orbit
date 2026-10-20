"use client";

/**
 * Cadastro de unidade de PMOC.
 *
 * Uma unidade é a parte do sistema que recebe manutenção — condensadora,
 * evaporadora, dutos. Ela se cadastra **uma vez** com o roteiro que descreve o
 * serviço nela, e depois cada plano marca quais atende.
 *
 * A chave é separada do nome porque é ela que identifica a unidade nos
 * relatórios e nas integrações: o nome pode ser reescrito sem quebrar nada, a
 * chave não. Quem cria não precisa pensar nela — ela é derivada do nome
 * enquanto ninguém a editar à mão.
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
import { useChecklistTemplates } from "@/hooks/operations/use-operations";
import { useCreatePmocUnit, useUpdatePmocUnit } from "@/hooks/pmoc/use-pmoc";
import type { PmocUnit } from "@/types/pmoc";

/** `Select` não aceita item de valor vazio; este é o "sem roteiro ainda". */
const SEM_ROTEIRO = "__none__";

/**
 * A chave derivada de um nome: maiúsculas, sem acento, sem pontuação.
 *
 * `CONDENSADORA`, `AGUA_GELADA`. O mesmo formato que o backend valida.
 */
function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function PmocUnitFormDialog({
  unit,
  open,
  onOpenChange,
}: {
  /** `null` cria; preenchido edita. */
  unit: PmocUnit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* `key` remonta o corpo ao trocar de unidade: sem isso o estado do
            formulário anterior sobreviveria à troca. */}
        <Body key={unit?.id ?? "new"} unit={unit} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  unit,
  onOpenChange,
}: {
  unit: PmocUnit | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreatePmocUnit();
  const update = useUpdatePmocUnit(unit?.id ?? "");
  const mutation = unit ? update : create;
  const roteiros = useChecklistTemplates();

  const [name, setName] = useState(unit?.name ?? "");
  const [key, setKey] = useState(unit?.key ?? "");
  const [description, setDescription] = useState(unit?.description ?? "");
  const [templateId, setTemplateId] = useState(unit?.checklist?.id ?? "");

  /**
   * A chave já foi mexida à mão?
   *
   * Enquanto não, trocar o nome recalcula. Depois, o campo é de quem digitou —
   * e numa unidade existente a chave nunca é sobrescrita, porque relatórios já
   * emitidos a citam.
   */
  const [chaveEditada, setChaveEditada] = useState(Boolean(unit));

  const chaveFinal = chaveEditada ? key.trim() : chaveDoNome(name);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      {
        name: name.trim(),
        key: chaveFinal,
        description: description.trim() || undefined,
        ...(templateId ? { checklistTemplateId: templateId } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const incompleto = name.trim().length < 2 || chaveFinal.length < 2;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{unit ? "Editar unidade" : "Nova unidade"}</DialogTitle>
        <DialogDescription>
          A parte do sistema que recebe manutenção — condensadora, evaporadora,
          dutos. O roteiro escolhido aqui é o que o relatório descreve quando
          esta unidade entra num plano.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pmoc-unit-name">Nome</Label>
          <Input
            id="pmoc-unit-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Unidade condensadora"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pmoc-unit-key">Chave</Label>
          <Input
            id="pmoc-unit-key"
            value={chaveFinal}
            onChange={(event) => {
              setChaveEditada(true);
              setKey(event.target.value.toUpperCase());
            }}
            className="font-mono"
            required
          />
          <p className="text-xs text-muted-foreground">
            {unit
              ? "Relatórios já emitidos citam esta chave; mudá-la não os reescreve."
              : "Derivada do nome. Identifica a unidade nos relatórios."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pmoc-unit-template">Roteiro</Label>
          <Select
            value={templateId || SEM_ROTEIRO}
            onValueChange={(valor) =>
              setTemplateId(valor === SEM_ROTEIRO ? "" : valor)
            }
          >
            <SelectTrigger id="pmoc-unit-template">
              <SelectValue placeholder="Sem roteiro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_ROTEIRO}>Sem roteiro</SelectItem>
              {(roteiros.data?.data ?? []).map((modelo) => (
                <SelectItem key={modelo.id} value={modelo.id}>
                  {`${modelo.name} · ${modelo.items.length} ${
                    modelo.items.length === 1 ? "item" : "itens"
                  }`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Sem roteiro, a unidade entra no relatório sem itens a descrever.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pmoc-unit-description">Descrição</Label>
          <Textarea
            id="pmoc-unit-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="Opcional — o que distingue esta unidade das outras"
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
        <Button type="submit" disabled={incompleto || mutation.isPending}>
          {mutation.isPending
            ? "Salvando…"
            : unit
              ? "Salvar"
              : "Criar unidade"}
        </Button>
      </DialogFooter>
    </form>
  );
}
