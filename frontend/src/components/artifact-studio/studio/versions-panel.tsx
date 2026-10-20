"use client";

/**
 * Histórico de versões e publicação.
 *
 * **Todo o versionamento é do backend.** O número da versão é atribuído lá,
 * sob `pg_advisory_xact_lock`, e `currentVersion` avança na mesma transação.
 * O Studio não numera, não reordena e não reescreve: envia a estrutura e
 * apresenta o que voltou.
 *
 * Versões são imutáveis — não há rota de edição nem de exclusão de versão.
 * Reverter, quando for preciso, é publicar uma versão nova com o conteúdo de
 * uma anterior. É o que **Carregar no editor** faz: traz a estrutura da versão
 * escolhida para a área de edição, onde ela vira uma alteração pendente. Nada
 * é sobrescrito no servidor até alguém publicar.
 */
import { useState } from "react";
import { GitBranch, History, RotateCcw, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelState, toPanelQuery } from "@/components/panels";
import {
  useArtifactTemplateVersions,
  useCreateArtifactTemplateVersion,
} from "@/hooks/artifact-templates/use-artifact-templates";
import { serializeDocument, type StudioDocument } from "@/lib/artifact-studio";
import { formatDateTime } from "@/lib/formatters";
import {
  ARTIFACT_LIMITS,
  type ArtifactTemplateVersion,
} from "@/types/artifact-templates";
import { cn } from "@/lib/utils";
import { MutationError } from "../mutation-error";

export function VersionsPanel({
  templateId,
  currentVersion,
  document,
  isDirty,
  readOnly,
  onPublished,
  onLoadVersion,
}: {
  templateId: string;
  currentVersion: number;
  document: StudioDocument;
  isDirty: boolean;
  readOnly: boolean;
  onPublished: () => void;
  /** Traz a estrutura de uma versão anterior para o editor. */
  onLoadVersion: (version: ArtifactTemplateVersion) => void;
}) {
  const versions = useArtifactTemplateVersions(templateId);
  const publish = useCreateArtifactTemplateVersion(templateId);
  const [changeSummary, setChangeSummary] = useState("");

  const serialized = serializeDocument(document);

  const submit = () => {
    if (!serialized.ok) return;
    publish.mutate(
      {
        ...serialized.structure,
        changeSummary: changeSummary.trim() || undefined,
      },
      {
        onSuccess: () => {
          setChangeSummary("");
          onPublished();
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {readOnly ? null : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-medium">Publicar versão</h3>
          </div>

          <p className="text-sm text-muted-foreground">
            {isDirty
              ? "A estrutura em edição será publicada como uma versão nova e imutável."
              : "A estrutura em edição é igual à versão corrente. Publicar criaria uma versão idêntica."}
          </p>

          {serialized.ok ? null : (
            <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {serialized.problems.map((problem, index) => (
                <li key={`${problem.nodeId ?? "geral"}-${index}`}>
                  {problem.message}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <Label htmlFor="version-summary">Resumo da mudança</Label>
            <Input
              id="version-summary"
              value={changeSummary}
              maxLength={ARTIFACT_LIMITS.changeSummaryMaxLength}
              placeholder="Ex.: acrescenta seção de medições elétricas"
              onChange={(event) => setChangeSummary(event.target.value)}
            />
          </div>

          <MutationError error={publish.error} />

          <Button
            onClick={submit}
            disabled={!serialized.ok || !isDirty || publish.isPending}
          >
            <GitBranch className="size-4" />
            {publish.isPending
              ? "Publicando…"
              : `Publicar como versão ${currentVersion + 1}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            O número final é atribuído na publicação — se alguém publicar antes,
            a sua versão receberá o número seguinte.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium">Histórico</h3>
        </div>

        <PanelState
          query={toPanelQuery(versions)}
          isEmpty={(data) => data.length === 0}
          emptyMessage="Nenhuma versão registrada."
        >
          {(data) => (
            <ul className="space-y-2">
              {data.map((version) => (
                <li
                  key={version.id}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    version.version === currentVersion
                      ? "border-primary/50 bg-primary/5"
                      : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">v{version.version}</Badge>
                      {version.version === currentVersion ? (
                        <span className="text-xs text-primary">corrente</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(version.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">
                    {version.changeSummary ?? "Sem resumo informado."}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {version.sections.length} seção(ões) ·{" "}
                      {version.sections.reduce(
                        (total, section) => total + section.fields.length,
                        0,
                      )}{" "}
                      campo(s) · {version.signatureSlots.length} assinatura(s)
                    </p>
                    {readOnly ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => onLoadVersion(version)}
                      >
                        <RotateCcw className="size-3.5" />
                        Carregar no editor
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelState>
      </div>
    </div>
  );
}
