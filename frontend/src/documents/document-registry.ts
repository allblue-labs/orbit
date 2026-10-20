/**
 * Document Registry — o catálogo do que é um documento emitido.
 *
 * Enquanto o **Template Type Registry** descreve *o que o artefato é*
 * (Ordem de Serviço, PMOC, Recibo), este registry descreve *o que o documento
 * emitido é*: em que formato saiu, que renderizador o produziu, em que estado
 * está a renderização e com que visualizador abri-lo. O que se pode **fazer**
 * com ele é do Action Registry.
 *
 * A divisão importa. Um PMOC é um tipo de artefato; um PDF é um formato de
 * documento; `pdf.default` é um renderizador. Misturar os três num só lugar
 * faria a tela decidir por comparação de string — que é exatamente o que os
 * registries da plataforma existem para impedir.
 *
 * ```
 * Template Type Registry ──▶ que artefato é (PMOC, Recibo…)
 * Document Registry ─────▶ que documento saiu (PDF, HTML…)
 *                     └──▶ renderer, estado, visualizador
 * ```
 *
 * Regras, as mesmas dos demais registries:
 *
 * - **nenhum componente compara formato, renderer ou estado com string**;
 * - **o registry não decide o que o backend decide** — ele não renderiza, não
 *   autoriza e não muda estado;
 * - **valor desconhecido não quebra a tela**: a resolução deriva do próprio
 *   identificador e avisa no console em desenvolvimento.
 *
 * Ver `docs/document-registry.md`.
 */
import type { ComponentType } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode2,
  FileJson,
  FileText,
  Loader2,
  MinusCircle,
  type LucideProps,
} from "lucide-react";

import { createRegistry, humanizeId } from "@/registry";
import { resolveTemplateType } from "@/artifacts";
import type { EntityId } from "@/entities/entity-registry";
import type { ManifestFormat, RenderStatus } from "@/types/documents";

export type DocumentIcon = ComponentType<LucideProps>;

/* ------------------------------------------------------------------ */
/* Formatos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Como o documento pode ser aberto.
 *
 * - `embedded` — o navegador desenha sozinho num quadro (PDF, HTML).
 * - `text` — mostrado como texto formatado (JSON).
 * - `download-only` — não há visualizador; resta baixar.
 */
export type DocumentViewer = "embedded" | "text" | "download-only";

export interface DocumentFormatDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: DocumentIcon;
  readonly color: string;
  readonly mimeType: string;
  readonly viewer: DocumentViewer;
  /** `true` quando faz sentido abrir antes de baixar. */
  readonly previewable: boolean;
}

const FORMATS: readonly DocumentFormatDefinition[] = [
  {
    id: "PDF",
    label: "PDF",
    description: "Documento paginado, pronto para impressão e arquivamento.",
    icon: FileText,
    color: "text-destructive",
    mimeType: "application/pdf",
    viewer: "embedded",
    previewable: true,
  },
  {
    id: "HTML",
    label: "HTML",
    description: "Documento em marcação, inspecionável e leve.",
    icon: FileCode2,
    color: "text-sky-400",
    mimeType: "text/html",
    viewer: "embedded",
    previewable: true,
  },
  {
    id: "JSON",
    label: "JSON",
    description: "Conteúdo estruturado, para integração.",
    icon: FileJson,
    color: "text-amber-400",
    mimeType: "application/json",
    viewer: "text",
    previewable: true,
  },
];

/* ------------------------------------------------------------------ */
/* Estados de renderização                                             */
/* ------------------------------------------------------------------ */

/** Leitura visual de um estado — cor sobre tokens existentes. */
export interface RenderStatusDefinition {
  readonly id: RenderStatus;
  readonly label: string;
  readonly description: string;
  readonly icon: DocumentIcon;
  readonly color: string;
  readonly badgeClass: string;
  /** O servidor ainda está trabalhando; a tela acompanha. */
  readonly inFlight: boolean;
  /** Pedir renderização faz sentido neste estado. */
  readonly canRequest: boolean;
}

const RENDER_STATUSES: readonly RenderStatusDefinition[] = [
  {
    id: "NOT_RENDERED",
    label: "Não renderizado",
    description: "Nenhum documento foi emitido para esta execução.",
    icon: MinusCircle,
    color: "text-muted-foreground",
    badgeClass: "bg-surface-strong text-muted-foreground",
    inFlight: false,
    canRequest: true,
  },
  {
    id: "PENDING",
    label: "Na fila",
    description: "O documento foi solicitado e aguarda processamento.",
    icon: Clock,
    color: "text-amber-400",
    badgeClass: "bg-amber-500/15 text-amber-400",
    inFlight: true,
    canRequest: false,
  },
  {
    id: "RENDERING",
    label: "Renderizando",
    description: "O documento está sendo produzido agora.",
    icon: Loader2,
    color: "text-primary",
    badgeClass: "bg-primary/15 text-primary",
    inFlight: true,
    canRequest: false,
  },
  {
    id: "READY",
    label: "Emitido",
    description: "O documento está pronto e disponível.",
    icon: CheckCircle2,
    color: "text-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-400",
    inFlight: false,
    /** Reemitir é legítimo: gera a revisão seguinte. */
    canRequest: true,
  },
  {
    id: "FAILED",
    label: "Falhou",
    description: "As tentativas se esgotaram; o motivo está registrado.",
    icon: AlertTriangle,
    color: "text-destructive",
    badgeClass: "bg-destructive/15 text-destructive",
    inFlight: false,
    canRequest: true,
  },
];

