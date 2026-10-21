"use client";

/**
 * Ações sobre um membro, no cabeçalho do detalhe.
 *
 * ## O que estava errado
 *
 * O componente recebia `onEdit` opcional e devolvia `null` quando ele faltava —
 * e a página de detalhe o montava sem passar nada. O resultado é que a tela da
 * pessoa não tinha **nenhuma** ação: quem abria o detalhe para arrumar um
 * cadastro ou soltar uma senha precisava voltar para a lista e achar o menu de
 * três pontinhos da linha certa.
 *
 * Agora as ações vivem aqui: o diálogo de edição e o link de senha são estado
 * deste componente, e a página só o monta.
 *
 * ## O dono não é editável
 *
 * `ownerUserId` é atributo da organização, e o servidor recusa (400) tanto a
 * correção de identidade quanto o link de senha dele: quem administrasse a conta
 * poderia apontar o e-mail do dono para um endereço próprio e assumir o lugar
 * dele pela recuperação pública. A tela reflete a mesma condição e diz o motivo,
 * em vez de esconder o botão sem explicação.
 */
import { useState } from "react";
import { KeyRound, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIssuePasswordLink } from "@/hooks/workforce/use-workforce";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import type { TeamMember } from "@/types/workforce";
import { MemberFormDialog } from "./member-form.dialog";
import { PasswordLinkDialog } from "./password-link.dialog";

export function MemberActions({ member }: { member: TeamMember }) {
  /*
   * O mesmo gate do menu de linha, e não `useAction`: a exigência do servidor é
   * `organization.members.update` com plano ativo, sem capability de módulo.
   */
  const { members } = useWorkforceManagement();
  const [editando, setEditando] = useState(false);
  const passwordLink = useIssuePasswordLink();

  if (!members.allowed) {
    return members.reason ? (
      <p className="text-sm text-muted-foreground">{members.reason}</p>
    ) : null;
  }

  if (member.isOwner) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button variant="outline" size="sm" disabled>
              <Pencil className="size-4" />
              Editar usuário
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          O dono da organização não é alterado por aqui — rebaixá-lo deixaria a
          conta sem quem a administre, e trocar o e-mail dele permitiria assumir
          a conta pela recuperação de senha. Ele edita os próprios dados no
          perfil.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
          <Pencil className="size-4" />
          Editar usuário
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => passwordLink.mutate(member.userId)}
          disabled={passwordLink.isPending}
        >
          <KeyRound className="size-4" />
          Redefinir senha
        </Button>
      </div>

      <MemberFormDialog
        member={editando ? member : null}
        onOpenChange={(open) => {
          if (!open) setEditando(false);
        }}
        onResetPassword={() => passwordLink.mutate(member.userId)}
      />

      <PasswordLinkDialog
        resultado={passwordLink.data ?? null}
        error={passwordLink.error}
        isPending={passwordLink.isPending}
        onOpenChange={(open) => {
          if (!open) passwordLink.reset();
        }}
      />
    </>
  );
}
