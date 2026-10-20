"use client";

/**
 * Abas de registros do cliente: Operações, Execuções e Documentos.
 *
 * As três têm a mesma forma — uma listagem do módulo dono, recortada por
 * `customerId` pelo **servidor**, com navegação para o Workspace de origem.
 * O que muda entre elas são as colunas e o destino.
 *
 * Nenhuma delas duplica lógica do módulo dono: status, progresso e estado de
 * renderização vêm dos registries que já os apresentam em outras telas.
 */
import Link from "next/link";
import { ArrowRight, ClipboardCheck, FileStack, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExecutionProgress,
  ExecutionStatusBadge,
  RenderStatusBadge,
} from "@/components/artifact-executions/execution-badges";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { UserReference } from "@/components/identity/user-reference";
import { EntityBadge, entityHref } from "@/entities";
import {
  useCustomerExecutionsList,
  useCustomerOperationsList,
} from "@/hooks/customers/use-customers";
import { formatDateTime } from "@/lib/formatters";
import type { ArtifactExecutionQuery } from "@/types/artifact-executions";
import type { OperationQuery } from "@/types/operations";
import {
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/* Operações                                                           */
/* ------------------------------------------------------------------ */

export function OperationsTab({ customerId }: { customerId: string }) {
  const list = useListController<OperationQuery>({ limit: 10 });
  const query = useCustomerOperationsList(customerId, list.query);

  const operations = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField
          id="customer-operations-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Código, título ou descrição"
          className="min-w-64 flex-1"
        />
        <ResultSummary meta={meta} noun="operação" gender="f" />
      </div>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={operations}
        rows={4}
        empty={{
          icon: <Workflow className="size-5" />,
          title: "Nenhuma operação para este cliente",
          description:
            "As ordens de serviço aparecem aqui assim que forem criadas com este cliente vinculado.",
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Agendamento</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((operation) => {
                  const href = entityHref("operation", operation.id) ?? "#";
                  return (
                    <TableRow key={operation.id}>
                      <TableCell>
                        <Link
                          href={href}
                          className="font-medium hover:underline"
                        >
                          {operation.title}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {operation.code}
                        </p>
                      </TableCell>
                      <TableCell>
                        <EntityBadge
                          entity="operation"
                          group="status"
                          value={operation.status}
                        />
                      </TableCell>
                      <TableCell>
                        {/*
                          A operação publica a equipe embutida
                          (`users[].user.displayName`), então o nome vem do
                          próprio Read Model — sem consulta extra.
                        */}
                        {operation.users.length > 0 ? (
                          <span className="text-sm">
                            {operation.users
                              .map((assignment) => assignment.user.displayName)
                              .join(", ")}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            sem atribuição
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {operation.scheduledStart
                          ? formatDateTime(operation.scheduledStart)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" asChild>
                          <Link
                            href={href}
                            aria-label={`Abrir ${operation.title}`}
                          >
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Execuções                                                           */
/* ------------------------------------------------------------------ */

export function ExecutionsTab({ customerId }: { customerId: string }) {
  const list = useListController<ArtifactExecutionQuery>({ limit: 10 });
  const query = useCustomerExecutionsList(customerId, list.query);

  const executions = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField
          id="customer-executions-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Código ou título"
          className="min-w-64 flex-1"
        />
        <ResultSummary meta={meta} noun="execução" gender="f" />
      </div>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={executions}
        rows={4}
        empty={{
          icon: <ClipboardCheck className="size-5" />,
          title: "Nenhuma execução para este cliente",
          description:
            "PMOCs, ordens de serviço e checklists preenchidos aparecem aqui.",
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Execução</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-36">Progresso</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((execution) => {
                  const href =
                    entityHref("artifact-execution", execution.id) ?? "#";
                  return (
                    <TableRow key={execution.id}>
                      <TableCell>
                        <Link
                          href={href}
                          className="font-medium hover:underline"
                        >
                          {execution.title}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {execution.code}
                        </p>
                      </TableCell>
                      <TableCell>
                        <ExecutionStatusBadge status={execution.status} />
                      </TableCell>
                      <TableCell>
                        <ExecutionProgress percentage={execution.progress} />
                      </TableCell>
                      <TableCell>
                        {/*
                          A execução publica só `responsibleUserId`; o nome vem
                          do contrato de membros, numa consulta compartilhada
                          por toda a aplicação.
                        */}
                        <UserReference userId={execution.responsibleUserId} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" asChild>
                          <Link
                            href={href}
                            aria-label={`Abrir ${execution.title}`}
                          >
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

/**
 * Documentos do cliente.
 *
 * ## Por que a lista parte das execuções
 *
 * **Não existe listagem global de manifests**, e muito menos filtrada por
 * cliente: o backend publica revisões sempre sob uma execução
 * (`GET /artifact-executions/:id/manifests`) — decisão da PR-19 de não criar
 * endpoint administrativo. A mesma restrição que moldou o Document Center vale
 * aqui, e a solução é a mesma: partir das execuções do cliente e abrir as
 * revisões de cada uma.
 *
 * Reaproveita o `DocumentViewer` do Document Center — preview, revisões e
 * download com URL assinada, sem uma segunda implementação.
 */
export function DocumentsTab({ customerId }: { customerId: string }) {
  const list = useListController<ArtifactExecutionQuery>({ limit: 10 });
  const query = useCustomerExecutionsList(customerId, list.query);
  const [selected, setSelected] = useState<string | null>(null);

  const executions = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField
          id="customer-documents-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Código ou título da execução"
          hint="A lista de documentos por cliente ainda não está disponível: a busca é pelo atendimento que os emitiu."
          className="min-w-64 flex-1"
        />
        <ResultSummary meta={meta} noun="execução" gender="f" />
      </div>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={executions}
        rows={4}
        empty={{
          icon: <FileStack className="size-5" />,
          title: "Nenhum documento para este cliente",
          description:
            "Os documentos aparecem depois que uma execução deste cliente é submetida e renderizada.",
        }}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Execução</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Atualizado</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell>
                      <p className="font-medium">{execution.title}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {execution.code}
                      </p>
                    </TableCell>
                    <TableCell>
                      <RenderStatusBadge status={execution.renderStatus} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(execution.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(execution.id)}
                      >
                        Abrir
                      </Button>
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
        isFetching={query.isFetching}
      />

      <DocumentViewer
        executionId={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
