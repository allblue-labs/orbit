"use client";

/**
 * Hooks da identidade QR.
 *
 * A identidade quase nunca muda — só quando alguém rotaciona. O contexto
 * resolvido, ao contrário, reflete o estado operacional do equipamento e
 * envelhece rápido: o PMOC pode vencer e a visita pode terminar enquanto a
 * tela está aberta.
 */
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/query-keys";
import { CACHE } from "@/hooks/api/cache-policy";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { equipmentQrService } from "@/services/equipment-qr.service";

export const QR_REFRESH = {
  summary: CACHE.stable,
  /** Elegibilidade de PMOC e visita mudam sem aviso; nunca servir decisão velha. */
  resolution: CACHE.live,
  preparation: CACHE.fresh,
} as const;

export function useEquipmentQr(equipmentId: string) {
  return useApiQuery(
    equipmentQrService.keys.qr(equipmentId),
    ({ signal }) => equipmentQrService.summary(equipmentId, { signal }),
    QR_REFRESH.summary,
  );
}

export function useQrResolution(token: string) {
  return useApiQuery(
    equipmentQrService.keys.resolution(token),
    ({ signal }) => equipmentQrService.resolve(token, { signal }),
    { ...QR_REFRESH.resolution, retry: false },
  );
}

/**
 * A preparação do atendimento.
 *
 * Só é buscada quando alguém pede — por isso `enabled`. Carregá-la junto com o
 * contexto anteciparia trabalho para uma ação que talvez ninguém tome, e
 * "preparar" é justamente o passo que precede a decisão.
 */
export function useServiceOrderPreparation(equipmentId: string | null) {
  return useApiQuery(
    equipmentQrService.keys.preparation(equipmentId ?? ""),
    ({ signal }) =>
      equipmentQrService.serviceOrderPreparation(equipmentId!, { signal }),
    { ...QR_REFRESH.preparation, enabled: Boolean(equipmentId) },
  );
}

/**
 * Rotacionar e substituir invalidam a mesma coisa.
 *
 * A identidade anterior deixa de resolver **no servidor**, na mesma transação.
 * O que o cliente precisa fazer é esquecer o que sabia: o resumo do
 * equipamento e toda resolução em cache — que agora aponta para um token
 * morto. `removeQueries` em vez de `invalidateQueries` porque não há o que
 * revalidar: aquela consulta não existe mais.
 */
function useQrIdentityMutation<TResult>(
  equipmentId: string,
  run: () => Promise<TResult>,
) {
  const client = useQueryClient();
  return useApiMutation(run, {
    scope: { id: `equipment-qr:${equipmentId}` },
    invalidate: [
      equipmentQrService.keys.qr(equipmentId),
      queryKeys.detail("assets", equipmentId),
    ],
    onSuccess: () => {
      client.removeQueries({
        queryKey: queryKeys.query("assets", "qr-resolution"),
      });
    },
  });
}

export function useRotateEquipmentQr(equipmentId: string) {
  return useQrIdentityMutation(equipmentId, () =>
    equipmentQrService.rotate(equipmentId),
  );
}

export function useRevokeEquipmentQr(equipmentId: string) {
  return useQrIdentityMutation(equipmentId, () =>
    equipmentQrService.revoke(equipmentId),
  );
}
