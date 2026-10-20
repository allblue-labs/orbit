"use client";

/**
 * Artifact Execution Workspace — composição.
 *
 * **Uma leitura alimenta quase tudo.** `GET /artifact-executions/:id` devolve
 * snapshot, respostas, anexos, assinaturas, insights, equipe e
 * `progressDetails` no mesmo payload. Distribuir esse objeto por props evita
 * dez requisições para montar uma tela — e evita que dez painéis mostrem
 * versões diferentes do mesmo estado.
 *
 * **Painéis independentes** vêm do `PanelFrame`, que já embute Error Boundary
 * local: um painel que quebre ao renderizar mostra a própria falha e os demais
 * continuam utilizáveis. O que é leitura própria — a operação vinculada — tem
 * o seu estado de carregamento separado.
 *
 * **Nenhuma regra de execução vive aqui.** Transições, progresso,
 * editabilidade e completude são do backend. O que este arquivo faz é
 * orquestrar: uma leitura, um conjunto de escritas serializadas e a
 * distribuição do estado.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileStack, RefreshCw } from "lucide-react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useArtifactExecution,
  useChangeArtifactExecutionStatus,
  useRegisterArtifactAttachment,
  useSaveArtifactResponse,
} from "@/hooks/artifact-executions/use-artifact-executions";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import type {
  ArtifactExecution,
  ArtifactExecutionStatus,
  RegisterArtifactAttachmentInput,
  SaveArtifactResponseInput,
} from "@/types/artifact-executions";
import {
  ExecutionProgress,
  ExecutionStatusBadge,
  RenderStatusBadge,
} from "../execution-badges";
import { AttachmentsSection } from "./attachments.section";
import { IntelligenceSection } from "./intelligence.section";
import { OverviewSection } from "./overview.section";
import { ProgressSection } from "./progress.section";
import { ResponsesSection } from "./responses.section";
import { SignaturesSection } from "./signatures.section";
import { StatusSection } from "./status.section";
import { TeamSection } from "./team.section";
import { HistorySection, TimelineSection } from "./timeline.section";
import { useExecutionEditability } from "./use-execution-editability";
import { PRODUCT_CAPABILITY, PRODUCT_FEATURE } from "@/registry/product-access";

export function ExecutionWorkspace({ executionId }: { executionId: string }) {
  const query = useArtifactExecution(executionId);

  if (query.isPending) {
    return (
      <ContentContainer size="wide" className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <PanelLoading rows={10} />
          <PanelLoading rows={6} />
        </div>
      </ContentContainer>
    );
  }

  if (query.error || !query.data) {
    return (
      <ContentContainer size="wide" className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={ROUTES.documents}>
            <ArrowLeft className="size-4" />
            Voltar
          </Link>
        </Button>
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      </ContentContainer>
    );
  }

  return (
    <WorkspaceBody
      execution={query.data}
      onRefresh={() => void query.refetch()}
    />
  );
}

function WorkspaceBody({
  execution,
  onRefresh,
}: {
  execution: ArtifactExecution;
  onRefresh: () => void;
}) {
  const session = useSession();
  const editability = useExecutionEditability(execution.id);

  const canExecute =
    session.hasPermission("artifact_executions.execute") &&
    session.hasCapability("artifact_executions.execute");
  const canUseIntelligence = session.canUseProductFeature(
    PRODUCT_CAPABILITY.ORBIT_INTELLIGENCE,
    PRODUCT_FEATURE.ARTIFACT_INTELLIGENCE,
  );

  const saveResponse = useSaveArtifactResponse(execution.id);
  const changeStatus = useChangeArtifactExecutionStatus(execution.id);
  const registerAttachment = useRegisterArtifactAttachment(execution.id);

  /** Qual campo está sendo salvo — para o indicador ficar no campo certo. */
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] =
    useState<ArtifactExecutionStatus | null>(null);

  const writable = canExecute && editability.writable;

  const onSaveResponse = (input: SaveArtifactResponseInput) => {
    setSavingKey(`${input.sectionId}:${input.fieldId}`);
    saveResponse.mutate(input, {
      onError: editability.observe,
      onSettled: () => setSavingKey(null),
    });
  };

  const onChangeStatus = (status: ArtifactExecutionStatus) => {
    setPendingStatus(status);
    changeStatus.mutate(
      { status },
      {
        onError: editability.observe,
        onSettled: () => setPendingStatus(null),
      },
    );
  };

  const onRegisterAttachment = (input: RegisterArtifactAttachmentInput) => {
    registerAttachment.mutate(input, { onError: editability.observe });
  };

  return (
    <ContentContainer size="wide" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {/*
            Volta para Documentos, não para "Execuções".

            A listagem global de execuções deixou de existir, e um botão com o
            nome dela apontaria para um lugar que só redireciona. Documentos é
            de onde a pessoa plausivelmente veio, e existe.
          */}
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={ROUTES.documents}>
              <ArrowLeft className="size-4" />
              Documentos
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {execution.title}
            </h1>
            <ExecutionStatusBadge status={execution.status} />
            <RenderStatusBadge status={execution.renderStatus} />
            {/* O documento emitido é assunto da central; aqui só o atalho. */}
            <Button variant="ghost" size="sm" asChild>
              <Link href={ROUTES.documents}>
                <FileStack className="size-4" />
                Documentos
              </Link>
            </Button>
            <Badge variant="secondary">
              v{execution.snapshot.templateVersion}
            </Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {execution.code}
          </p>
          <ExecutionProgress
            percentage={execution.progress}
            className="max-w-64"
          />
          <p className="text-xs text-muted-foreground">
            Atualizada em {formatDateTime(execution.updatedAt)}
          </p>
        </div>

        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-4" />
          Atualizar
        </Button>
      </header>

      {editability.reason ? (
        <div className="rounded-xl border border-border bg-surface-strong/50 px-4 py-3 text-sm text-muted-foreground">
          {editability.reason} — os painéis de escrita seguem em modo de
          consulta.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="min-w-0 space-y-6">
          <ResponsesSection
            execution={execution}
            writable={writable}
            saving={saveResponse.isPending}
            savingKey={savingKey}
            error={saveResponse.error}
            onSave={onSaveResponse}
          />
          <AttachmentsSection
            execution={execution}
            writable={writable}
            pending={registerAttachment.isPending}
            error={registerAttachment.error}
            onRegister={onRegisterAttachment}
          />
          {canUseIntelligence ? (
            <IntelligenceSection execution={execution} />
          ) : null}
          <TimelineSection execution={execution} />
          <HistorySection />
        </div>

        <div className="min-w-0 space-y-6">
          <ProgressSection progress={execution.progressDetails} />
          <StatusSection
            execution={execution}
            canExecute={canExecute}
            pending={changeStatus.isPending}
            pendingTarget={pendingStatus}
            error={changeStatus.error}
            onChange={onChangeStatus}
          />
          <SignaturesSection execution={execution} writable={writable} />
          <TeamSection execution={execution} />
          <OverviewSection execution={execution} />
        </div>
      </div>
    </ContentContainer>
  );
}
