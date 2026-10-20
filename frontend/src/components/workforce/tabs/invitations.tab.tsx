"use client";

/**
 * Convites.
 *
 * ## Paginado e filtrado pelo servidor
 *
 * `InvitationQueryDto` aceita `status`, `search`, `page` e `limit` — busca e
 * recorte são do backend, e a tela só passa adiante o que o
 * `useListController` reúne.
 *
 * ## Prazo é do servidor
 *
 * `expiresAt` vem publicado, e a listagem marca como `EXPIRED` os pendentes
 * vencidos **antes** de responder. A tela não compara datas para decidir se um
 * convite ainda vale — ela mostra o status que o backend deu e o prazo que ele
 * publicou.
 *
 * O tempo restante é apresentação: quantos dias faltam, para quem lê. Não é
 * decisão — reenviar e cancelar seguem o `status`, não o relógio local.
 *
 * ## O token nunca aparece
 *
 * Nem na listagem, nem no retorno da criação, nem no reenvio. Ele é entregue
 * uma vez, por e-mail. Reexpô-lo daria a qualquer gestor a capacidade de
 * aceitar o convite no lugar da pessoa.
 */
import { useState } from "react";
import { MailPlus, Send, UserPlus } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/actions";
import { EntityBadge, INVITATION_STATUS_LABELS } from "@/entities";
import {
  useResendInvitation,
  useRevokeInvitation,
  useTeamInvitations,
} from "@/hooks/workforce/use-workforce";
import { formatDateTime } from "@/lib/formatters";
import { InvitationStatus } from "@/types/contracts";
import type { TeamInvitation } from "@/types/workforce";
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
import { InviteMemberDialog } from "../invite-member.dialog";

const STATUS_OPTIONS = optionsFrom(
  Object.values(InvitationStatus),
  INVITATION_STATUS_LABELS,
);

interface InvitationFilters {
  search?: string;
  status?: InvitationStatus;
  page?: number;
  limit?: number;
}

/**
 * Quanto falta para vencer — apresentação, não decisão.
 *
 * Quem decide se o convite vale é o servidor, que já devolveu o `status`.
 */
function remaining(expiresAt: string): string {
  const days = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60_000),
  );
  if (days < 0) return "vencido";
  if (days === 0) return "vence hoje";
  return days === 1 ? "vence amanhã" : `vence em ${days} dias`;
}

export function InvitationsTab() {
  const list = useListController<InvitationFilters>({ limit: 20 });
  const query = useTeamInvitations(list.query);

  const invite = useAction("team-member.create");
  const [inviteOpen, setInviteOpen] = useState(false);

  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();

  const invitations = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={meta}
          noun="convite"
          note="Convites vencidos são marcados automaticamente."
        />
        {invite.allowed ? (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            {invite.label}
          </Button>
        ) : null}
      </div>

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id="invitations-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="E-mail convidado"
          hint="A busca considera o e-mail convidado."
        />
        <FilterSelect
          id="invitations-status"
          label="Situação"
          value={list.query.status}
          onChange={(value) =>
            list.setFilter("status", value as InvitationStatus | undefined)
          }
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      <MutationError error={resend.error ?? revoke.error} />

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={invitations}
        empty={{
          icon: <MailPlus className="size-5" />,
          title: list.isFiltered
            ? "Nenhum convite encontrado"
            : "Nenhum convite enviado",
          description: list.isFiltered
            ? "Ajuste a busca ou o filtro de situação."
            : "Convide alguém para que a pessoa crie a própria conta.",
          action:
            invite.allowed && !list.isFiltered ? (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                {invite.label}
              </Button>
            ) : undefined,
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Convidado</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <InvitationRow
                    key={item.id}
                    invitation={item}
                    onResend={() => resend.mutate(item.id)}
                    onRevoke={() => revoke.mutate(item.id)}
                    busy={
                      (resend.isPending && resend.variables === item.id) ||
                      (revoke.isPending && revoke.variables === item.id)
                    }
                  />
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
        isFetching={query.isFetching}
      />

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function InvitationRow({
  invitation,
  onResend,
  onRevoke,
  busy,
}: {
  invitation: TeamInvitation;
  onResend: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  const resend = useAction("team-member.resend-invitation");
  const revoke = useAction("team-member.revoke-invitation");

  /**
   * Só convite pendente aceita ação.
   *
   * É o que o servidor exige (`requirePending`), e a tela reflete a mesma
   * condição em vez de oferecer um botão que voltaria com 400.
   */
  const pending = invitation.status === InvitationStatus.PENDING;
  const canAct = pending && (resend.allowed || revoke.allowed);

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{invitation.email}</p>
        <p className="text-xs text-muted-foreground">
          {invitation.invitedBy
            ? `Convidado por ${invitation.invitedBy.displayName}`
            : "—"}
        </p>
      </TableCell>
      <TableCell className="text-sm">{invitation.role.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {invitation.businessUnit
          ? (invitation.businessUnit.tradeName ??
            invitation.businessUnit.legalName)
          : "Toda a organização"}
      </TableCell>
      <TableCell>
        <EntityBadge
          entity="team-member"
          group="invitation"
          value={invitation.status}
        />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {invitation.acceptedAt ? (
          <>aceito em {formatDateTime(invitation.acceptedAt)}</>
        ) : (
          <>
            {formatDateTime(invitation.expiresAt)}
            {pending ? (
              <span className="block text-xs">
                {remaining(invitation.expiresAt)}
              </span>
            ) : null}
          </>
        )}
      </TableCell>
      <TableCell>
        {canAct ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Ações do convite de ${invitation.email}`}
                disabled={busy}
              >
                <span aria-hidden>⋯</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {resend.allowed ? (
                <DropdownMenuItem onSelect={onResend}>
                  <Send className="size-4" />
                  {resend.label}
                </DropdownMenuItem>
              ) : null}
              {revoke.allowed ? (
                <DropdownMenuItem
                  onSelect={onRevoke}
                  className="text-destructive"
                >
                  <revoke.definition.icon className="size-4" />
                  {revoke.label}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
