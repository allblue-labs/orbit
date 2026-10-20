"use client";

/**
 * Papéis e o que cada um concede.
 *
 * ## Editáveis, exceto os de sistema
 *
 * A organização cria e edita os próprios papéis. `isSystem` marca os que a
 * plataforma semeou, e o **servidor recusa** alterá-los (400) — alterar as
 * permissões de um papel de sistema mudaria o seu significado para além desta
 * organização.
 *
 * Remover também é recusado enquanto houver membro ou convite pendente
 * apontando para o papel: uma pessoa ficaria sem permissões, e um convite não
 * teria o que conceder ao ser aceito.
 *
 * ## Permissões e capabilities são coisas diferentes
 *
 * - **Permissão** vem do **papel**: o que esta pessoa pode fazer.
 * - **Capability** vem do **plano**: o que esta organização contratou.
 *
 * O backend exige as duas (`@Permissions` e `@Capabilities`), e é por isso que
 * um Owner pode não ver um recurso — o papel permite, o plano não inclui. A
 * aba mostra as duas lado a lado justamente para tornar essa distinção
 * visível.
 *
 * ## Módulos
 *
 * Os rótulos vêm do catálogo server-owned; códigos internos não fazem parte
 * da linguagem da tela de administração.
 */
import { useMemo, useState } from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import { ManagementBlocked } from "../management-blocked";
import {
  useAccessCatalog,
  useRemoveRole,
  useTeamRoles,
} from "@/hooks/workforce/use-workforce";
import { useSession } from "@/providers/session-provider";
import type { AccessCatalog, TeamRole } from "@/types/workforce";
import { ListState } from "@/workspace";
import { RoleFormDialog } from "../role-form.dialog";

export function RolesTab() {
  const query = useTeamRoles();
  const catalog = useAccessCatalog();
  const roles = useMemo(() => query.data ?? [], [query.data]);

  const gate = useWorkforceManagement().roles;
  const remove = useRemoveRole();
  const [editing, setEditing] = useState<TeamRole | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <ManagementBlocked reason={gate.reason} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          O papel define as permissões de quem o tem. Papéis de sistema não são
          editáveis.
        </p>
        {gate.allowed ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Novo papel
          </Button>
        ) : null}
      </div>

      <MutationError error={remove.error} />

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={roles}
        empty={{
          icon: <ShieldCheck className="size-5" />,
          title: "Nenhum papel",
          description:
            "A organização ainda não tem papéis próprios cadastrados.",
        }}
      >
        {(rows) => (
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                catalog={catalog.data}
                onEdit={() => setEditing(role)}
                onRemove={() => remove.mutate(role.id)}
                removing={remove.isPending && remove.variables === role.id}
              />
            ))}
          </div>
        )}
      </ListState>

      <RoleFormDialog
        role={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </div>
  );
}

function RoleCard({
  role,
  catalog,
  onEdit,
  onRemove,
  removing,
}: {
  role: TeamRole;
  catalog: AccessCatalog | undefined;
  onEdit: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const session = useSession();
  const gate = useWorkforceManagement().roles;
  const groups = useMemo(
    () =>
      (catalog?.permissionGroups ?? [])
        .map((group) => ({
          key: group.key,
          label: group.label,
          items: group.permissions.filter((item) =>
            role.permissions.includes(item.code),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [catalog, role.permissions],
  );

  /** Papel de sistema é protegido pelo servidor; a tela reflete a condição. */
  const editable = gate.allowed && !role.isSystem;

  return (
    <article className="glass-panel space-y-4 rounded-xl p-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{role.name}</h3>
          {role.isSystem ? <Badge variant="secondary">Sistema</Badge> : null}
          <Badge variant="outline">
            {role.memberCount === 1
              ? "1 pessoa"
              : `${role.memberCount} pessoas`}
          </Badge>
        </div>
        {role.description ? (
          <p className="text-sm text-muted-foreground">{role.description}</p>
        ) : null}

        {editable ? (
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="size-4" />
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={removing}
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
              Excluir
            </Button>
          </div>
        ) : null}
      </header>

      <section className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Permissões por módulo
        </h4>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma permissão declarada.
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((group) => (
              <li key={group.key}>
                <p className="text-xs font-medium text-foreground">
                  {group.label}
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {group.items.map((permission) => (
                    <li key={permission.code}>
                      <span className="rounded-md bg-surface-strong px-2 py-0.5 text-[11px] text-muted-foreground">
                        {permission.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        As capabilities são do **plano**, não do papel — por isso aparecem uma
        vez, iguais para todos os papéis, e a nota explica a diferença. Sem
        isso, "o Owner não vê o módulo X" fica sem explicação.
      */}
      <section className="space-y-2 border-t border-border pt-3">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Recursos contratados
        </h4>
        <p className="text-xs text-muted-foreground">
          Permissões dizem o que a pessoa pode fazer. Recursos contratados dizem
          o que está disponível para toda a organização — uma condição nunca
          substitui a outra.
        </p>
        <Badge variant="secondary">
          {session.productCapabilities.length} recursos ativos neste plano
        </Badge>
      </section>
    </article>
  );
}
