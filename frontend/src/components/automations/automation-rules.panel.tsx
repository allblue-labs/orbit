"use client";

/**
 * As regras da organização.
 *
 * Cada linha é uma frase curta — nome, o que dispara, onde vale, e se está
 * ligada. A frase inteira fica no detalhe: uma listagem que mostrasse
 * condições e ações de todas as regras vira um paredão, e ninguém acha a que
 * procura.
 *
 * ## O interruptor espera a resposta
 *
 * Ligar e desligar decide **se a regra vale**. Um `Switch` que vira na hora e
 * volta sozinho quando a requisição falha mente sobre a automação que está
 * valendo — e é o tipo de mentira que só se descobre quando o lembrete não
 * chega. Fica inerte até o servidor confirmar.
 *
 * ## O 409 da exclusão
 *
 * O backend recusa excluir regra com ação agendada e não executada. Não há
 * cópia dessa regra aqui: o botão é oferecido, a recusa chega com a explicação
 * do servidor e aparece dentro da confirmação, onde a decisão foi tomada.
 */
import { useState } from "react";
import { Copy, MoreHorizontal, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { PanelFrame } from "@/components/panels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/actions";
import {
  useAutomationRules,
  useDeleteAutomationRule,
  useDuplicateAutomationRule,
  useToggleAutomationRule,
} from "@/hooks/automations/use-automations";
import { formatDateTime } from "@/lib/formatters";
import type { AutomationCatalog, AutomationRule, AutomationRuleQuery } from "@/types/automations";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";
import type { ScopeUnit } from "./automation-fields";
import { AutomationDetailDialog } from "./automation-detail.dialog";
import { AutomationFormDialog } from "./automation-form.dialog";
import { RuleStateBadge, ScopeBadge } from "./automation-sentence";

const ENABLED_OPTIONS = [
  { value: "true", label: "Ativas" },
  { value: "false", label: "Desativadas" },
];

export function AutomationRulesPanel({
  catalog,
  units,
  canManage,
}: {
  catalog: AutomationCatalog;
  units: readonly ScopeUnit[];
  canManage: boolean;
}) {
  const list = useListController<AutomationRuleQuery>({ limit: 20 });
  const rules = useAutomationRules(list.query);

  const createAction = useAction("automation-rule.create");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [viewing, setViewing] = useState<AutomationRule | null>(null);

  return (
    <PanelFrame
      panelId="settings-automations-rules"
      title="Automações"
      description="Quando algo acontece, o Orbit faz o que você combinou."
      actions={
        canManage && createAction.allowed ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {createAction.label}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <FilterBar
          onClear={list.reset}
          canClear={list.isFiltered || Boolean(list.searchTerm)}
        >
          <SearchField
            id="automation-search"
            value={list.searchTerm}
            onChange={list.setSearchTerm}
            placeholder="Nome da automação"
            hint="A busca considera o nome e a descrição."
          />
          <FilterSelect
            id="automation-trigger-filter"
            label="Acontecimento"
            value={list.query.trigger}
            onChange={(value) => list.setFilter("trigger", value)}
            options={catalog.triggers.map((trigger) => ({
              value: trigger.type,
              label: trigger.label,
            }))}
          />
          <FilterSelect
            id="automation-unit-filter"
            label="Unidade"
            value={list.query.businessUnitId}
            onChange={(value) => list.setFilter("businessUnitId", value)}
            options={units.map((unit) => ({
              value: unit.id,
              label: unit.label,
            }))}
          />
          <FilterSelect
            id="automation-enabled-filter"
            label="Situação"
            value={
              list.query.enabled === undefined
                ? undefined
                : String(list.query.enabled)
            }
            onChange={(value) =>
              list.setFilter("enabled", value ? value === "true" : undefined)
            }
            options={ENABLED_OPTIONS}
          />
        </FilterBar>

        <ResultSummary meta={rules.data?.meta} noun="automação" gender="f" />

        <ListState
          isPending={rules.isPending}
          error={rules.error}
          onRetry={() => void rules.refetch()}
          items={rules.data?.data ?? []}
          empty={{
            title: list.isFiltered
              ? "Nenhuma automação neste recorte"
              : "Nenhuma automação ainda",
            description: list.isFiltered
              ? "Ajuste os filtros para ver outras regras."
              : "Uma automação faz o Orbit agir sozinho depois de um acontecimento — criar o lembrete da próxima preventiva, por exemplo.",
          }}
        >
          {(items) => (
            <ul className="space-y-2">
              {items.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  canManage={canManage}
                  onView={() => setViewing(rule)}
                  onEdit={() => setEditing(rule)}
                />
              ))}
            </ul>
          )}
        </ListState>

        <Pagination
          meta={rules.data?.meta}
          onPrevious={list.previousPage}
          onNext={list.nextPage}
          isFetching={rules.isFetching}
        />
      </div>

      <AutomationFormDialog
        catalog={catalog}
        units={units}
        open={creating}
        onOpenChange={setCreating}
      />
      {editing ? (
        <AutomationFormDialog
          catalog={catalog}
          rule={editing}
          units={units}
          open
          onOpenChange={(open) => setEditing(open ? editing : null)}
        />
      ) : null}
      {viewing ? (
        <AutomationDetailDialog
          rule={viewing}
          catalog={catalog}
          units={units}
          open
          onOpenChange={(open) => setViewing(open ? viewing : null)}
        />
      ) : null}
    </PanelFrame>
  );
}

