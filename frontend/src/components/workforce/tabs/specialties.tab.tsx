"use client";

/**
 * Catálogo de especialidades.
 *
 * É catálogo, e não texto livre no membro, para que duas pessoas com a mesma
 * especialidade sejam encontráveis pela mesma chave — sem isso, "Refrigeração"
 * e "refrigeraçao" seriam coisas diferentes.
 *
 * O `slug` é gerado pelo **servidor** a partir do nome; a tela o exibe, nunca
 * o gera.
 */
import { useState } from "react";
import { Award, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import { ManagementBlocked } from "../management-blocked";
import {
  useCreateSpecialty,
  useRemoveSpecialty,
  useSpecialties,
  useUpdateSpecialty,
} from "@/hooks/workforce/use-workforce";
import type { Specialty } from "@/types/workforce";
import { ListState } from "@/workspace";

export function SpecialtiesTab() {
  const query = useSpecialties();
  const workforce = useWorkforceManagement().workforce;

  /** `null` fechado; `"new"` criando; uma especialidade editando. */
  const [editando, setEditando] = useState<Specialty | "new" | null>(null);
  const alvo = editando === "new" ? null : editando;

  const create = useCreateSpecialty();
  const update = useUpdateSpecialty(alvo?.id ?? "");
  const remove = useRemoveSpecialty();
  const mutation = alvo ? update : create;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const items = query.data ?? [];

  const abrir = (especialidade: Specialty | "new") => {
    setEditando(especialidade);
    setName(especialidade === "new" ? "" : especialidade.name);
    setDescription(
      especialidade === "new" ? "" : (especialidade.description ?? ""),
    );
  };

  const fechar = () => {
    setEditando(null);
    setName("");
    setDescription("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      { name: name.trim(), description: description.trim() || undefined },
      { onSuccess: fechar },
    );
  };

  return (
    <div className="space-y-5">
      <ManagementBlocked reason={workforce.reason} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Especialidades são compartilhadas por toda a organização e vinculadas
          às pessoas com um nível declarado.
        </p>
        {workforce.allowed && editando === null ? (
          <Button size="sm" onClick={() => abrir("new")}>
            <Plus className="size-4" />
            Nova especialidade
          </Button>
        ) : null}
      </div>

      {editando !== null ? (
        <form
          onSubmit={submit}
          className="glass-panel space-y-3 rounded-xl p-4"
        >
          <p className="text-sm font-medium">
            {alvo ? `Editar ${alvo.name}` : "Nova especialidade"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="specialty-name">Nome</Label>
              <Input
                id="specialty-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Refrigeração"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="specialty-description">Descrição</Label>
              <Input
                id="specialty-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          <MutationError error={mutation.error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={fechar}>
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || mutation.isPending}
            >
              {mutation.isPending ? "Salvando…" : alvo ? "Salvar" : "Criar"}
            </Button>
          </div>
        </form>
      ) : null}

      <MutationError error={remove.error} />

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={items}
        rows={3}
        empty={{
          icon: <Award className="size-5" />,
          title: "Nenhuma especialidade",
          description:
            "Especialidades permitem encontrar quem sabe fazer o quê na hora de escalar trabalho.",
          action: workforce.allowed ? (
            <Button size="sm" onClick={() => abrir("new")}>
              <Plus className="size-4" />
              Nova especialidade
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <ul className="glass-panel divide-y divide-border rounded-xl">
            {rows.map((specialty) => (
              <li
                key={specialty.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {specialty.name}
                  </p>
                  {specialty.description ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {specialty.description}
                    </p>
                  ) : null}
                </div>

                <span className="font-mono text-xs text-muted-foreground">
                  {specialty.slug}
                </span>

                <Badge variant="outline">
                  {specialty.memberCount === 1
                    ? "1 pessoa"
                    : `${specialty.memberCount} pessoas`}
                </Badge>

                {workforce.allowed ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${specialty.name}`}
                      onClick={() => abrir(specialty)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${specialty.name}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(specialty.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ListState>

      <p className="text-xs text-muted-foreground">
        Não é possível remover uma especialidade que ainda esteja vinculada a
        alguém — apagá-la apagaria a informação de que aquelas pessoas a
        possuem.
      </p>
    </div>
  );
}
