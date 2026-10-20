"use client";

/**
 * A equipe do atendimento.
 *
 * ```
 * Responsável            ← um, e só um
 * auxiliares técnico     ← zero ou muitos
 * Execução               ← quem começou e quem concluiu, historicamente
 * ```
 *
 * ## Três coisas diferentes na mesma tela
 *
 * **Responsável** é quem responde pelo atendimento agora. **auxiliares
 * técnico** acompanham a execução. **Execução** é história: quem de fato
 * iniciou e quem concluiu, ainda que o responsável tenha mudado depois.
 *
 * O histórico não se corrige. Se João começou e Maria assumiu, a tela mostra
 * as duas coisas — reescrever "iniciado por" para o responsável atual apagaria
 * o que aconteceu, que é justamente o que o registro serve para preservar.
 *
 * ## Estar na equipe não dá permissão
 *
 * Ser responsável ou auxiliar **não** habilita nenhum controle. Quem decide o
 * que aparece é `allowedActions`, publicado pelo servidor por registro. É a
 * mesma regra da PR-FE-01, e ela vale aqui inteira: o painel lê a autoridade,
 * não a deduz de quem está na lista.
 */
import { useState } from "react";
import { ArrowUpCircle, Plus, UserMinus, UserRound } from "lucide-react";

import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import {
  FieldTechnicianSelector,
  NO_FIELD_TECHNICIAN,
} from "@/components/professional/professional-selector";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  useAddOperationAuxiliary,
  useRemoveOperationAuxiliary,
  useReplaceOperationResponsible,
} from "@/hooks/operations/use-operations";
import { formatDateTime } from "@/lib/formatters";
import { actionAuthority } from "@/registry";
import type { Operation, OperationListItem } from "@/types/operations";

