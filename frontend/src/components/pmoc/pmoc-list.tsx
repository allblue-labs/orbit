"use client";

/**
 * A lista de **configurações** de PMOC.
 *
 * Cada linha é um contrato de manutenção — não uma execução dele. O
 * que se lê aqui é: para quem, em que unidade, com que periodicidade, sob
 * responsabilidade de quem, e como está a conformidade.
 *
 * "Atrasado" e "Vence em breve" vêm de `compliance`, calculado pelo servidor
 * contra a data dele. A tela nunca compara `dueOn` com `new Date()`: o
 * relógio do navegador está no fuso de quem abriu, e o vencimento é do fuso da
 * unidade — duas pessoas veriam estados diferentes do mesmo plano.
 */
import { ClipboardCheck, ClipboardList, Plus } from "lucide-react";
import Link from "next/link";

import {
  ComplianceBadge,
  PlanStatusBadge,
} from "@/components/pmoc/pmoc-presentation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePmocPlans } from "@/hooks/pmoc/use-pmoc";
import { formatDate } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { PROFESSIONAL_ROLES } from "@/registry";
import { PmocPlanRowActions } from "./pmoc-plan-row-actions";
import { PLAN_STATUS } from "@/registry";
import { useSession } from "@/providers/session-provider";
import type { PmocPlanQuery } from "@/types/pmoc";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";

const STATUS_OPTIONS = Object.entries(PLAN_STATUS).map(([value, entry]) => ({
  value,
  label: entry.label,
}));

export function PmocList({ onCreate }: { onCreate: () => void }) {
  const session = useSession();
  const canManage = session.hasPermission("pmoc.manage");
  const controller = useListController<PmocPlanQuery>();
  const plans = usePmocPlans(controller.query);

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField
          id="pmoc-search"
          value={controller.searchTerm}
          onChange={controller.setSearchTerm}
          label="Buscar"
          placeholder="Código, nome ou cliente"
          hint="A busca considera todos os planos, não apenas esta página."
        />
        <FilterSelect
          id="pmoc-status"
          label="Situação"
          value={controller.query.status ?? ""}
          onChange={(value) => controller.setFilter("status", value)}
          options={STATUS_OPTIONS}
        />
        <Button variant="ghost" size="sm" onClick={controller.reset}>
          Limpar
        </Button>
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={plans.data?.meta}
          noun="configuração de PMOC"
          gender="f"
          note="Ordenado pelo próximo vencimento."
        />
        <div className="flex flex-wrap items-center gap-2">
          {/*
            O cadastro de unidades fica aqui porque é pré-requisito do
            assistente: quem chega para criar o primeiro plano e não tem
            unidade alguma precisa de um caminho visível, não de descobrir a
            rota pelo estado vazio de uma etapa adiante.
          */}
          {canManage ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`${ROUTES.catalogs}?secao=pmoc`}>
                <ClipboardList className="size-3.5" />
                Unidades
              </Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button size="sm" onClick={onCreate}>
              <Plus className="size-3.5" />
              Novo PMOC
            </Button>
          ) : null}
        </div>
      </div>

      <ListState
        isPending={plans.isPending}
        error={plans.error}
        onRetry={() => void plans.refetch()}
        items={plans.data?.data ?? []}
        empty={{
          icon: <ClipboardCheck className="size-5" />,
          title: "Nenhum PMOC configurado",
          description:
            "Um PMOC define a cobertura de equipamentos, a periodicidade e o Responsável Técnico do contrato de manutenção.",
          action: canManage ? (
            <Button size="sm" onClick={onCreate}>
              <Plus className="size-3.5" />
              Novo PMOC
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead>Equipamentos</TableHead>
                  <TableHead>
                    {PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.label}
                  </TableHead>
                  <TableHead>Próximo vencimento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <Link
                        href={`${ROUTES.pmoc}/${plan.id}`}
                        className="block max-w-[16rem] truncate font-medium hover:underline"
                      >
                        {plan.name}
                      </Link>
                      <span className="font-mono text-xs text-muted-foreground">
                        {plan.code}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">
                      {plan.customer.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {plan.frequency.label}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {plan.coveredEquipment}
                    </TableCell>
                    {/*
                      A coluna mostrava `technician` — o Técnico Operacional — sob o
                      título "Responsável Técnico". Dois papéis, um com o nome do
                      outro, e num PMOC a diferença é concreta: um executa no
                      cliente, o outro responde pelo contrato e assina o documento.

                      Agora mostra o Responsável Técnico, com quem executa embaixo:
                      a listagem de contrato pergunta primeiro quem responde por ele.
                    */}
                    <TableCell className="max-w-[12rem] text-sm">
                      <span className="block truncate">
                        {plan.technicalResponsible?.displayName ?? (
                          <span className="text-muted-foreground">
                            Não definido
                          </span>
                        )}
                      </span>
                      {plan.technician ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {`Campo: ${plan.technician.displayName}`}
                        </span>
                      ) : null}
                    </TableCell>
                    {/*
                      Sem data, só o selo.

                      A célula imprimia um travessão **e** o selo "Sem vencimento":
                      duas formas de dizer a mesma ausência, uma delas um traço largo
                      que parecia defeito de renderização. O selo já é a resposta; a
                      data só aparece quando existe.
                    */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {plan.compliance.nextDueOn ? (
                          <span className="text-sm tabular-nums">
                            {formatDate(plan.compliance.nextDueOn)}
                          </span>
                        ) : null}
                        <ComplianceBadge status={plan.compliance.status} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <PlanStatusBadge status={plan.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PmocPlanRowActions plan={plan} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <Pagination
        meta={plans.data?.meta}
        onPrevious={controller.previousPage}
        onNext={controller.nextPage}
        isFetching={plans.isFetching}
      />
    </div>
  );
}
