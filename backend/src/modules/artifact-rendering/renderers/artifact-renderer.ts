/**
 * Contrato único de renderização.
 *
 * Um renderer recebe **o que a execução é** e devolve **bytes**. Não conhece
 * storage, manifest, revisão, hash, autorização nem fila — tudo isso é da
 * PR-19 e do pipeline. É o que permite trocar o motor de PDF sem tocar em
 * nenhuma dessas coisas.
 *
 * ```
 * RenderInput ──▶ ArtifactRenderer ──▶ RenderOutput
 *  (snapshot,                            (bytes, mimeType,
 *   respostas,                            format, rendererVersion,
 *   assinaturas,                          metadata)
 *   layout, metadata)
 * ```
 *
 * O renderer é **puro**: mesma entrada, mesma saída. Não lê banco, não escreve
 * arquivo, não chama rede. É o que torna o teste de snapshot → documento uma
 * função, e não um cenário de integração.
 */

export interface RenderFieldInput {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly order: number;
  readonly required: boolean;
  readonly hidden: boolean;
  readonly description?: string;
  readonly unit?: string;
  /** Resposta registrada, quando existe. */
  readonly value?: unknown;
  readonly answeredAt?: string;
  readonly notes?: string | null;
}

export interface RenderSectionInput {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly order: number;
  readonly type: string;
  readonly fields: readonly RenderFieldInput[];
}

export interface RenderSignatureInput {
  readonly slotId: string;
  readonly label: string;
  readonly signerRole: string;
  readonly required: boolean;
  readonly order: number;
  /** Preenchido quando a assinatura foi coletada. */
  readonly signerName?: string;
  readonly signerDocument?: string | null;
  readonly signedAt?: string;
  readonly signatureHash?: string;
  readonly signedAs?: string;
  readonly professionalCredential?: string;
  readonly signatureImage?: Buffer;
  readonly signatureImageMimeType?: string;
}

/**
 * Identidade visual.
 *
 * Sai de `layout.visualIdentity` do snapshot, que é JSON livre — nada aqui é
 * obrigatório, e o renderer usa o padrão quando o tenant não configurou.
 */
export interface RenderBranding {
  readonly organizationName?: string;
  readonly documentTitle?: string;
  readonly primaryColor?: string;
  readonly headerText?: string;
  readonly footerText?: string;
}

export interface RenderEvidenceInput {
  readonly id: string;
  readonly kind: string;
  readonly caption?: string | null;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sha256?: string | null;
  /** Conteúdo imutável carregado pelo pipeline; nunca persistido no snapshot. */
  readonly bytes?: Buffer;
}

export interface RenderInput {
  readonly execution: {
    readonly id: string;
    readonly code: string;
    readonly title: string;
    readonly status: string;
    readonly startedAt?: string | null;
    readonly completedAt?: string | null;
  };
  readonly snapshot: {
    readonly id: string;
    readonly templateKey: string;
    readonly templateName: string;
    readonly templateVersion: number;
    readonly artifactType: string;
    readonly structureHash: string;
  };
  readonly sections: readonly RenderSectionInput[];
  readonly signatures: readonly RenderSignatureInput[];
  readonly evidence?: readonly RenderEvidenceInput[];
  readonly branding: RenderBranding;
  /** `layout` do snapshot, como veio — o renderer lê o que entende. */
  readonly layout: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Atravessa todo o pipeline; entra no rodapé do documento. */
  readonly correlationId: string;
  readonly generatedAt: Date;
}

export interface RenderOutput {
  readonly bytes: Buffer;
  readonly mimeType: string;
  /** `PDF`, `HTML`… casa com o `format` do manifest. */
  readonly format: string;
  readonly rendererVersion: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Um motor de renderização.
 *
 * `id` é o identificador estável que o manifest guarda em `renderer` — é por
 * ele que se sabe, meses depois, o que produziu aquele documento.
 */
export interface ArtifactRenderer {
  readonly id: string;
  readonly version: string;
  readonly format: string;
  readonly mimeType: string;
  render(input: RenderInput): Promise<RenderOutput>;
}

export const ARTIFACT_RENDERER = Symbol('ARTIFACT_RENDERER');
