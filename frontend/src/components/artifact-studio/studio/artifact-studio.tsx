"use client";

/**
 * Artifact Studio — composição.
 *
 * Uma leitura só (`GET /artifact-templates/:id`) alimenta cabeçalho,
 * propriedades e editor: o detalhe já traz a versão corrente completa em
 * `current`. Histórico e versões avulsas têm endpoints próprios e são
 * carregados pelas abas que precisam deles.
 *
 * **Somente leitura** acontece por três motivos distintos, e todos vêm do
 * backend, não de configuração local:
 *
 * 1. o template é da plataforma (`organizationId` nulo) — o servidor responde
 *    "Global and external templates are read-only";
 * 2. a conta não tem `artifact_templates.update`;
 * 3. o plano não inclui `artifact_templates.manage`.
 *
 * A interface antecipa os três para não deixar alguém editar por vinte minutos
 * até levar 403 ao publicar — mas quem decide continua sendo o servidor.
 *
 * ## Templates oficiais (PR-13)
 *
 * O catálogo oficial do Orbit vive como template **global** e é somente
 * leitura por política do backend — é isso que garante que o oficial nunca se
 * perca. Editar é **duplicar**, e a duplicata pertence à organização.
 *
 * Numa cópia, **Restaurar do oficial** traz a estrutura corrente do global
 * para o editor. Nada é sobrescrito no servidor: vira alteração pendente, e a
 * publicação continua sendo um ato explícito que cria uma versão nova.
 *
 * O tipo do artefato é resolvido pelo **Template Type Registry** — nenhuma
 * comparação com `artifactType` acontece nesta tela.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  GitCompare,
  Eye,
  LayoutTemplate,
  PenLine,
  RefreshCw,
  RotateCcw,
  Settings2,
  History,
} from "lucide-react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useArtifactTemplate,
  useArtifactTemplateLifecycle,
  useOfficialTemplate,
  useOfficialTemplateDetail,
} from "@/hooks/artifact-templates/use-artifact-templates";
import { TemplateTypeBadge } from "@/artifacts";
import {
  fieldNode,
  inspectDocument,
  sectionNode,
  signatureNode,
  toIdentifier,
  uniqueIdentifier,
  type StudioContentNode,
} from "@/lib/artifact-studio";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import { useAction } from "@/actions";
import type { ArtifactTemplate } from "@/types/artifact-templates";
import { DuplicateTemplateDialog } from "../duplicate-template-dialog";
import { MutationError } from "../mutation-error";
import {
  isPlatformTemplate,
  PlatformTemplateBadge,
  TemplateStatusBadge,
} from "../template-badges";
import { NodeInspector } from "./node-inspector";
import { PropertiesPanel } from "./properties-panel";
import { StructuralPreview } from "./structural-preview";
import { StudioBoundary } from "./studio-boundary";
import { StructureTree } from "./structure-tree";
import { useStudioDocument } from "./use-studio-document";
import { VersionCompare } from "./version-compare";
import { VersionsPanel } from "./versions-panel";

export function ArtifactStudio({ templateId }: { templateId: string }) {
  const query = useArtifactTemplate(templateId);

  if (query.isPending) {
    return (
      <ContentContainer size="wide" className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <PanelLoading rows={8} />
      </ContentContainer>
    );
  }

  if (query.error || !query.data) {
    return (
      <ContentContainer size="wide" className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={ROUTES.artifacts}>
            <ArrowLeft className="size-4" />
            Voltar
          </Link>
        </Button>
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      </ContentContainer>
    );
  }

  return (
    <StudioWorkspace
      template={query.data}
      onRefresh={() => void query.refetch()}
    />
  );
}

function StudioWorkspace({
  template,
  onRefresh,
}: {
  template: ArtifactTemplate;
  onRefresh: () => void;
}) {
  const session = useSession();
  const studio = useStudioDocument(template.current);
  const lifecycle = useArtifactTemplateLifecycle(template.id);
  const [duplicating, setDuplicating] = useState(false);

  const platformOwned = isPlatformTemplate(template);
  /** Exigências declaradas no Action Registry, não repetidas aqui. */
  const canManage = useAction("artifact-template.publish").allowed;
  const readOnly = platformOwned || !canManage;

  /**
   * Oficial correspondente ao tipo deste template.
   *
   * Só interessa em cópias editáveis: num template global, ele é o próprio.
   */
  const officialList = useOfficialTemplate(
    platformOwned ? undefined : template.artifactType,
  );
  const officialId = officialList.official?.id;
  const official = useOfficialTemplateDetail(readOnly ? undefined : officialId);

  const problems = useMemo(
    () => inspectDocument(studio.document),
    [studio.document],
  );
  const problemNodeIds = useMemo(
    () =>
      new Set(
        problems
          .map((problem) => problem.nodeId)
          .filter((nodeId): nodeId is string => Boolean(nodeId)),
      ),
    [problems],
  );

  const addSection = () => {
    const used = studio.identifiersIn("structure");
    studio.insert(
      "structure",
      studio.document.structure.nodeId,
      sectionNode({
        id: uniqueIdentifier("secao", used),
        title: "Nova seção",
      }),
    );
  };

  const addField = (sectionNodeId: string) => {
    const used = studio.identifiersIn("structure");
    studio.insert(
      "structure",
      sectionNodeId,
      fieldNode({
        id: uniqueIdentifier(toIdentifier("novo campo"), used),
        label: "Novo campo",
      }),
    );
  };

  const addSignature = () => {
    const used = studio.identifiersIn("signatures");
    studio.insert(
      "signatures",
      studio.document.signatures.nodeId,
      signatureNode({
        id: uniqueIdentifier("assinatura", used),
        label: "Nova assinatura",
      }),
    );
  };

  return (
    <ContentContainer size="wide" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={ROUTES.artifacts}>
              <ArrowLeft className="size-4" />
              Templates
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {template.name}
            </h1>
            <TemplateStatusBadge status={template.status} />
            <Badge variant="secondary">v{template.currentVersion}</Badge>
            {platformOwned ? <PlatformTemplateBadge /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TemplateTypeBadge artifactType={template.artifactType} />
            <p className="font-mono text-xs text-muted-foreground">
              {template.key}
              {template.segment ? ` · ${template.segment}` : ""}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Atualizado em {formatDateTime(template.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="size-4" />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDuplicating(true)}
            disabled={!session.hasPermission("artifact_templates.create")}
          >
            <Copy className="size-4" />
            Duplicar
          </Button>
          {!readOnly && official.data ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => studio.loadVersion(official.data.current)}
            >
              <RotateCcw className="size-4" />
              Restaurar do oficial
            </Button>
          ) : null}
          {template.status === "ACTIVE" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || lifecycle.deactivate.isPending}
              onClick={() => lifecycle.deactivate.mutate()}
            >
              {lifecycle.deactivate.isPending ? "Desativando…" : "Desativar"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={readOnly || lifecycle.activate.isPending}
              onClick={() => lifecycle.activate.mutate()}
            >
              {lifecycle.activate.isPending ? "Ativando…" : "Ativar"}
            </Button>
          )}
        </div>
      </div>

      <MutationError
        error={lifecycle.activate.error ?? lifecycle.deactivate.error}
      />

      {readOnly ? (
        <ReadOnlyNotice
          platformOwned={platformOwned}
          canManage={canManage}
          onDuplicate={() => setDuplicating(true)}
        />
      ) : null}

      {studio.hasNewerVersion ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span>
            A versão corrente do servidor avançou para v
            {template.currentVersion} enquanto você editava. Suas alterações
            continuam aqui, sem serem descartadas.
          </span>
          <Button variant="outline" size="sm" onClick={studio.reset}>
            Descartar e carregar a v{template.currentVersion}
          </Button>
        </div>
      ) : null}

      <Tabs defaultValue="estrutura">
        <TabsList>
          <TabsTrigger value="estrutura">
            <LayoutTemplate className="size-4" />
            Estrutura
          </TabsTrigger>
          <TabsTrigger value="assinaturas">
            <PenLine className="size-4" />
            Assinaturas
          </TabsTrigger>
          <TabsTrigger value="propriedades">
            <Settings2 className="size-4" />
            Propriedades
          </TabsTrigger>
          <TabsTrigger value="versoes">
            <History className="size-4" />
            Versões
          </TabsTrigger>
          <TabsTrigger value="comparar">
            <GitCompare className="size-4" />
            Comparar
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="size-4" />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="estrutura">
          <StudioBoundary panelId="artifact-studio-structure">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
              <div className="glass-panel space-y-4 rounded-xl p-4">
                <StructureHeading
                  isDirty={studio.isDirty}
                  problemCount={problems.length}
                />
                <StructureTree
                  tree="structure"
                  root={studio.document.structure}
                  selectedNodeId={studio.selectedNodeId}
                  readOnly={readOnly}
                  emptyMessage="Nenhuma seção. É preciso ao menos uma para publicar."
                  addRootLabel="Adicionar seção"
                  onSelect={(nodeId) => studio.select(nodeId, "structure")}
                  onAddRoot={addSection}
                  onAddChild={addField}
                  onRemove={(nodeId) => studio.remove("structure", nodeId)}
                  onMove={(nodeId, offset) =>
                    studio.move("structure", nodeId, offset)
                  }
                  problemNodeIds={problemNodeIds}
                />
              </div>
              <div className="glass-panel rounded-xl p-4">
                <NodeInspector
                  node={
                    studio.selectedTree === "structure"
                      ? studio.selectedNode
                      : null
                  }
                  readOnly={readOnly}
                  onPatch={(change) =>
                    studio.selectedNodeId &&
                    studio.patch<StudioContentNode>(
                      "structure",
                      studio.selectedNodeId,
                      change as Partial<StudioContentNode>,
                    )
                  }
                />
              </div>
            </div>
          </StudioBoundary>
        </TabsContent>

        <TabsContent value="assinaturas">
          <StudioBoundary panelId="artifact-studio-signatures">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
              <div className="glass-panel space-y-4 rounded-xl p-4">
                <p className="text-sm text-muted-foreground">
                  Espaços de assinatura do artefato. Ficam fora das seções — é
                  assim que o contrato os guarda.
                </p>
                <StructureTree
                  tree="signatures"
                  root={studio.document.signatures}
                  selectedNodeId={studio.selectedNodeId}
                  readOnly={readOnly}
                  emptyMessage="Nenhuma assinatura configurada."
                  addRootLabel="Adicionar assinatura"
                  onSelect={(nodeId) => studio.select(nodeId, "signatures")}
                  onAddRoot={addSignature}
                  onRemove={(nodeId) => studio.remove("signatures", nodeId)}
                  onMove={(nodeId, offset) =>
                    studio.move("signatures", nodeId, offset)
                  }
                  problemNodeIds={problemNodeIds}
                />
              </div>
              <div className="glass-panel rounded-xl p-4">
                <NodeInspector
                  node={
                    studio.selectedTree === "signatures"
                      ? studio.selectedNode
                      : null
                  }
                  readOnly={readOnly}
                  onPatch={(change) =>
                    studio.selectedNodeId &&
                    studio.patch<StudioContentNode>(
                      "signatures",
                      studio.selectedNodeId,
                      change as Partial<StudioContentNode>,
                    )
                  }
                />
              </div>
            </div>
          </StudioBoundary>
        </TabsContent>

        <TabsContent value="propriedades">
          <StudioBoundary panelId="artifact-studio-properties">
            <div className="glass-panel rounded-xl p-4">
              <PropertiesPanel template={template} readOnly={readOnly} />
            </div>
          </StudioBoundary>
        </TabsContent>

        <TabsContent value="versoes">
          <StudioBoundary panelId="artifact-studio-versions">
            <div className="glass-panel rounded-xl p-4">
              <VersionsPanel
                templateId={template.id}
                currentVersion={template.currentVersion}
                document={studio.document}
                isDirty={studio.isDirty}
                readOnly={readOnly}
                onPublished={onRefresh}
                onLoadVersion={studio.loadVersion}
              />
            </div>
          </StudioBoundary>
        </TabsContent>

        <TabsContent value="comparar">
          <StudioBoundary panelId="artifact-studio-compare">
            <div className="glass-panel rounded-xl p-4">
              <VersionCompare
                templateId={template.id}
                currentVersion={template.currentVersion}
              />
            </div>
          </StudioBoundary>
        </TabsContent>

        <TabsContent value="preview">
          <StudioBoundary panelId="artifact-studio-preview">
            <div className="glass-panel rounded-xl p-4">
              <StructuralPreview document={studio.document} />
            </div>
          </StudioBoundary>
        </TabsContent>
      </Tabs>

      <DuplicateTemplateDialog
        templateId={template.id}
        templateKey={template.key}
        templateName={template.name}
        open={duplicating}
        onOpenChange={setDuplicating}
      />
    </ContentContainer>
  );
}

function StructureHeading({
  isDirty,
  problemCount,
}: {
  isDirty: boolean;
  problemCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        Seções e campos da versão em edição.
      </p>
      <div className="flex items-center gap-2">
        {problemCount > 0 ? (
          <Badge variant="destructive">{problemCount} ponto(s) a revisar</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {isDirty ? "Alterações não publicadas" : "Igual à versão corrente"}
        </span>
      </div>
    </div>
  );
}

function ReadOnlyNotice({
  platformOwned,
  canManage,
  onDuplicate,
}: {
  platformOwned: boolean;
  canManage: boolean;
  onDuplicate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-strong/50 px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        {platformOwned
          ? "Este é um modelo da plataforma e não pode ser alterado. Duplique-o para criar uma versão sua."
          : !canManage
            ? "Sua conta não tem permissão ou plano para alterar templates. A estrutura fica disponível para consulta."
            : "Template em modo de leitura."}
      </span>
      {platformOwned ? (
        <Button variant="outline" size="sm" onClick={onDuplicate}>
          <Copy className="size-4" />
          Duplicar para editar
        </Button>
      ) : null}
    </div>
  );
}
