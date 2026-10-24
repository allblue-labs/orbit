"use client";

/**
 * Revisões de um documento.
 *
 * Lista, identifica a ativa, permite navegar e **compara metadados** — o que o
 * manifest publica: renderizador, formato, hash, data e quem emitiu.
 *
 * **Sem diff visual.** Comparar o conteúdo de dois documentos exigiria
 * interpretá-los, e nem o frontend nem o manifest fazem isso. O que muda entre
 * revisões é visível pela mudança do hash — que é a comparação honesta que o
 * contrato suporta.
 */
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ContentHash, DocumentFormatBadge, RendererLabel } from "@/documents";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import { cn } from "@/lib/utils";
import type { ArtifactManifestSummary } from "@/types/documents";

const STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: "Rascunho",
  ISSUED: "Emitida",
  SUPERSEDED: "Substituída",
  REVOKED: "Revogada",
};

export function DocumentRevisions({
  revisions,
  activeRevision,
  selectedId,
  onSelect,
}: {
  revisions: readonly ArtifactManifestSummary[];
  activeRevision: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { formatDateTime } = useDateFormatters();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {activeRevision === null
          ? "Nenhuma revisão ativa — a mais recente foi revogada ou ainda é rascunho."
          : `Revisão ativa: ${activeRevision}. As anteriores permanecem no histórico.`}
      </p>

      <ul className="space-y-2">
        {revisions.map((revision) => {
          const selected = revision.id === selectedId;
          return (
            <li key={revision.id}>
              <button
                type="button"
                onClick={() => onSelect(revision.id)}
                aria-pressed={selected}
                className={cn(
                  "w-full space-y-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-primary/60 bg-primary/10"
                    : "border-border hover:bg-surface-strong",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    Revisão {revision.revision}
                  </span>
                  {revision.isActive ? (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="size-3" aria-hidden />
                      ativa
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-[10px]">
                    {STATUS_LABELS[revision.status] ?? revision.status}
                  </Badge>
                  <DocumentFormatBadge format={revision.format} />
                </div>

                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>
                    <RendererLabel
                      renderer={revision.renderer}
                      version={revision.rendererVersion}
                      className="text-xs"
                    />
                  </span>
                  <span>
                    {revision.issuedAt
                      ? `Emitida em ${formatDateTime(revision.issuedAt)}`
                      : "Ainda não emitida"}
                  </span>
                  <span>Por {revision.issuedBy?.displayName ?? "—"}</span>
                  <span className="flex items-center gap-1">
                    conteúdo <ContentHash hash={revision.contentHash} />
                  </span>
                </div>

                {revision.revokedAt ? (
                  <p className="text-xs text-destructive">
                    Revogada em {formatDateTime(revision.revokedAt)}
                    {revision.revokedReason
                      ? ` — ${revision.revokedReason}`
                      : ""}
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