/* ------------------------------------------------------------------ */
/* Renderizadores                                                      */
/* ------------------------------------------------------------------ */

/**
 * Renderizadores conhecidos.
 *
 * **A lista viva vem do backend** (`/artifact-rendering/metrics` publica
 * `renderers`). O registry só acrescenta apresentação ao identificador — nunca
 * afirma que um renderizador existe. Um identificador publicado e não
 * registrado aparece humanizado.
 */
export interface RendererDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Formato que ele produz, para a tela antecipar o visualizador. */
  readonly format: ManifestFormat;
}

const RENDERERS: readonly RendererDefinition[] = [
  {
    id: "pdf.premium",
    label: "PDF premium",
    description:
      "A logo da sua organização no cabeçalho, faixa da marca, tabelas que continuam na página seguinte sem perder o título e rodapé numerado. É o que a plataforma usa por padrão.",
    format: "PDF",
  },
  {
    id: "pdf.default",
    label: "PDF simples",
    description:
      "Mesmo conteúdo, sem a identidade visual: cabeçalho de texto, tabelas e assinaturas.",
    format: "PDF",
  },
  {
    id: "html.default",
    label: "Página web",
    description:
      "O documento como página, para abrir no navegador. Não tem paginação nem numeração.",
    format: "HTML",
  },
];

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Três eixos, três registries do Kernel.
 *
 * São vocabulários independentes — um formato não é um estado, um estado não é
 * um renderizador — e cada um ganha índice, aviso único e fallback memoizado
 * sem repetir uma linha de infraestrutura.
 */
const SOURCE = "src/documents/document-registry.ts";

const formats = createRegistry<DocumentFormatDefinition>({
  name: "documents/formato",
  source: SOURCE,
  entries: FORMATS,
  normalizeId: (id) => id.trim().toUpperCase(),
  derive: (id) => ({
    id,
    /**
     * Formatos são siglas — PDF, HTML, JSON —, e a sigla é o nome que a
     * pessoa reconhece. Só um identificador composto vira frase, para que um
     * formato novo não apareça como `ALGUM_FORMATO_NOVO`.
     */
    label: id.includes("_") ? humanizeId(id) : id,
    description: "Formato ainda não descrito no Orbit.",
    icon: FileText,
    color: "text-muted-foreground",
    mimeType: "application/octet-stream",
    /** Sem saber desenhar, resta oferecer o arquivo. */
    viewer: "download-only",
    previewable: false,
  }),
});

const renderStatuses = createRegistry<RenderStatusDefinition>({
  name: "documents/estado",
  source: SOURCE,
  entries: RENDER_STATUSES,
  derive: (id) => ({
    id: id as RenderStatus,
    label: humanizeId(id),
    description: "Situação ainda não descrita no Orbit.",
    icon: MinusCircle,
    color: "text-muted-foreground",
    badgeClass: "bg-surface-strong text-muted-foreground",
    inFlight: false,
    canRequest: false,
  }),
});

const renderers = createRegistry<RendererDefinition>({
  name: "documents/renderizador",
  source: SOURCE,
  entries: RENDERERS,
  derive: (id) => ({
    id,
    label: humanizeId(id),
    description: "Formato de saída ainda não descrito no Orbit.",
    /**
     * O formato é inferido do prefixo apenas para apresentação.
     *
     * A verdade sobre o formato está no manifest (`format`), que é o que a
     * tela usa para escolher visualizador — isto aqui só rotula um id.
     */
    format: (formats.has(id.split(".")[0] ?? "")
      ? (id.split(".")[0] ?? "").toUpperCase()
      : "PDF") as ManifestFormat,
  }),
});

export function allFormats(): readonly DocumentFormatDefinition[] {
  return formats.all();
}

export function resolveFormat(id: string): DocumentFormatDefinition {
  return formats.resolve(id);
}

export function allRenderStatuses(): readonly RenderStatusDefinition[] {
  return renderStatuses.all();
}

export function resolveRenderStatus(id: string): RenderStatusDefinition {
  return renderStatuses.resolve(id);
}

export function resolveRenderer(id: string): RendererDefinition {
  return renderers.resolve(id);
}

/**
 * Ações de documento vivem no **Action Registry**.
 *
 * `import { useAction } from "@/actions";` — `artifact-execution.render`,
 * `.download-document`, `.share-document`, `.revoke-document`.
 *
 * Elas moravam aqui e no Entity Registry ao mesmo tempo, com exigências
 * escritas duas vezes. Um catálogo só.
 */

/**
 * Entidade que o documento descreve.
 *
 * Delega ao Template Type Registry, que já sabe que um PMOC descreve um
 * equipamento e um recibo descreve um cliente. O Document Registry não repete
 * esse mapa.
 */
export function documentPrimaryEntity(artifactType: string): EntityId {
  return resolveTemplateType(artifactType).primaryEntity;
}

/** Rótulo do tipo de artefato — também do Template Type Registry. */
export function documentTypeLabel(artifactType: string): string {
  return resolveTemplateType(artifactType).name;
}
