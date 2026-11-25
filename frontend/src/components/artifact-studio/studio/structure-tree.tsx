"use client";

/**
 * Árvore da estrutura.
 *
 * Renderiza recursivamente qualquer nó — não há componente "lista de seções"
 * nem "lista de campos". Um tipo de nó novo aparece aqui sem alterar o
 * componente: ele já sabe desenhar filhos.
 *
 * **Sem arrastar e soltar.** Mover é ação explícita (subir/descer), que também
 * é o caminho acessível por teclado e por leitor de tela — teria que existir de
 * qualquer forma ao lado do arrastar.
 *
 * O punho de arrastar que ficava à esquerda de cada nó foi removido na PR-13:
 * ele sugeria um gesto que não existia. No lugar entra a **posição** do nó, que
 * é informação real — e é ela que vira `order` no contrato.
 */
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  nodeLabel,
  type StudioNode,
  type StudioRootNode,
} from "@/lib/artifact-studio";
import { cn } from "@/lib/utils";
import type { StudioTreeName } from "./use-studio-document";

export interface StructureTreeProps {
  tree: StudioTreeName;
  root: StudioRootNode;
  selectedNodeId: string | null;
  readOnly: boolean;
  emptyMessage: string;
  /** Rótulo do botão que acrescenta um nó na raiz. */
  addRootLabel: string;
  onSelect: (nodeId: string) => void;
  onAddRoot: () => void;
  onAddChild?: (parentNodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onMove: (nodeId: string, offset: number) => void;
  /** Nós com problema apontado por `inspectDocument`. */
  problemNodeIds: ReadonlySet<string>;
}

export function StructureTree({
  tree,
  root,
  selectedNodeId,
  readOnly,
  emptyMessage,
  addRootLabel,
  onSelect,
  onAddRoot,
  onAddChild,
  onRemove,
  onMove,
  problemNodeIds,
}: StructureTreeProps) {
  return (
    <div className="space-y-3">
      {root.children.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul
          className="space-y-2"
          role="tree"
          aria-label="Estrutura do modelo"
        >
          {root.children.map((node, index) => (
            <TreeNode
              key={node.nodeId}
              node={node}
              depth={0}
              index={index}
              siblings={root.children.length}
              selectedNodeId={selectedNodeId}
              readOnly={readOnly}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRemove={onRemove}
              onMove={onMove}
              problemNodeIds={problemNodeIds}
            />
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <Button
          variant="outline"
          size="sm"
          onClick={onAddRoot}
          data-tree={tree}
        >
          <Plus className="size-4" />
          {addRootLabel}
        </Button>
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  index,
  siblings,
  selectedNodeId,
  readOnly,
  onSelect,
  onAddChild,
  onRemove,
  onMove,
  problemNodeIds,
}: {
  node: StudioNode;
  depth: number;
  index: number;
  siblings: number;
  selectedNodeId: string | null;
  readOnly: boolean;
  onSelect: (nodeId: string) => void;
  onAddChild?: (parentNodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onMove: (nodeId: string, offset: number) => void;
  problemNodeIds: ReadonlySet<string>;
}) {
  const selected = node.nodeId === selectedNodeId;
  const hasProblem = problemNodeIds.has(node.nodeId);
  const container = node.kind === "section" || node.kind === "group";

  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={container}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
          selected
            ? "border-primary/60 bg-primary/10"
            : "border-border bg-surface-strong/40 hover:bg-surface-strong",
          hasProblem && !selected && "border-destructive/50",
        )}
        style={{ marginLeft: depth * 16 }}
      >
        <span
          className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground"
          aria-hidden
        >
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onSelect(node.nodeId)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {nodeLabel(node) || "(sem rótulo)"}
            </span>
            <NodeKindBadge node={node} />
            {hasProblem ? (
              <Badge variant="destructive" className="text-[10px]">
                revisar
              </Badge>
            ) : null}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {node.kind === "root" ? "" : node.id}
          </span>
        </button>

        {readOnly ? null : (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={index === 0}
              onClick={() => onMove(node.nodeId, -1)}
              aria-label={`Mover ${nodeLabel(node)} para cima`}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={index === siblings - 1}
              onClick={() => onMove(node.nodeId, 1)}
              aria-label={`Mover ${nodeLabel(node)} para baixo`}
            >
              <ChevronDown className="size-4" />
            </Button>
            {container && onAddChild ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onAddChild(node.nodeId)}
                aria-label={`Adicionar campo em ${nodeLabel(node)}`}
              >
                <Plus className="size-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive"
              onClick={() => onRemove(node.nodeId)}
              aria-label={`Remover ${nodeLabel(node)}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {node.children.length > 0 ? (
        <ul className="mt-2 space-y-2" role="group">
          {node.children.map((child, childIndex) => (
            <TreeNode
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              index={childIndex}
              siblings={node.children.length}
              selectedNodeId={selectedNodeId}
              readOnly={readOnly}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRemove={onRemove}
              onMove={onMove}
              problemNodeIds={problemNodeIds}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  section: "Seção",
  group: "Grupo",
  field: "Campo",
  signature: "Assinatura",
};

function NodeKindBadge({ node }: { node: StudioNode }) {
  if (node.kind === "root") return null;
  const detail =
    node.kind === "field"
      ? node.type
      : node.kind === "signature"
        ? node.signerRole
        : node.kind === "section"
          ? node.type
          : null;

  return (
    <span className="flex items-center gap-1">
      <Badge variant="secondary" className="text-[10px]">
        {KIND_LABELS[node.kind] ?? node.kind}
      </Badge>
      {detail ? (
        <span className="font-mono text-[10px] text-muted-foreground">
          {detail}
        </span>
      ) : null}
      {"required" in node && node.required ? (
        <span className="text-[10px] text-destructive" title="Obrigatório">
          *
        </span>
      ) : null}
    </span>
  );
}
