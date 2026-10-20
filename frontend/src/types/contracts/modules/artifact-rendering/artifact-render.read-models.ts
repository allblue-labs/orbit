/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * Contrato público da renderização.
 *
 * O documento em si **não** está aqui: quem o representa é o
 * `ArtifactManifestReadModel` da PR-19. Este contrato descreve apenas o
 * **estado do processo** — pedido, em curso, pronto ou falho.
 */

/**
 * Estados possíveis. O backend é a autoridade; clientes só leem.
 *
 * - `NOT_RENDERED` — nunca foi pedido.
 * - `PENDING` — pedido e enfileirado.
 * - `RENDERING` — o worker está produzindo.
 * - `READY` — documento emitido; o manifest ativo tem o arquivo.
 * - `FAILED` — as tentativas se esgotaram; `error` diz o motivo.
 */
export const ARTIFACT_RENDER_STATUSES = [
  'NOT_RENDERED',
  'PENDING',
  'RENDERING',
  'READY',
  'FAILED',
] as const;
export type ArtifactRenderStatus = (typeof ARTIFACT_RENDER_STATUSES)[number];

export interface ArtifactRenderStateReadModel {
  executionId: string;
  renderStatus: ArtifactRenderStatus;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Motivo em linguagem de negócio; nunca detalhe técnico. */
  error: string | null;
  /** Presentes na resposta da solicitação; nulos na consulta de status. */
  jobId: string | null;
  correlationId: string | null;
}

export interface RendererCountersReadModel {
  started: number;
  succeeded: number;
  failed: number;
  durationMsTotal: number;
  bytesTotal: number;
}

/**
 * Instantâneo de observabilidade.
 *
 * **Do processo, não da plataforma**: os contadores reiniciam a cada reinício e
 * não somam entre réplicas. Para série temporal, o log estruturado
 * (`event: render.*`) é a fonte.
 */
export interface RenderMetricsReadModel {
  since: string;
  started: number;
  succeeded: number;
  failed: number;
  retried: number;
  durationMsTotal: number;
  durationMsAverage: number;
  bytesTotal: number;
  bytesAverage: number;
  byRenderer: Readonly<Record<string, RendererCountersReadModel>>;
  /** Renderizadores disponíveis nesta instalação. */
  renderers: readonly string[];
  /**
   * O que o backend usa quando o pedido não escolhe.
   *
   * Publicado porque a tela precisa pré-selecionar o mesmo motor que a
   * emissão usaria — sem isso ela pré-selecionaria o primeiro da lista, e o
   * preview mostraria um documento diferente do que sairia.
   */
  defaultRenderer: string;
}
