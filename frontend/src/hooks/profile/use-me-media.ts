"use client";

/**
 * Query Layer da foto e da assinatura.
 *
 * ## Cadências diferentes, e o motivo
 *
 * A foto vem com **URL temporária**: guardá-la muito tempo entrega um endereço
 * que já expirou. A assinatura é um estado (existe/não existe, qual versão) e
 * muda por ato deliberado — cadência estável, como o resto do perfil.
 */
import { CACHE } from "@/hooks/api/cache-policy";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { meMediaService } from "@/services/me-media.service";
import { profileService } from "@/services/profile.service";

export function useAvatar() {
  return useApiQuery(
    meMediaService.keys.avatar(),
    ({ signal }) => meMediaService.avatar({ signal }),

    /**
     * `fresh`, não `stable`: a URL assinada expira em minutos, e uma aba
     * aberta há uma hora mostraria um endereço morto.
     */
    CACHE.fresh,
  );
}

/**
 * As duas listas invalidadas em toda troca de foto.
 *
 * O perfil entra junto porque o topo da tela mostra a pessoa, e o topo lê de
 * lá — trocar a foto e continuar vendo a antiga no cabeçalho é o tipo de
 * inconsistência que faz alguém trocar de novo achando que não salvou.
 */
const APOS_TROCAR_FOTO = [
  meMediaService.keys.avatar(),
  profileService.keys.profile(),
] as const;

export function useUploadAvatar() {
  return useApiMutation((file: File) => meMediaService.uploadAvatar(file), {
    invalidate: APOS_TROCAR_FOTO,
  });
}

export function useRemoveAvatar() {
  return useApiMutation(() => meMediaService.removeAvatar(), {
    invalidate: APOS_TROCAR_FOTO,
  });
}

export function useSignature() {
  return useApiQuery(
    meMediaService.keys.signature(),
    ({ signal }) => meMediaService.signature({ signal }),
    CACHE.stable,
  );
}

export function useUploadSignature() {
  return useApiMutation(
    ({ blob, fileName }: { blob: Blob; fileName: string }) =>
      meMediaService.uploadSignature(blob, fileName),
    { invalidate: [meMediaService.keys.signature()] },
  );
}
