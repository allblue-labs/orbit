"use client";

/**
 * Editar usuário: os dados que a organização digitou, e o acesso que ela concede.
 *
 * ## Por que os dois no mesmo diálogo, e duas rotas atrás
 *
 * Quem abre "Editar usuário" quer arrumar o cadastro — às vezes o nome, às
 * vezes o papel. São duas rotas no servidor de propósito: corrigir um nome não
 * deve exigir mandar de volta o conjunto de permissões, e um erro em qualquer
 * das duas não deve arrastar a outra. O diálogo manda só o que mudou, cada
 * parte para a sua rota.
 *
 * ## A senha nunca é digitada aqui
 *
 * Ninguém — nem o dono — define a senha de outra pessoa: o que esta tela gera é
 * um link de uso único para a própria pessoa definir a dela. Um campo de senha
 * aqui deixaria a credencial de alguém na mão de quem a digitou.
 */
import { useState } from "react";
import { KeyRound } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { MemberAccessEditor } from "@/components/workforce/member-access-editor";
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
import { MEMBER_STATUS_LABELS } from "@/entities";
import { useBusinessUnits } from "@/hooks/organization/use-organization";
import {
  useAccessCatalog,
  useTeamRoles,
  useUpdateMember,
  useUpdateTeamMember,
} from "@/hooks/workforce/use-workforce";
import { MembershipStatus, type TeamMember } from "@/types/workforce";
import { memberChanges } from "./member-changes";

export function MemberFormDialog({
  member,
  onOpenChange,
  onResetPassword,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Gera o link de definição de senha.
   *
   * Quem mostra o link é a tela de cima, que já tem o `PasswordLinkDialog`:
   * duplicá-lo aqui faria dois diálogos disputarem o mesmo resultado. Ausente,
   * o botão não aparece.
   */
  onResetPassword?: () => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {member ? (
          <Body
            key={member.userId}
            member={member}
            onOpenChange={onOpenChange}
            onResetPassword={onResetPassword}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  member,
  onOpenChange,
  onResetPassword,
}: {
  member: TeamMember;
  onOpenChange: (open: boolean) => void;
  onResetPassword?: () => void;
}) {
  const roles = useTeamRoles();
  const units = useBusinessUnits();
  const catalog = useAccessCatalog();
  const update = useUpdateMember(member.userId);
  const identidade = useUpdateTeamMember(member.userId);

  const [firstName, setFirstName] = useState(member.firstName);
  const [lastName, setLastName] = useState(member.lastName);
  const [email, setEmail] = useState(member.email);
  const [roleId, setRoleId] = useState(member.role.id);
  const [status, setStatus] = useState<string>(member.status);
  const [businessUnitIds, setBusinessUnitIds] = useState<string[]>(
    member.businessUnits.map((unit) => unit.id),
  );
  const [useRoleDefaults, setUseRoleDefaults] = useState(
    member.access.useRoleDefaults,
  );
  const [permissions, setPermissions] = useState<string[]>([
    ...member.access.permissions,
  ]);
  const [allowedSurfaces, setAllowedSurfaces] = useState<string[]>([
    ...member.access.allowedSurfaces,
  ]);

  const role = (roles.data ?? []).find((item) => item.id === roleId);

  const setDefaults = (enabled: boolean) => {
    setUseRoleDefaults(enabled);
    if (!enabled && role) {
      setPermissions([...role.permissions]);
      setAllowedSurfaces([...role.allowedSurfaces]);
    }
  };

  /*
   * O dono fica fora da correção de identidade.
   *
   * O servidor recusa (400) pela mesma razão do link de senha: apontar o e-mail
   * dele para outro endereço e usar a recuperação pública seria assumir a conta.
   * A tela diz isso, em vez de oferecer campos que voltariam erro.
   */
  const identidadeEditavel = !member.isOwner;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const { dados, acesso } = memberChanges(member, {
      firstName,
      lastName,
      email,
      roleId,
      status,
      businessUnitIds,
      useRoleDefaults,
      permissions,
      allowedSurfaces,
    });

    if (!dados && !acesso) {
      onOpenChange(false);
      return;
    }

    /*
     * Em sequência, e com `await`: se a correção do nome falhar por e-mail já
     * usado, as permissões não são reescritas em silêncio — o diálogo fica
     * aberto mostrando o que o servidor recusou, com o resto como estava.
     */
    try {
      if (dados) await identidade.mutateAsync(dados);
      if (acesso) await update.mutateAsync(acesso);
      onOpenChange(false);
    } catch {
      /* `MutationError` abaixo mostra a recusa; o diálogo continua aberto. */
    }
  };

  const invalid =
    businessUnitIds.length === 0 ||
    (!useRoleDefaults && allowedSurfaces.length === 0) ||
    (identidadeEditavel &&
      (firstName.trim().length === 0 ||
        lastName.trim().length === 0 ||
        email.trim().length === 0));
  const salvando = update.isPending || identidade.isPending;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{member.displayName}</DialogTitle>
        <DialogDescription>
          Corrija o cadastro e defina o acesso. Foto, telefone e senha continuam
          pertencendo ao perfil da própria pessoa.
        </DialogDescription>
      </DialogHeader>

      <section className="space-y-4 rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium">Dados da pessoa</h3>

        {identidadeEditavel ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="member-first-name">Nome</Label>
                <Input
                  id="member-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="member-last-name">Sobrenome</Label>
                <Input
                  id="member-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-email">E-mail</Label>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={255}
                autoComplete="off"
              />
              {/* É com ele que a pessoa entra: mudar aqui muda o login. */}
              <p className="text-xs text-muted-foreground">
                É o login da pessoa. Alterá-lo troca o endereço com que ela
                entra no Orbit — a senha atual continua valendo.
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            O dono da organização corrige o próprio nome e e-mail no perfil
            dele. Alterá-los por aqui permitiria assumir a conta pela
            recuperação de senha.
          </p>
        )}

        {onResetPassword && identidadeEditavel ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Esqueceu a senha? Gere um link de uso único para ela definir uma
              nova.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onResetPassword}
            >
              <KeyRound className="size-4" />
              Redefinir senha
            </Button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="member-role">Papel</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="member-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(roles.data ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="member-status">Situação</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="member-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(MembershipStatus).map((value) => (
                <SelectItem key={value} value={value}>
                  {MEMBER_STATUS_LABELS[value] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <MemberAccessEditor
        units={units.data ?? []}
        selectedUnitIds={businessUnitIds}
        onSelectedUnitIdsChange={setBusinessUnitIds}
        role={role}
        catalog={catalog.data}
        useRoleDefaults={useRoleDefaults}
        onUseRoleDefaultsChange={setDefaults}
        permissions={permissions}
        onPermissionsChange={setPermissions}
        allowedSurfaces={allowedSurfaces}
        onAllowedSurfacesChange={setAllowedSurfaces}
      />

      <MutationError error={identidade.error} />
      <MutationError error={update.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={invalid || salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
