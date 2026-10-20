/**
 * Foto de perfil e assinatura profissional — os dois arquivos que pertencem à
 * própria pessoa.
 *
 * ## Três passos, sempre os mesmos
 *
 * ```text
 * 1. reservar → o servidor devolve um destino assinado e temporário
 * 2. enviar   → os bytes vão para esse destino
 * 3. ativar   → o servidor confere e passa a usar o arquivo
 * ```
 *
 * O passo 3 é o que decide. Entre o 2 e o 3 o servidor **relê os bytes que
 * ficaram no storage** e confere assinatura de formato, tamanho e hash — não
 * confia no que o navegador declarou, porque entre a promessa e a gravação
 * cabe outro conteúdo.
 *
 * ## Por que o envio passa pelo BFF
 *
 * A URL assinada aponta para o backend, e o navegador não fala com o backend:
 * fala com o BFF. O que se aproveita da URL é a **query** — bucket, chave,
 * validade e assinatura —, que é onde mora a credencial; o host é reescrito
 * para o proxy, que é quem tem endereço a partir do navegador.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import { BFF_BASE_PATH } from "@/lib/env";
import { ApiError } from "@/lib/api-error";
import type { RequestOptions } from "@/types/api";

const RESOURCE = "identity-profile";

export interface UploadTarget {
  fileId: string;
  upload: {
    url: string;
    expiresAt: string;
    method: "PUT";
    requiredHeaders: Readonly<Record<string, string>>;
  };
}

export interface AvatarView {
  available: boolean;
  /** Temporária. Renove relendo; não guarde. */
  url: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
}

export interface SignatureStatus {
  signatureAvailable: boolean;
  version: number | null;
  updatedAt: string | null;
  roles: readonly string[];
  /**
   * Onde buscar a imagem da assinatura.
   *
   * O servidor sempre enviou este campo; o tipo daqui o omitia, então o dado
   * chegava e era descartado — a tela dizia "assinatura cadastrada" e não
   * mostrava nada. A URL é assinada e expira, como a do avatar.
   */
  preview: SignaturePreview | null;
}

export interface SignaturePreview {
  url: string;
  expiresAt: string;
  mimeType: string;
  sizeBytes: string;
  sha256: string;
}

/** Os formatos que o servidor aceita — e confere pelos primeiros bytes. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_IMAGE_BYTES = 2_000_000;

/**
 * Envia os bytes para o destino assinado, pelo proxy.
 *
 * Sem envelope: a rota de storage responde o objeto cru, e um erro dela é um
 * erro de transporte — não o contrato público de erro da API.
 */
async function enviarBytes(target: UploadTarget, blob: Blob): Promise<void> {
  const assinada = new URL(target.upload.url);
  const destino = `${BFF_BASE_PATH}/storage/objects${assinada.search}`;

  const response = await fetch(destino, {
    method: "PUT",
    headers: { ...target.upload.requiredHeaders },
    body: blob,
  });
  if (!response.ok) {
    throw new ApiError({
      kind: "http",
      status: response.status,
      code: "UPLOAD_FAILED",
      message: "Não foi possível enviar o arquivo. Tente novamente.",
    });
  }
}

export const meMediaService = {
  /* ---------------------------------------------------------------- */
  /* Foto de perfil                                                    */
  /* ---------------------------------------------------------------- */

  avatar: (options?: RequestOptions): Promise<AvatarView> =>
    apiClient.get<AvatarView>("/identity/me/avatar", options),

  async uploadAvatar(file: File): Promise<AvatarView> {
    const target = await apiClient.post<UploadTarget>(
      "/identity/me/avatar/uploads",
      {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
    );
    await enviarBytes(target, file);
    return apiClient.put<AvatarView>("/identity/me/avatar", {
      storageObjectId: target.fileId,
    });
  },

  removeAvatar: (): Promise<AvatarView> =>
    apiClient.delete<AvatarView>("/identity/me/avatar"),

  /* ---------------------------------------------------------------- */
  /* Assinatura profissional                                           */
  /* ---------------------------------------------------------------- */

  signature: (options?: RequestOptions): Promise<SignatureStatus> =>
    apiClient.get<SignatureStatus>("/identity/me/signature", options),

  /**
   * Cadastra uma nova assinatura.
   *
   * Cria **versão**, nunca sobrescreve: documento já emitido continua com a
   * assinatura que tinha quando foi emitido, e é essa a razão de o histórico
   * existir.
   */
  async uploadSignature(blob: Blob, fileName: string): Promise<SignatureStatus> {
    const target = await apiClient.post<UploadTarget>(
      "/identity/me/signature/uploads",
      {
        fileName,
        mimeType: blob.type,
        sizeBytes: blob.size,
        purpose: "PROFESSIONAL_SIGNATURE",
      },
    );
    await enviarBytes(target, blob);
    return apiClient.post<SignatureStatus>("/identity/me/signature", {
      storageObjectId: target.fileId,
    });
  },

  revokeSignature: (): Promise<SignatureStatus> =>
    apiClient.delete<SignatureStatus>("/identity/me/signature"),

  keys: {
    avatar: (): QueryKey => queryKeys.query(RESOURCE, "avatar"),
    signature: (): QueryKey => queryKeys.query(RESOURCE, "signature"),
  },
} as const;
