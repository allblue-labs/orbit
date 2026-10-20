"use client";

/**
 * Operations Workspace.
 *
 * Compõe as seções e distribui as leituras. Cada área tem a sua query e o seu
 * Error Boundary: uma seção que falha mostra o próprio erro e as demais
 * continuam utilizáveis.
 *
 * As leituras compartilhadas acontecem uma única vez aqui — `GET /operations/:id`
 * já traz unidade, cliente, ativo, equipe, anexos e resumo dos checklists, e é
 * distribuído por props. Timeline, histórico, checklists e IA têm endpoints
 * próprios e cadências próprias.
 */
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { toPanelQuery } from "@/components/panels";
import { ContentContainer } from "@/components/layout/page-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useOperation,
  useOperationChecklists,
  useOperationFieldRecord,
  useOperationHistory,
  useOperationIntelligence,
  useOperationTimeline,
} from "@/hooks/operations/use-operations";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { OperationStatusBadge } from "../operation-badges";
import { AssigneesSection } from "./assignees.section";
import { OperationArtifactExecutionsSection } from "./artifact-executions.section";
import { AttachmentsSection } from "./attachments.section";
import { ChecklistsSection } from "./checklists.section";
import { FieldRecordSection } from "./field-record.section";
import {
  AdditionalDataSection,
  DetailsSection,
  RelationsSection,
  ScheduleSection,
} from "./details.section";
import { IntelligenceSection } from "./intelligence.section";
import { MaterialsSection } from "./materials.section";
import { StatusSection } from "./status.section";
import { HistorySection, TimelineSection } from "./timeline.section";
import { useSession } from "@/providers/session-provider";
import { PRODUCT_CAPABILITY, PRODUCT_FEATURE } from "@/registry/product-access";

export function OperationWorkspace({ operationId }: { operationId: string }) {
  const session = useSession();
  const canUseIntelligence =
    session.hasPermission("ai.executions.read") &&
    session.hasCapability("ai.executions.read") &&
    session.canUseProductFeature(
      PRODUCT_CAPABILITY.ORBIT_INTELLIGENCE,
      PRODUCT_FEATURE.ORBIT_INTELLIGENCE,
    );
  const operation = useOperation(operationId);
  const timeline = useOperationTimeline(operationId);
  const history = useOperationHistory(operationId);
  const checklists = useOperationChecklists(operationId);
  const fieldRecord = useOperationFieldRecord(operationId);
  const intelligence = useOperationIntelligence(
    operationId,
    canUseIntelligence,
  );

  const operationQuery = toPanelQuery(operation);

  return (
    <ContentContainer size="wide" className="space-y-8">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={ROUTES.operations}>
              <ArrowLeft className="size-4" />
              Operações
            </Link>
          </Button>
          {operation.isPending ? (
            <Skeleton className="h-9 w-80" />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display truncate text-3xl font-bold tracking-tight">
                {operation.data?.title ?? "Operação"}
              </h1>
              {operation.data ? (
                <>
                  <OperationStatusBadge status={operation.data.status} />
                  <Badge variant="outline" className="font-mono">
                    {operation.data.code}
                  </Badge>
                </>
              ) : null}
            </div>
          )}
          {operation.data ? (
            <p className="text-sm text-muted-foreground">
              Atualizada em {formatDateTime(operation.data.updatedAt)}
            </p>
          ) : null}
        </div>

        <Button
          variant="outline"
          size="icon"
          aria-label="Atualizar workspace"
          onClick={() => {
            void operation.refetch();
            void timeline.refetch();
            void history.refetch();
            void checklists.refetch();
            void fieldRecord.refetch();
            if (canUseIntelligence) void intelligence.refetch();
          }}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <DetailsSection query={operationQuery} />
          <TimelineSection query={toPanelQuery(timeline)} />
          <ChecklistsSection query={toPanelQuery(checklists)} />
          <OperationArtifactExecutionsSection operationId={operationId} />
          {/*
            Materiais utilizados: baixa de estoque vinculada a esta operação.
            Fica na coluna principal, ao lado de checklists — as duas respondem
            "o que foi feito em campo".
          */}
          <MaterialsSection operation={operationQuery.data} />
          {/*
            O registro de campo fica na coluna principal, junto de checklists e
            materiais: as três respondem "o que foi feito em campo". A assinatura
            do cliente é a última peça dessa resposta.
          */}
          <FieldRecordSection query={toPanelQuery(fieldRecord)} />
          {canUseIntelligence ? (
            <IntelligenceSection query={toPanelQuery(intelligence)} />
          ) : null}
          <AdditionalDataSection query={operationQuery} />
        </div>

        <div className="space-y-6 lg:col-span-4">
          <StatusSection operationId={operationId} query={operationQuery} />
          <AssigneesSection query={operationQuery} />
          <RelationsSection query={operationQuery} />
          <ScheduleSection query={operationQuery} />
          <AttachmentsSection
            operationId={operationId}
            query={operationQuery}
          />
          <HistorySection query={toPanelQuery(history)} />
        </div>
      </div>
    </ContentContainer>
  );
}
