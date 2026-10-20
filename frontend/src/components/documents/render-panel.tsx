"use client";

/**
 * Estado da renderização e solicitação.
 *
 * ## O estado é do backend
 *
 * `renderStatus` é lido, nunca escrito: nenhuma rota o aceita como entrada. A
 * tela mostra o que o servidor decidiu e, enquanto há trabalho em curso,
 * acompanha pelo `refetchInterval` do Query Layer — que se desliga sozinho
 * quando o estado para de mudar. Sem polling próprio, sem WebSocket simulado.
 *
 * ## Solicitar
 *
 * O botão aparece quando o **registry** diz que o estado permite pedir e quando
 * o plano e o papel liberam a ação. Quem autoriza de fato é o backend: um 409
 * (execução em estado que não emite documento) ou 403 aparece como veio.
 *
 * Os renderizadores oferecidos vêm do backend, não de uma lista inventada, e
 * o pré-selecionado é o que o backend declara como padrão.
 *
 * ## Pré-visualizar é outra coisa
 *
 * Conferir o rascunho não emite nada — não cria revisão, não consome número,
 * não aparece no histórico do cliente. Por isso o botão de pré-visualizar
 * segue autorização própria (`artifact_executions.read`) e continua
 * disponível para quem revisa mas não assina.
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { DraftPreviewDialog } from "./draft-preview-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAction } from "@/actions";
import {
  RenderStatusBadge,
  resolveRenderStatus,
  resolveRenderer,
} from "@/documents";
import {
  useAvailableRenderers,
  useRequestRender,
} from "@/hooks/documents/use-documents";
import type { useRenderState } from "@/hooks/documents/use-documents";
import { formatDateTime } from "@/lib/formatters";

export function RenderPanel({
  executionId,
  query,
}: {
  executionId: string;
  query: ReturnType<typeof useRenderState>;
}) {
  const request = useRequestRender(executionId);
  const {
    renderers,
    defaultRenderer,
    isPending: loadingRenderers,
  } = useAvailableRenderers();
  const [renderer, setRenderer] = useState<string>("");
  const render = useAction("artifact-execution.render");
  const preview = useAction("artifact-execution.preview-draft");

  if (query.isPending) return <Skeleton className="h-24 rounded-xl" />;

  const state = query.data;
  if (!state) return null;

  const definition = resolveRenderStatus(state.renderStatus);
  /**
   * Duas condições independentes.
   *
   * `render.allowed` é sobre **esta sessão** — plano e papel, declarados no
   * Action Registry. `canRequest` é sobre **este estado** — pedir renderização
   * de algo que já está na fila não faria nada. As duas precisam valer.
   */
  const canRender = render.allowed && definition.canRequest;

  /* O padrão é o do backend; a lista é só o que mais existe. */
  const chosen = renderer || defaultRenderer || renderers[0] || "";

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <RenderStatusBadge status={state.renderStatus} />
          <p className="text-xs text-muted-foreground">
            {definition.description}
          </p>
        </div>

        {state.completedAt ? (
          <p className="text-xs text-muted-foreground">
            Concluído em {formatDateTime(state.completedAt)}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          {state.error}
        </p>
      ) : null}

      {definition.inFlight ? (
        <p className="text-xs text-muted-foreground">
          A tela se atualiza sozinha e para quando o documento ficar pronto.
        </p>
      ) : null}

      {canRender ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 space-y-2">
            <Label htmlFor="render-renderer">Renderizador</Label>
            <Select
              value={chosen}
              disabled={loadingRenderers || renderers.length === 0}
              onValueChange={setRenderer}
            >
              <SelectTrigger id="render-renderer">
                <SelectValue
                  placeholder={
                    loadingRenderers ? "Carregando…" : "Nenhum disponível"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {renderers.map((id) => (
                  <SelectItem key={id} value={id}>
                    {resolveRenderer(id).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {preview.allowed ? (
            <DraftPreviewDialog
              executionId={executionId}
              renderer={chosen}
              disabled={!chosen}
            />
          ) : null}

          <Button
            disabled={!chosen || request.isPending}
            onClick={() => request.mutate({ renderer: chosen })}
          >
            <RefreshCw className="size-4" />
            {request.isPending
              ? "Solicitando…"
              : state.renderStatus === "READY"
                ? "Emitir de novo"
                : "Renderizar"}
          </Button>
        </div>
      ) : preview.allowed && chosen ? (
        /**
         * Quem não pode emitir ainda pode conferir. É o caso de quem revisa
         * antes de liberar: o botão de emissão é de quem assina, a conferência
         * é de quem lê.
         */
        <DraftPreviewDialog executionId={executionId} renderer={chosen} />
      ) : null}

      <MutationError error={request.error} />

      {state.renderStatus === "READY" ? (
        <p className="text-xs text-muted-foreground">
          Emitir de novo cria a revisão seguinte; a anterior permanece no
          histórico.
        </p>
      ) : null}
    </div>
  );
}