function RuleRow({
  rule,
  canManage,
  onView,
  onEdit,
}: {
  rule: AutomationRule;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
}) {
  const toggle = useToggleAutomationRule();
  const duplicate = useDuplicateAutomationRule();
  const remove = useDeleteAutomationRule();
  const deleteAction = useAction("automation-rule.delete");
  const [confirming, setConfirming] = useState(false);

  const actionSummary =
    rule.actions.length === 1
      ? "1 ação"
      : `${rule.actions.length} ações`;
  const conditionSummary =
    rule.conditions.length === 0
      ? "sem condição"
      : rule.conditions.length === 1
        ? "1 condição"
        : `${rule.conditions.length} condições`;

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={onView}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate font-medium">{rule.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {rule.triggerLabel ?? rule.trigger} · {conditionSummary} ·{" "}
            {actionSummary}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RuleStateBadge enabled={rule.enabled} />
            <ScopeBadge businessUnit={rule.businessUnit} />
            <span className="text-xs text-muted-foreground">
              alterada em {formatDateTime(rule.updatedAt)}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <Switch
            checked={rule.enabled}
            disabled={!canManage || toggle.isPending}
            aria-label={rule.enabled ? "Desativar" : "Ativar"}
            onCheckedChange={(enabled) =>
              toggle.mutate({ id: rule.id, enabled })
            }
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mais ações">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onView}>
                <ScrollText className="size-4" />
                Ver e acompanhar
              </DropdownMenuItem>
              {canManage ? (
                <>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="size-4" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => duplicate.mutate(rule.id)}
                    disabled={duplicate.isPending}
                  >
                    <Copy className="size-4" />
                    Duplicar
                  </DropdownMenuItem>
                  {deleteAction.allowed ? (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        setConfirming(true);
                      }}
                    >
                      <Trash2 className="size-4" />
                      Excluir
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/*
        A recusa do toggle e da duplicação aparece na linha: são atos sem
        diálogo, e a mensagem precisa de um lugar para pousar.
      */}
      <MutationError error={toggle.error} className="mt-3" />
      <MutationError error={duplicate.error} className="mt-3" />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={deleteAction.confirm?.title ?? "Excluir esta automação?"}
        body={deleteAction.confirm?.body}
        confirmLabel={deleteAction.confirm?.confirmLabel ?? "Excluir"}
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(rule.id, { onSuccess: () => setConfirming(false) })
        }
      />
    </li>
  );
}
