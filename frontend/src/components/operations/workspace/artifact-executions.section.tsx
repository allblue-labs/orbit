"use client";

/**
 * As execuções de artefato desta operação.
 *
 * `ArtifactExecution` é o preenchimento de um artefato — o documento que a
 * equipe responde em campo. Nasce por quatro caminhos independentes, e a
 * operação é um deles: `GET /artifact-executions?operationId=` é contrato
 * publicado, e é o recorte que esta seção usa.
 *
 * **Não é a seção de checklists.** `ChecklistExecution` é outro conceito, com
 * contrato próprio, e continua onde estava. As duas convivem porque são coisas
 * diferentes, e juntá-las apagaria a diferença.
 *
 * O recorte vai para o servidor: a consulta já sai filtrada por esta operação,
 * em vez de trazer a organização inteira para peneirar no cliente.
 *
 * Não há "Ver tudo": a listagem global de execuções deixou de existir, e um
 * link para uma lista sem o filtro pareceria um recorte que não valeu.
 */
import { RelatedRecordsPanel } from "@/entities/related-records";
import { useOperationArtifactExecutions } from "@/hooks/operations/use-operations";
import { useState } from "react";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { EntityLink } from "@/entities/entity-components";
import { OperationReportDownload } from "./report-download";

export function OperationArtifactExecutionsSection({
  operationId,
  completed = false,
}: {
  operationId: string;
  completed?: boolean;
}) {
  const [page, setPage] = useState(1);
  const query = useOperationArtifactExecutions(operationId, page);

  if (completed)
    return (
      <PanelFrame
        panelId="operation-reports"
        title="Relatórios do atendimento"
        description="Documentos gerados nesta operação, incluindo OS, RVT e outros relatórios."
      >
        <PanelState
          query={toPanelQuery(query)}
          isEmpty={(result) => result.data.length === 0}
          emptyMessage="Nenhum relatório foi gerado para esta operação."
        >
          {(result) => (
            <div className="space-y-4">
              <ul className="space-y-3">
                {result.data.map((execution) => (
                  <li
                    key={execution.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <EntityLink
                        entity="artifact-execution"
                        id={execution.id}
                        className="text-sm font-medium"
                      >
                        {execution.title}
                      </EntityLink>
                      <p className="text-xs text-muted-foreground">
                        {execution.code}
                      </p>
                    </div>
                    <OperationReportDownload execution={execution} />
                  </li>
                ))}
              </ul>
              {result.meta.totalPages > 1 ? (
                <nav
                  aria-label="Páginas dos relatórios"
                  className="flex items-center justify-between gap-3"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || query.isFetching}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Página {page} de {result.meta.totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!result.meta.hasNextPage || query.isFetching}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Próxima
                  </Button>
                </nav>
              ) : null}
            </div>
          )}
        </PanelState>
      </PanelFrame>
    );

  return (
    <RelatedRecordsPanel
      entity="artifact-execution"
      panelId="operation-artifact-executions"
      title="Execuções de artefato"
      description="Documentos preenchidos no atendimento desta operação"
      query={query}
      emptyMessage="Nenhuma execução de artefato vinculada a esta operação."
      toRows={(page) =>
        page.data.map((execution) => ({
          key: execution.id,
          entityId: execution.id,
          title: execution.title,
          subtitle: `${execution.code} · ${execution.progress}% concluído`,
          status: execution.status,
        }))
      }
    />
  );
}
