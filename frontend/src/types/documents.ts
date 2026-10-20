/**
 * Contratos do Document Center.
 *
 * Tudo aqui é **sincronizado** do backend: manifest (PR-19), arquivo (PR-19) e
 * estado de renderização (PR-20). Nenhuma forma é espelhada à mão.
 *
 * O documento emitido é o **manifest** — não o arquivo, não a execução. É ele
 * que responde qual revisão está ativa, com que renderer, com que hash e
 * quando foi emitido.
 */
import type {
  ArtifactManifestActorReadModel,
  ArtifactManifestFormat,
  ArtifactManifestListItemReadModel,
  ArtifactManifestListReadModel,
  ArtifactManifestReadModel,
  ArtifactManifestStatus,
} from "./contracts/modules/artifact-manifests/artifact-manifest.read-models";
import type {
  ArtifactRenderStateReadModel,
  ArtifactRenderStatus,
  RenderMetricsReadModel,
} from "./contracts/modules/artifact-rendering/artifact-render.read-models";
import type {
  SignedUrlReadModel,
  StorageFileReadModel,
} from "./contracts/modules/storage/file-object.read-models";

export type ArtifactManifest = ArtifactManifestReadModel;
export type ArtifactManifestSummary = ArtifactManifestListItemReadModel;
export type ArtifactManifestList = ArtifactManifestListReadModel;
export type ManifestActor = ArtifactManifestActorReadModel;
export type ManifestStatus = ArtifactManifestStatus;
export type ManifestFormat = ArtifactManifestFormat;
export type StorageFile = StorageFileReadModel;
export type SignedUrl = SignedUrlReadModel;
export type RenderState = ArtifactRenderStateReadModel;
export type RenderStatus = ArtifactRenderStatus;
export type RenderMetrics = RenderMetricsReadModel;

export {
  ARTIFACT_MANIFEST_FORMATS,
  ARTIFACT_MANIFEST_STATUSES,
} from "./contracts/modules/artifact-manifests/artifact-manifest.read-models";
export { ARTIFACT_RENDER_STATUSES } from "./contracts/modules/artifact-rendering/artifact-render.read-models";

/** `POST /artifact-executions/:id/render` (`RequestArtifactRenderDto`). */
export interface RequestRenderInput {
  /**
   * Omitido, **o produto escolhe** — é o que o DTO do backend contrata
   * (`defaultRendererFor`, hoje o motor premium).
   *
   * Era obrigatório aqui e opcional lá: quem só queria o documento tinha de
   * escolher um motor, e a escolha vazava para telas que não têm opinião sobre
   * isso. A tela de renderização continua mandando um explícito — comparar a saída
   * de dois motores é o trabalho dela.
   */
  renderer?: string;
  metadata?: Record<string, unknown>;
}

/** `GET /artifact-manifests/:id/download?operation=` */
export type SignedUrlOperation = "download" | "preview";
