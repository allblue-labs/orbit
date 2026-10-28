"use client";

/**
 * Convite de pessoa.
 *
 * Escreve em `POST /identity/invitations`. O DTO aceita três campos: e-mail,
 * papel e unidade.
 *
 * ## O que não é decidido aqui
 *
 * - **A senha.** Quem a define é a pessoa convidada, ao aceitar
 *   (`POST /identity/invitations/accept`). Este módulo não substitui o domínio
 *   de autenticação.
 * - **O prazo.** Sete dias, decididos pelo servidor. A resposta traz o
 *   `expiresAt`, e é ele que a tela mostra — não uma conta local.
 * - **O token.** Gerado e entregue por e-mail pelo backend; nunca aparece na
 *   interface, nem no retorno da criação.
 * - **Duplicidade.** `@@unique([organizationId, normalizedEmail, status])`
 *   recusa um segundo convite pendente para o mesmo e-mail, com 409. A tela
 *   não pré-verifica.
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
import {
  useInviteMember,
  useTeamRoles,
} from "@/hooks/workforce/use-workforce";
import { useActiveScope } from "@/providers/use-active-scope";

/** "Toda a organização" precisa de um valor real no `Select`. */
const NONE = "__none__";

export function InviteMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Body onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { businessUnits } = useActiveScope();
  const roles = useTeamRoles();
  const invite = useInviteMember();

  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    invite.mutate(
      {
        email: email.trim().toLowerCase(),
        roleId,
        businessUnitId: businessUnitId || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const incomplete = !email.trim() || !roleId;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Convidar pessoa</DialogTitle>
        <DialogDescription>
          O convite chega por e-mail. A pessoa define a própria senha ao
          aceitar.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label required htmlFor="invite-email">E-mail</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="pessoa@empresa.com.br"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-role">Papel</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="invite-role">
              <SelectValue placeholder="Selecione o papel" />
            </SelectTrigger>
            <SelectContent>
              {(roles.data ?? []).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            O papel define as permissões. Ele só é informado aqui — não há rota
            para alterá-lo depois.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-unit">Unidade</Label>
          <Select
            value={businessUnitId || NONE}
            onValueChange={(value) =>
              setBusinessUnitId(value === NONE ? "" : value)
            }
          >
            <SelectTrigger id="invite-unit">
              <SelectValue placeholder="Toda a organização" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Toda a organização</SelectItem>
              {businessUnits.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.tradeName ?? unit.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <MutationError error={invite.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || invite.isPending}>
          {invite.isPending ? "Enviando…" : "Enviar convite"}
        </Button>
      </DialogFooter>
    </form>
  );
}
