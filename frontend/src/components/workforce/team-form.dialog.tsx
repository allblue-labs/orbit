"use client";

/**
 * Criação e edição de equipe.
 *
 * ## Por que substituiu o formulário embutido
 *
 * O que havia pedia **só o nome**, e não havia como editar depois. O contrato
 * aceita descrição, líder e situação desde sempre — o cartão da equipe já
 * mostrava "Sem líder definido" sem oferecer forma de definir um.
 *
 * ## O líder sai dos membros da organização, não da equipe
 *
 * `leaderUserId` é validado contra a organização, não contra a lista de
 * integrantes: uma equipe recém-criada não tem ninguém dentro, e exigir que o
 * líder já fosse membro tornaria impossível nomear um na criação.
 *
 * ## Cor fica de fora
 *
 * `color` existe no contrato e nada na interface a usa. Um seletor que grava
 * um valor que nenhuma tela lê é trabalho para quem preenche e ruído para
 * quem mantém.
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
  useCreateTeam,
  useTeamMembers,
  useUpdateTeam,
} from "@/hooks/workforce/use-workforce";
import type { Team } from "@/types/workforce";

/** O valor que representa "ninguém" — `Select` não aceita item de valor "". */
const SEM_LIDER = "__none__";

export function TeamFormDialog({
  team,
  open,
  onOpenChange,
}: {
  /** `null` cria; preenchido edita. */
  team: Team | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Body key={team?.id ?? "new"} team={team} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  team,
  onOpenChange,
}: {
  team: Team | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? "");
  const mutation = team ? update : create;

  const members = useTeamMembers({ page: 1, limit: 100 });

  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [leaderUserId, setLeaderUserId] = useState(
    team?.leader?.userId ?? SEM_LIDER,
  );
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(
    team?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        leaderUserId: leaderUserId === SEM_LIDER ? undefined : leaderUserId,

        /// Situação só vai na edição: o contrato de criação não a aceita.
        ...(team ? { status } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{team ? "Editar equipe" : "Nova equipe"}</DialogTitle>
        <DialogDescription>
          Equipes agrupam pessoas para escala e atribuição de trabalho.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="team-form-name">Nome</Label>
          <Input
            id="team-form-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Equipe Norte"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="team-form-description">Descrição</Label>
          <Textarea
            id="team-form-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="Opcional — o que esta equipe atende"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="team-form-leader">Líder</Label>
          <Select value={leaderUserId} onValueChange={setLeaderUserId}>
            <SelectTrigger id="team-form-leader">
              <SelectValue placeholder="Sem líder definido" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_LIDER}>Sem líder definido</SelectItem>
              {(members.data?.data ?? []).map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {team ? (
          <div className="space-y-2">
            <Label htmlFor="team-form-status">Situação</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as "ACTIVE" | "INACTIVE")
              }
            >
              <SelectTrigger id="team-form-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Ativa</SelectItem>
                <SelectItem value="INACTIVE">Inativa</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Inativar preserva o histórico; remover apaga a equipe.
            </p>
          </div>
        ) : null}
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
          {mutation.isPending ? "Salvando…" : team ? "Salvar" : "Criar equipe"}
        </Button>
      </DialogFooter>
    </form>
  );
}
