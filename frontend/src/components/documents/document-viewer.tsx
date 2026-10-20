"use client";

/**
 * Visualizador do documento.
 *
 * ## Consome exclusivamente o Manifest
 *
 * O painel não conhece storage, bucket nem chave — nada disso existe em
 * contrato. O que ele tem é o manifest: revisão, renderizador, formato, hash,
 * quem emitiu e quando. O arquivo é alcançado por **URL assinada**, pedida ao
 * backend no momento de abrir.
 *
 * ## Preview antes de download
 *
 * Quando o formato tem visualizador, o documento é **aberto**, não baixado. A
 * URL de `preview` traz `Content-Disposition: inline`; a de `download` traz
 * `attachment`. São a mesma assinatura sobre o mesmo objeto, com finalidade
 * diferente — e é o backend que decide isso, não a tela.
 *
 * ## Revisões
 *
 * O painel navega entre revisões e compara **metadados** — renderizador,
 * formato, hash, data, quem emitiu. Não há diff visual: comparar o conteúdo de
 * dois documentos exigiria interpretá-los, que é justamente o que nem o
 * frontend nem o manifest fazem.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useExecutionManifests,
  useRenderState,
} from "@/hooks/documents/use-documents";
import type { ArtifactManifestSummary } from "@/types/documents";
import { DocumentPreview } from "./document-preview";
import { DocumentRevisions } from "./document-revisions";
import { RenderPanel } from "./render-panel";

export function DocumentViewer({
  executionId,
  onOpenChange,
}: {
  executionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={executionId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {executionId ? <ViewerBody executionId={executionId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ViewerBody({ executionId }: { executionId: string }) {
  const manifests = useExecutionManifests(executionId);
  const render = useRenderState(executionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const revisions = manifests.data?.data ?? [];
  const active = revisions.find((revision) => revision.isActive);

  /**
   * Revisão em foco.
   *
   * Começa na ativa e acompanha a escolha do usuário. Ajuste durante a
   * renderização — `set-state-in-effect` é erro neste repositório — para
   * adotar a ativa assim que a lista chega.
   */
  const selected: ArtifactManifestSummary | undefined =
    revisions.find((revision) => revision.id === selectedId) ?? active ?? revisions[0];

  return (
    <>
      <SheetHeader>
        <SheetTitle>Documento</SheetTitle>
        <SheetDescription>
          Emitido a partir da execução, com revisões, conteúdo e histórico.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        <RenderPanel executionId={executionId} query={render} />

        {manifests.isPending ? (
          <PanelLoading rows={5} />
        ) : manifests.error ? (
          <PanelError
            error={manifests.error}
            onRetry={() => void manifests.refetch()}
          />
        ) : revisions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum documento emitido para esta execução. Solicite a emissão acima.
          </p>
        ) : (
          <Tabs defaultValue="conteudo">
            <TabsList>
              <TabsTrigger value="conteudo">Conteúdo</TabsTrigger>
              <TabsTrigger value="revisoes">
                Revisões
                <Badge variant="secondary" className="ml-1.5">
                  {manifests.data?.meta.total ?? revisions.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="conteudo">
              {selected ? (
                <DocumentPreview manifestId={selected.id} summary={selected} />
              ) : null}
            </TabsContent>

            <TabsContent value="revisoes">
              <DocumentRevisions
                revisions={revisions}
                activeRevision={manifests.data?.meta.activeRevision ?? null}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
              />
            </TabsContent>
          </Tabs>
        )}

        <MutationError error={null} />
      </div>
    </>
  );
}
