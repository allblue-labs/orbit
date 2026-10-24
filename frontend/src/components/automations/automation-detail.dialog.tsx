"use client";

/**
 * Uma regra por inteiro: a frase, o alcance e o que ela já fez.
 *
 * ## O histórico é o do servidor
 *
 * `GET /automations/executions?ruleId=` publica cada ação agendada com
 * `status`, `attempts`, `scheduledFor`, `executedAt`, `detail` e o registro
 * criado. **Nada aqui é inferido da configuração**: uma regra com prazo de seis
 * meses não "vai executar em fevereiro" porque a tela somou seis meses — ela
 * mostra a data que o servidor gravou quando agendou.
 *
 * ## O que o contrato não publica
 *
 * O estado do **job** — retry pendente, backoff, dead-letter — não sai por esta
 * API: `attempts` conta as tentativas e `FAILED` diz que a última não deu
 * certo, e é até onde a leitura honesta vai. A tela diz isso em vez de
 * desenhar um "reprocessando" que ninguém confirmou.
 */
import { PanelError, PanelLoading } from "@/components/panels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAutomationExecutions } from "@/hooks/automations/use-automations";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { AutomationCatalog, AutomationRule } from "@/types/automations";
import type { ScopeUnit } from "./automation-fields";
import {
  AutomationSentence,
  ExecutionStatusBadge,
  RuleStateBadge,
  ScopeBadge,
} from "./automation-sentence";

export function AutomationDetailDialog({
  rule,
  catalog,
  units,
  open,
  onOpenChange,
}: {
  rule: AutomationRule;
  catalog: AutomationCatalog;
  units: readonly ScopeUnit[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { formatDateTime } = useDateFormatters();
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule.name}</DialogTitle>
          <DialogDescription>
            {rule.description ?? "Sem descrição."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <RuleStateBadge enabled={rule.enabled} />
          <ScopeBadge businessUnit={rule.businessUnit} />
          <span className="text-xs text-muted-foreground">
            Criada por {rule.createdBy.displayName} · alterada em{" "}
            {formatDateTime(rule.updatedAt)}
          </span>
        </div>

        <div className="rounded-lg border border-border p-3">
          <AutomationSentence
            rule={rule}
            entityType={
              catalog.triggers.find((item) => item.type === rule.trigger)
                ?.entityType ?? ""
            }
            actionDefinitions={catalog.actions}
            units={units}
          />
        </div>

        <ExecutionHistory ruleId={rule.id} />
      </DialogContent>
    </Dialog>
  );
}

function ExecutionHistory({ ruleId }: { ruleId: string }) {
  const { formatDateTime } = useDateFormatters();
  const executions = useAutomationExecutions({ ruleId, limit: 20 });

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">O que esta regra já fez</h3>
        <p className="text-xs text-muted-foreground">
          Cada linha é uma ação agendada por um acontecimento. As 20 mais
          recentes.
        </p>
      </div>

      {executions.isPending ? (
        <PanelLoading rows={3} />
      ) : executions.error ? (
        <PanelError
          error={executions.error}
          onRetry={() => void executions.refetch()}
        />
      ) : (executions.data?.data.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          Ainda não aconteceu nada que casasse com esta regra. Uma regra
          recém-criada só age sobre acontecimentos{" "}
          <strong>daqui para a frente</strong> — eventos passados não são
          reavaliados.
        </p>
      ) : (
        <ul className="space-y-2">
          {executions.data?.data.map((execution) => (
            <li
              key={execution.id}
              className="space-y-1 rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ExecutionStatusBadge status={execution.status} />
                  <span className="text-sm">{execution.actionType}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {execution.event.type} ·{" "}
                  {formatDateTime(execution.event.occurredAt)}
                </span>
              </div>

              <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                {execution.scheduledFor ? (
                  <div className="flex gap-2">
                    <dt>Prevista para</dt>
                    <dd className="text-foreground">
                      {formatDateTime(execution.scheduledFor)}
                    </dd>
                  </div>
                ) : null}
                {execution.executedAt ? (
                  <div className="flex gap-2">
                    <dt>Executada em</dt>
                    <dd className="text-foreground">
                      {formatDateTime(execution.executedAt)}
                    </dd>
                  </div>
                ) : null}
                {execution.attempts > 1 ? (
                  <div className="flex gap-2">
                    <dt>Tentativas</dt>
                    <dd className="text-foreground">{execution.attempts}</dd>
                  </div>
                ) : null}
                {execution.result ? (
                  <div className="flex gap-2">
                    <dt>Criou</dt>
                    <dd className="text-foreground">{execution.result.type}</dd>
                  </div>
                ) : null}
              </dl>

              {execution.detail ? (
                <p className="text-xs text-muted-foreground">
                  {execution.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        O contrato publica a situação da <strong>ação</strong>. O estado interno
        da fila — nova tentativa em andamento, backoff, descarte definitivo —
        não é publicado, e esta tela não o adivinha.
      </p>
    </section>
  );
}
