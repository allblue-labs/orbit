"use client";

/**
 * A configuração da comissão.
 *
 * ## O que a tela pergunta, e por que nessa ordem
 *
 * Primeiro **como** se calcula (fixo ou percentual), porque isso muda o
 * significado dos dois valores seguintes — 50 é cinquenta reais num caso e
 * cinquenta por cento no outro. Depois **quanto** para cada papel, porque
 * responsável e auxiliar são combinações diferentes. Depois **quais**
 * atendimentos entram. Por último a chave de ligar, que é a única coisa
 * irreversível no sentido de que passa a gerar valor a pagar.
 *
 * ## O interruptor fica embaixo
 *
 * Ligar antes de configurar produziria uma política ativa valendo zero — que o
 * servidor recusa, e cuja recusa seria a primeira coisa que alguém veria nesta
 * tela.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useCommissionPolicy,
  useSaveCommissionPolicy,
} from "@/hooks/commissions/use-commissions";
import type { CommissionPolicy } from "@/types/commissions";
import {
  COMMISSION_MODE_LABELS,
  COMMISSION_MODES,
  COMMISSION_PERIOD_LABELS,
  COMMISSION_PERIODS,
  type CommissionMode,
  type CommissionPeriod,
} from "@/types/commissions";
import { OPERATION_KIND_LABELS } from "@/types/operations";
import { OperationKind } from "@/types/contracts";
import { cn } from "@/lib/utils";

export function CommissionPolicySection({ canManage }: { canManage: boolean }) {
  const query = useCommissionPolicy();

  if (query.isPending) {
    return (
      <PanelFrame
        panelId="commission-policy"
        title="Como a comissão é calculada"
        description="Carregando a configuração"
      >
        <PanelLoading rows={4} />
      </PanelFrame>
    );
  }

  if (query.error || !query.data) {
    return (
      <PanelFrame
        panelId="commission-policy"
        title="Como a comissão é calculada"
        description="Regras combinadas com a equipe"
      >
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      </PanelFrame>
    );
  }

  /*
   * A `key` remonta o formulário quando a política salva muda.
   *
   * O estado dos campos nasce da política carregada e morre com ela. Semear com
   * `useEffect` sobrescreveria o que alguém está digitando na primeira
   * revalidação em segundo plano — e a política é `CACHE.catalog`, que
   * revalida.
   */
  return (
    <Form
      key={query.data.updatedAt ?? "nova"}
      policy={query.data}
      canManage={canManage}
    />
  );
}

function Form({
  policy,
  canManage,
}: {
  policy: CommissionPolicy;
  canManage: boolean;
}) {
  const save = useSaveCommissionPolicy();

  const [period, setPeriod] = useState<CommissionPeriod>(policy.period);
  const [mode, setMode] = useState<CommissionMode>(policy.mode);
  const [primaryValue, setPrimaryValue] = useState(String(policy.primaryValue));
  const [assistantValue, setAssistantValue] = useState(
    String(policy.assistantValue),
  );
  const [kinds, setKinds] = useState<string[]>([...policy.eligibleKinds]);
  const [requiresRevenue, setRequiresRevenue] = useState(
    policy.requiresConfirmedRevenue,
  );
  const [active, setActive] = useState(policy.active);

  const sufixo = mode === "PERCENTAGE" ? "%" : "R$";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    save.mutate({
      period,
      mode,
      primaryValue: Number(primaryValue.replace(",", ".")) || 0,
      assistantValue: Number(assistantValue.replace(",", ".")) || 0,
      eligibleKinds: kinds,
      requiresConfirmedRevenue: requiresRevenue,
      active,
    });
  };

  return (
    <PanelFrame
      panelId="commission-policy"
      title="Como a comissão é calculada"
      description="Vale para toda a equipe, e muda só o que ainda não foi pago"
      actions={
        policy.configured ? (
          <Badge variant={policy.active ? "secondary" : "outline"}>
            {policy.active ? "ativa" : "desligada"}
          </Badge>
        ) : (
          <Badge variant="outline">não configurada</Badge>
        )
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="commission-mode">Forma de cálculo</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as CommissionMode)}
              disabled={!canManage}
            >
              <SelectTrigger id="commission-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_MODES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {COMMISSION_MODE_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {mode === "FIXED"
                ? "Cada atendimento concluído paga o mesmo valor."
                : "O valor é uma fatia da receita confirmada do atendimento."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="commission-period">Fechamento</Label>
            <Select
              value={period}
              onValueChange={(value) => setPeriod(value as CommissionPeriod)}
              disabled={!canManage}
            >
              <SelectTrigger id="commission-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_PERIODS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {COMMISSION_PERIOD_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {period === "BIWEEKLY"
                ? "Do dia 1 ao 15, e do 16 ao fim do mês."
                : period === "WEEKLY"
                  ? "De segunda a domingo."
                  : "Do primeiro ao último dia do mês."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="commission-primary">
              Técnico responsável ({sufixo})
            </Label>
            <Input
              id="commission-primary"
              inputMode="decimal"
              value={primaryValue}
              onChange={(event) => setPrimaryValue(event.target.value)}
              disabled={!canManage}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="commission-assistant">Auxiliar ({sufixo})</Label>
            <Input
              id="commission-assistant"
              inputMode="decimal"
              value={assistantValue}
              onChange={(event) => setAssistantValue(event.target.value)}
              disabled={!canManage}
            />
            <p className="text-xs text-muted-foreground">
              Zero significa que o auxiliar não recebe comissão.
            </p>
          </div>
        </div>

        <fieldset className="space-y-2" disabled={!canManage}>
          <legend className="text-sm font-medium">
            Atendimentos que geram comissão
          </legend>
          <p className="text-xs text-muted-foreground">
            Nenhum marcado significa todos.
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.values(OperationKind).map((kind) => {
              const marcado = kinds.includes(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() =>
                    setKinds((atual) =>
                      atual.includes(kind)
                        ? atual.filter((item) => item !== kind)
                        : [...atual, kind],
                    )
                  }
                  disabled={!canManage}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    marcado
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {OPERATION_KIND_LABELS[kind] ?? kind}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-3 rounded-lg border border-border p-3">
          <label className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                Só com receita confirmada
              </span>
              <span className="block text-xs text-muted-foreground">
                {mode === "PERCENTAGE"
                  ? "No percentual é obrigatório: sem receita não há base de cálculo."
                  : "Desligado, o atendimento concluído paga comissão mesmo antes de o cliente pagar."}
              </span>
            </span>
            <Switch
              checked={mode === "PERCENTAGE" ? true : requiresRevenue}
              onCheckedChange={setRequiresRevenue}
              disabled={!canManage || mode === "PERCENTAGE"}
              aria-label="Exigir receita confirmada"
            />
          </label>

          <label className="flex items-start justify-between gap-3 border-t border-border pt-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Comissão ativa</span>
              <span className="block text-xs text-muted-foreground">
                Desligada, nada é calculado e nada pode ser pago. O histórico
                continua.
              </span>
            </span>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              disabled={!canManage}
              aria-label="Ativar comissão"
            />
          </label>
        </div>

        <MutationError error={save.error} />

        {canManage ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar configuração"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Seu acesso permite consultar a comissão, não configurá-la.
          </p>
        )}
      </form>
    </PanelFrame>
  );
}