/** Linha de pessoa: nome à esquerda, contexto e ação à direita. */
function TeamRow({
  name,
  detail,
  action,
}: {
  name: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <UserRound
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0">
          {/** Nome longo trunca; a linha não empurra o painel. */}
          <p className="truncate text-sm font-medium">{name}</p>
          {detail ? (
            <p className="truncate text-xs text-muted-foreground">{detail}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function OperationTeamPanel({
  operation,
}: {
  operation: Operation | OperationListItem;
}) {
  const authority = actionAuthority(operation.allowedActions);
  const canManage = authority.permits("MANAGE_ASSIGNMENTS");

  const replace = useReplaceOperationResponsible(operation.id);
  const addAuxiliary = useAddOperationAuxiliary(operation.id);
  const removeAuxiliary = useRemoveOperationAuxiliary(operation.id);

  const [promoting, setPromoting] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [removing, setRemoving] = useState<{
    userId: string;
    name: string;
  } | null>(null);

  const responsible = operation.responsibleFieldTechnician;
  const auxiliaries = operation.auxiliaryTechnicians;

  /** Quem já está na equipe não é oferecido de novo. */
  const assigned = [
    ...(responsible ? [responsible.id] : []),
    ...auxiliaries.map((entry) => entry.userId),
  ];

  const error =
    replace.error ?? addAuxiliary.error ?? removeAuxiliary.error ?? null;

  return (
    <section className="space-y-4" aria-labelledby="operation-team">
      <div className="flex items-center justify-between gap-3">
        <h3 id="operation-team" className="text-sm font-semibold">
          Equipe
        </h3>
      </div>

      {/* -------------------------------------------------------- */}
      {/* Responsável                                               */}
      {/* -------------------------------------------------------- */}
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Responsável
        </p>
        {responsible ? (
          <TeamRow
            name={responsible.displayName}
            action={
              canManage ? (
                <FieldTechnicianSelector
                  businessUnitId={operation.businessUnit.id}
                  excludeUserIds={[responsible.id]}
                  emptyLabel={NO_FIELD_TECHNICIAN}
                  disabled={replace.isPending}
                  onSelect={(candidate) => replace.mutate(candidate.id)}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={replace.isPending}
                  >
                    {replace.isPending ? "Trocando…" : "Trocar"}
                  </Button>
                </FieldTechnicianSelector>
              ) : null
            }
          />
        ) : (
          <div className="flex items-center justify-between gap-3 py-1.5">
            <p className="text-sm text-muted-foreground">
              Nenhum responsável definido.
            </p>
            {canManage ? (
              <FieldTechnicianSelector
                businessUnitId={operation.businessUnit.id}
                excludeUserIds={assigned}
                emptyLabel={NO_FIELD_TECHNICIAN}
                disabled={replace.isPending}
                onSelect={(candidate) => replace.mutate(candidate.id)}
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={replace.isPending}
                >
                  <Plus className="size-3.5" />
                  Definir responsável
                </Button>
              </FieldTechnicianSelector>
            ) : null}
          </div>
        )}
      </div>

      <Separator />

      {/* -------------------------------------------------------- */}
      {/* auxiliares técnico                                        */}
      {/* -------------------------------------------------------- */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            auxiliares técnico
          </p>
          {canManage ? (
            <FieldTechnicianSelector
              businessUnitId={operation.businessUnit.id}
              excludeUserIds={assigned}
              emptyLabel={NO_FIELD_TECHNICIAN}
              disabled={addAuxiliary.isPending}
              onSelect={(candidate) => addAuxiliary.mutate(candidate.id)}
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={addAuxiliary.isPending}
              >
                <Plus className="size-3.5" />
                {addAuxiliary.isPending ? "Adicionando…" : "Adicionar"}
              </Button>
            </FieldTechnicianSelector>
          ) : null}
        </div>

        {auxiliaries.length === 0 ? (
          <p className="py-1.5 text-sm text-muted-foreground">
            Nenhum auxiliar técnico neste atendimento.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {auxiliaries.map((entry) => (
              <li key={entry.userId}>
                <TeamRow
                  name={entry.user.displayName}
                  detail={`Desde ${formatDateTime(entry.assignedAt)}`}
                  action={
                    canManage ? (
                      <span className="flex items-center gap-1">
                        {/**
                         * Promover é **trocar o responsável**.
                         *
                         * O servidor retira a pessoa dos auxiliares e a promove
                         * na mesma transação. Fazer isso aqui com duas chamadas
                         * abriria uma janela em que ela é as duas coisas — o
                         * estado que o domínio proíbe.
                         */}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={replace.isPending}
                          onClick={() =>
                            setPromoting({
                              userId: entry.userId,
                              name: entry.user.displayName,
                            })
                          }
                        >
                          <ArrowUpCircle className="size-3.5" />
                          Promover
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover ${entry.user.displayName} dos auxiliares`}
                          disabled={removeAuxiliary.isPending}
                          onClick={() =>
                            setRemoving({
                              userId: entry.userId,
                              name: entry.user.displayName,
                            })
                          }
                        >
                          <UserMinus className="size-4" />
                        </Button>
                      </span>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* -------------------------------------------------------- */}
      {/* Execução — histórico, não atribuição                      */}
      {/* -------------------------------------------------------- */}
      {operation.startedBy || operation.completedBy ? (
        <>
          <Separator />
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Execução
            </p>
            {operation.startedBy ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Iniciado por </span>
                {operation.startedBy.displayName}
                {operation.startedAt ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDateTime(operation.startedAt)}
                  </span>
                ) : null}
              </p>
            ) : null}
            {operation.completedBy ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Concluído por </span>
                {operation.completedBy.displayName}
                {operation.completedAt ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDateTime(operation.completedAt)}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <MutationError error={error} />

      <ConfirmDialog
        open={promoting !== null}
        onOpenChange={(open) => {
          if (!open) setPromoting(null);
        }}
        title="Promover a responsável"
        body={`${promoting?.name ?? ""} passará a ser o responsável pelo atendimento e deixará a lista de auxiliares.`}
        confirmLabel="Promover"
        isPending={replace.isPending}
        onConfirm={() => {
          if (promoting) {
            replace.mutate(promoting.userId, {
              onSuccess: () => setPromoting(null),
            });
          }
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remover auxiliar"
        body={`${removing?.name ?? ""} deixará de acompanhar este atendimento.`}
        confirmLabel="Remover"
        isPending={removeAuxiliary.isPending}
        onConfirm={() => {
          if (removing) {
            removeAuxiliary.mutate(removing.userId, {
              onSuccess: () => setRemoving(null),
            });
          }
        }}
      />
    </section>
  );
}
