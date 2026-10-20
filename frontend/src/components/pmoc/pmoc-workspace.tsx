"use client";

/**
 * O detalhe de um PMOC.
 *
 * As abas são os quatro conceitos do domínio, na ordem em que se pensa neles:
 *
 * ```text
 * Visão geral → o contrato: cliente, periodicidade, RT, conformidade
 * Cobertura   → quais equipamentos
 * Execuções   → as competências do plano, e os equipamentos de cada uma
 * Histórico   → o que aconteceu
 * ```
 *
 * Não há "Gerar PDF" em lugar nenhum desta tela: **configuração não é
 * documento**. O PMOC emitido pertence a cada equipamento executado, e é de lá
 * que se chega até ele.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PanelError } from "@/components/panels";
import { Button } from "@/components/ui/button";
import {
  ComplianceBadge,
  PlanStatusBadge,
} from "@/components/pmoc/pmoc-presentation";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePmocPlan } from "@/hooks/pmoc/use-pmoc";
import { formatDate } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import type { PmocPlan } from "@/types/pmoc";
import { TabBoundary } from "@/workspace";
import { PmocCoveragePanel } from "./pmoc-coverage";
import { PmocPlanActions } from "./pmoc-plan-actions";
import { PmocCyclesPanel } from "./pmoc-cycles";
import { PmocTimelinePanel } from "./pmoc-timeline";

export function PmocWorkspace({ planId }: { planId: string }) {
  const plan = usePmocPlan(planId);

  if (plan.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (plan.error) {
    return (
      <PanelError error={plan.error} onRetry={() => void plan.refetch()} />
    );
  }

  if (!plan.data) return null;

  return (
    <div className="space-y-5">
      <PlanHeader plan={plan.data} />

      <Tabs defaultValue="visao-geral">
        <TabsList>
          <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
          <TabsTrigger value="cobertura">Cobertura</TabsTrigger>
          <TabsTrigger value="execucoes">Execuções</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral">
          <PlanOverview plan={plan.data} />
        </TabsContent>

        <TabsContent value="cobertura">
          <TabBoundary id="pmoc-coverage" label="a cobertura">
            <PmocCoveragePanel
              planId={planId}
              customerId={plan.data.customer.id}
              businessUnitId={plan.data.businessUnit.id}
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="execucoes">
          <TabBoundary id="pmoc-cycles" label="as execuções">
            <PmocCyclesPanel planId={planId} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="historico">
          <TabBoundary id="pmoc-timeline" label="o histórico">
            <PmocTimelinePanel planId={planId} />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlanHeader({ plan }: { plan: PmocPlan }) {
  return (
    <header className="space-y-3 rounded-xl border border-border p-4">
      {/*
        A volta é explícita, e não só a trilha.

        Esta tela é alcançada por link direto — de um atendimento, de um
        documento, de um aviso. Quem chega assim não tem para onde voltar no
        histórico do navegador que faça sentido no produto.
      */}
      <Button variant="ghost" size="sm" className="-ml-2" asChild>
        <Link href={ROUTES.pmoc}>
          <ArrowLeft className="size-4" />
          Planos de PMOC
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{plan.name}</h2>
          <p className="font-mono text-xs text-muted-foreground">{plan.code}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlanStatusBadge status={plan.status} />
          <ComplianceBadge status={plan.compliance.status} />
          <PmocPlanActions plan={plan} />
        </div>
      </div>

      {/**
       * O aviso é sobre o **estado publicado**, não sobre autorização.
       *
       * Ele explica o que a situação significa — quem decide se uma execução
       * está bloqueada é `execution-preparation`, e é de lá que sai o motivo
       * mostrado em cada equipamento. Isto aqui é contexto, não regra.
       */}
      {plan.status === "SUSPENDED" ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          Plano suspenso: novas execuções não são abertas e as já abertas ficam
          indisponíveis até a reativação. O histórico permanece.
        </p>
      ) : null}

      {plan.status === "CANCELLED" ? (
        <p className="rounded-lg bg-surface-strong px-3 py-2 text-xs text-muted-foreground">
          Plano encerrado definitivamente. Execuções cumpridas e documentos
          emitidos permanecem disponíveis para consulta.
        </p>
      ) : null}
    </header>
  );
}

function PlanOverview({ plan }: { plan: PmocPlan }) {
  const fields: readonly { label: string; value: string }[] = [
    { label: "Cliente", value: plan.customer.name },
    /*
      "Unidade de negócio", não "Unidade": desde que o plano declara unidades
      atendidas — condensadora, evaporadora —, o rótulo curto apontaria para
      duas coisas diferentes na mesma tela.
    */
    { label: "Unidade de negócio", value: plan.businessUnit.name },
    { label: "Periodicidade", value: plan.frequency.label },
    {
      label: "Vigência",
      value: `${formatDate(plan.validity.startsOn)}${
        plan.validity.endsOn ? ` até ${formatDate(plan.validity.endsOn)}` : ""
      }`,
    },
    {
      label: "Próximo vencimento",
      value: plan.compliance.nextDueOn
        ? formatDate(plan.compliance.nextDueOn)
        : "—",
    },
    {
      label: "Última execução",
      value: plan.compliance.lastExecutedAt
        ? formatDate(plan.compliance.lastExecutedAt)
        : "Nenhuma",
    },
    { label: "Equipamentos cobertos", value: String(plan.coveredEquipment) },
    {
      label: "Responsável Técnico",
      value: plan.technicalResponsible?.displayName ?? "Não definido",
    },
    {
      label: "Técnico em Campo",
      value: plan.technician?.displayName ?? "Não definido",
    },
  ];

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{field.label}</dt>
            <dd className="truncate text-sm">{field.value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">Unidades atendidas</p>
        {plan.units.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Nenhuma declarada. O relatório sai sem o detalhamento por unidade.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {plan.units.map((unidade) => (
              <li key={unidade.id} className="text-sm">
                <span className="font-medium">{unidade.name}</span>
                <span className="text-muted-foreground">
                  {unidade.checklist
                    ? ` — ${unidade.checklist.name} · ${
                        unidade.checklist.items.length
                      } ${
                        unidade.checklist.items.length === 1 ? "item" : "itens"
                      }`
                    : " — sem roteiro"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.notes ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Observações</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{plan.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
