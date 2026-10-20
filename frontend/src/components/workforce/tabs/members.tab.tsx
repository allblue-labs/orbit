"use client";

/**
 * Usuários da organização.
 *
 * ## Paginado pelo servidor
 *
 * `GET /organizations/current/members` pagina (`MemberQueryDto`). Busca por
 * nome e filtro por papel ainda são locais — o DTO não os aceita —, e a tela
 * diz isso: são recorte da **página carregada**, não da organização.
 *
 * ## Permissões efetivas
 *
 * Vêm do **papel**, que `GET /organizations/current/roles` publica com a lista
 * `permissions`. É o mesmo dado que o backend usa para autorizar, exibido —
 * nenhuma permissão é derivada ou inferida aqui.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  KeyRound,
  Mail,
  Pencil,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/actions";
import { EntityBadge, MEMBER_STATUS_LABELS } from "@/entities";
import {
  useDismissMember,
  useIssuePasswordLink,
  useTeamMembers,
  useTeamRoles,
} from "@/hooks/workforce/use-workforce";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import { formatDateTime } from "@/lib/formatters";
import { teamMemberRoute } from "@/lib/routes";
import type { TeamMember } from "@/types/workforce";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  optionsFrom,
  useListController,
} from "@/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { CreateMemberDialog } from "../create-member.dialog";
import { InviteMemberDialog } from "../invite-member.dialog";
import { MemberFormDialog } from "../member-form.dialog";
import { PasswordLinkDialog } from "../password-link.dialog";

interface MemberFilters {
  search?: string;
  roleId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export function MembersTab() {
  const list = useListController<MemberFilters>({ limit: 20 });
  const members = useTeamMembers({
    page: list.query.page,
    limit: list.query.limit,
  });
  const roles = useTeamRoles();

  const invite = useAction("team-member.create");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [desligando, setDesligando] = useState<TeamMember | null>(null);

  const passwordLink = useIssuePasswordLink();
  const dismiss = useDismissMember();

  const all = useMemo(() => members.data?.data ?? [], [members.data]);
  const meta = members.data?.meta;

  const filtered = useMemo(() => {
    const term = list.query.search?.toLowerCase() ?? "";
    return all.filter((member) => {
      if (list.query.roleId && member.role.id !== list.query.roleId) {
        return false;
      }
      if (list.query.status && member.status !== list.query.status) {
        return false;
      }
      if (!term) return true;
      return (
        member.displayName.toLowerCase().includes(term) ||
        member.email.toLowerCase().includes(term)
      );
    });
  }, [all, list.query.roleId, list.query.search, list.query.status]);

  const roleOptions = (roles.data ?? []).map((role) => ({
    value: role.id,
    label: role.name,
  }));

  const statusOptions = optionsFrom(
    [...new Set(all.map((member) => member.status))],
    MEMBER_STATUS_LABELS,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={meta}
          noun="pessoa"
          gender="f"
          note={
            list.isFiltered
              ? "Busca e papel filtram apenas esta página."
              : "Ordenado por nome"
          }
        />
        {invite.allowed ? (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Convidar continua existindo, em segundo plano: serve a quem tem
              e-mail e conclui o próprio cadastro. Cadastrar é o caminho da
              equipe de campo, e por isso é o botão cheio.
            */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteOpen(true)}
            >
              <Mail className="size-4" />
              Convidar
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus className="size-4" />
              Cadastrar usuário
            </Button>
          </div>
        ) : null}
      </div>

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id="team-members-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Nome ou e-mail"
          hint="Busca sobre a página carregada."
        />
        <FilterSelect
          id="team-members-role"
          label="Papel"
          value={list.query.roleId}
          onChange={(value) => list.setFilter("roleId", value)}
          options={roleOptions}
          anyLabel="Todos"
        />
        <FilterSelect
          id="team-members-status"
          label="Situação"
          value={list.query.status}
          onChange={(value) => list.setFilter("status", value)}
          options={statusOptions}
        />
      </FilterBar>

      <ListState
        isPending={members.isPending}
        error={members.error}
        onRetry={() => void members.refetch()}
        items={filtered}
        empty={{
          icon: <Users className="size-5" />,
          title: list.isFiltered ? "Nenhuma pessoa encontrada" : "Equipe vazia",
          description: list.isFiltered
            ? "Ajuste a busca ou os filtros."
            : "Cadastre as pessoas que vão executar as operações em campo.",
          action:
            invite.allowed && !list.isFiltered ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <UserPlus className="size-4" />
                Cadastrar usuário
              </Button>
            ) : undefined,
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Unidades</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell>
                      {/* O nome é link para a página da pessoa: endereço que se
                          guarda, recarrega e abre em outra aba. */}
                      <Link
                        href={teamMemberRoute(member.userId)}
                        className="block"
                      >
                        <span className="flex items-center gap-2 font-medium hover:underline">
                          {member.displayName}
                          {member.isOwner ? (
                            <Badge variant="secondary">Dono</Badge>
                          ) : null}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {member.email}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{member.role.name}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {member.businessUnits.length > 0
                        ? member.businessUnits
                            .map((unit) => unit.tradeName ?? unit.legalName)
                            .join(", ")
                        : "Toda a organização"}
                    </TableCell>
                    <TableCell>
                      <EntityBadge
                        entity="team-member"
                        group="status"
                        value={member.status}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(member.joinedAt)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {/*
                       * O caminho principal é um botão, não um item escondido
                       * atrás de três pontinhos: abrir o detalhe é o que se faz
                       * com uma pessoa na lista, e estava a dois cliques e uma
                       * adivinhação. O menu fica ao lado, com o que é menos
                       * frequente e mais consequente.
                       */}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={teamMemberRoute(member.userId)}>
                          Detalhes
                          <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                      <MemberRowActions
                        member={member}
                        onEdit={() => setEditing(member)}
                        onPasswordLink={() =>
                          passwordLink.mutate(member.userId)
                        }
                        onDismiss={() => setDesligando(member)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={members.isFetching}
      />

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <CreateMemberDialog open={createOpen} onOpenChange={setCreateOpen} />

      <PasswordLinkDialog
        resultado={passwordLink.data ?? null}
        error={passwordLink.error}
        isPending={passwordLink.isPending}
        onOpenChange={(open) => {
          if (!open) passwordLink.reset();
        }}
      />

      <ConfirmDialog
        open={desligando !== null}
        onOpenChange={(open) => {
          if (!open) setDesligando(null);
        }}
        title="Desligar da equipe"
        body={
          desligando
            ? `${desligando.displayName} perde o acesso agora, inclusive nas sessões abertas. O histórico de trabalho continua como está, e a vaga do plano é liberada.`
            : undefined
        }
        confirmLabel="Desligar"
        isPending={dismiss.isPending}
        error={dismiss.error}
        onConfirm={() => {
          if (desligando) dismiss.mutate(desligando.userId);
          setDesligando(null);
        }}
      />

      <MemberFormDialog
        member={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

/**
 * Ações de linha.
 *
 * O **dono não é editável**: `ownerUserId` é atributo da organização, e o
 * servidor recusa (400). A tela reflete a mesma condição em vez de oferecer um
 * botão que voltaria erro.
 */
function MemberRowActions({
  member,
  onEdit,
  onPasswordLink,
  onDismiss,
}: {
  member: TeamMember;
  onEdit: () => void;
  onPasswordLink: () => void;
  onDismiss: () => void;
}) {
  /*
   * O gate era `useAction("team-member.update")`, ação declarada
   * `available: false` — então `editable` respondia `false` para todo mundo e o
   * menu só mostrava "Detalhes". Papel, link de senha e desligamento existiam no
   * servidor e não tinham botão.
   *
   * O dono continua fora: `updateMember` recusa rebaixá-lo, e desligá-lo deixaria
   * a conta sem ninguém capaz de administrá-la.
   */
  const { members } = useWorkforceManagement();
  const editable = members.allowed && !member.isOwner;

  if (!editable) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Ações de ${member.displayName}`}
        >
          <span aria-hidden>⋯</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" />
          Papel e situação
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPasswordLink}>
          <KeyRound className="size-4" />
          Gerar link de senha
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onDismiss}
          className="text-destructive focus:text-destructive"
        >
          <UserMinus className="size-4" />
          Desligar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
