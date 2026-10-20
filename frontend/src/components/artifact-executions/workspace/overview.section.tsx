"use client";

/**
 * Informações gerais e vínculos.
 *
 * A execução guarda `operationId`, `customerId` e `assetId` — identificadores.
 * Quando há operação vinculada, o detalhe dela (`GET /operations/:id`) já traz
 * cliente e ativo **com nome**, então uma leitura resolve os três vínculos.
 *
 * Sem operação vinculada, restam os identificadores: `customers` e `assets`
 * têm endpoints, mas não Read Models sincronizados, e declarar o vínculo pelo
 * id é preferível a espelhar à mão mais dois contratos. Ver a seção de
 * limitações em `docs/artifact-execution-workspace.md`.
 */
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { useOperation } from "@/hooks/operations/use-operations";
import { UserReference } from "@/components/identity/user-reference";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import type { ArtifactExecution } from "@/types/artifact-executions";
import { RenderStatusBadge } from "../execution-badges";

export function OverviewSection({
  execution,
}: {
  execution: ArtifactExecution;
}) {
  return (
    <PanelFrame
      panelId="artifact-execution-overview"
      title="Informações gerais"
      actions={<RenderStatusBadge status={execution.renderStatus} />}
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <Entry label="Código" value={execution.code} mono />
        {/*
         * O nome do modelo, sem link.
         *
         * Levava ao editor de estrutura, que deixou de ter porta de entrada —
         * o link passaria a redirecionar para a galeria, o que é pior que não
         * ter link: promete um destino e entrega outro.
         */}
        <Entry label="Artefato" value={execution.snapshot.templateName} />
        <Entry
          label="Versão do template"
          value={
            <span className="flex items-center gap-2">
              <Badge variant="secondary">
                v{execution.snapshot.templateVersion}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {execution.snapshot.structureHash.slice(0, 12)}
              </span>
            </span>
          }
        />
        <Entry label="Tipo" value={execution.snapshot.artifactType} />
        <Entry
          label="Agendamento"
          value={
            execution.scheduledStart
              ? `${formatDateTime(execution.scheduledStart)}${
                  execution.scheduledEnd
                    ? ` — ${formatDateTime(execution.scheduledEnd)}`
                    : ""
                }`
              : "Sem agendamento"
          }
        />
        <Entry
          label="Responsável"
          value={
            execution.responsibleUserId ? (
              <UserReference userId={execution.responsibleUserId} />
            ) : (
              "Não atribuído"
            )
          }
        />
        {execution.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Observações</dt>
            <dd className="mt-1 text-sm whitespace-pre-wrap">
              {execution.notes}
            </dd>
          </div>
        ) : null}
      </dl>

      <LinkedRecords execution={execution} />
    </PanelFrame>
  );
}

function LinkedRecords({ execution }: { execution: ArtifactExecution }) {
  const hasLinks =
    execution.operationId ?? execution.customerId ?? execution.assetId;
  if (!hasLinks) return null;

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">
        Vínculos
      </h3>
      {execution.operationId ? (
        <LinkedOperation operationId={execution.operationId} />
      ) : (
        <UnresolvedLinks execution={execution} />
      )}
    </div>
  );
}

/** A operação resolve os três vínculos de uma vez, com nome. */
function LinkedOperation({ operationId }: { operationId: string }) {
  const query = useOperation(operationId);

  return (
    <PanelState
      query={toPanelQuery(query)}
      loadingRows={2}
      emptyMessage="Operação não disponível."
    >
      {(operation) => (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Operação:</span>
            <Link
              href={`${ROUTES.operations}/${operation.id}`}
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              {operation.code} · {operation.title}
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          </div>
          {operation.customer ? (
            <p>
              <span className="text-muted-foreground">Cliente: </span>
              {operation.customer.tradeName ?? operation.customer.legalName}
            </p>
          ) : null}
          {operation.assets.length > 0 ? (
            <p>
              <span className="text-muted-foreground">
                {operation.assets.length > 1
                  ? "Equipamentos: "
                  : "Equipamento: "}
              </span>
              {operation.assets
                .map((equipamento) => equipamento.name)
                .join(", ")}
            </p>
          ) : null}
        </div>
      )}
    </PanelState>
  );
}

/**
 * Vínculos sem operação.
 *
 * Sem Read Model sincronizado de cliente e ativo, o que se pode afirmar é que
 * o vínculo existe — e é isso que a tela diz, em vez de exibir um nome que não
 * recebeu.
 */
function UnresolvedLinks({ execution }: { execution: ArtifactExecution }) {
  return (
    <div className="space-y-1 text-sm">
      {execution.customerId ? (
        <p className="text-muted-foreground">
          Cliente vinculado{" "}
          <span className="font-mono text-xs">
            {execution.customerId.slice(0, 8)}
          </span>
        </p>
      ) : null}
      {execution.assetId ? (
        <p className="text-muted-foreground">
          Ativo vinculado{" "}
          <span className="font-mono text-xs">
            {execution.assetId.slice(0, 8)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Referência a um usuário.
 *
 * O backend devolve apenas `userId`, e não há endpoint que liste ou resolva
 * membros do tenant — lacuna já registrada no manifesto de contratos. Mostrar
 * o identificador abreviado é o máximo verdadeiro; inventar "Usuário" seria
 * pior que não dizer nada.
 */
/**
 * Reexportado de `@/components/identity`.
 *
 * O componente resolvia o id para os oito primeiros caracteres do uuid; agora
 * ele resolve o nome real pelo contrato de membros da organização. O nome
 * daqui permanece porque três telas já o importam deste caminho.
 */
export { UserReference } from "@/components/identity/user-reference";

function Entry({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-sm" : "mt-1 text-sm"}>
        {value}
      </dd>
    </div>
  );
}
