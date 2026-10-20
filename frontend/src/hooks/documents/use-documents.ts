"use client";

/**
 * Query Layer do Document Center.
 *
 * ## Polling: sem infraestrutura nova
 *
 * O enunciado pede para não criar polling próprio se já existir mecanismo
 * reutilizável. Existe: `refetchInterval` do TanStack Query, que já move a
 * agenda, a listagem de execuções e o contador de notificações. É ele que
 * acompanha uma renderização em curso.
 *
 * A cadência é **condicional ao estado**: enquanto o backend diz `PENDING` ou
 * `RENDERING`, a consulta se repete a cada três segundos; em `READY`, `FAILED`
 * ou `NOT_RENDERED`, ela para. Um documento pronto não precisa ser perguntado
 * de novo, e um documento falho não melhora sozinho.
 *
 * Não há WebSocket para renderização — o gateway do backend é de notificações.
 * A lacuna está documentada; nada aqui simula tempo real.
 */
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE, SECOND, pollWhile } from "@/hooks/api/cache-policy";
import { resolveRenderStatus } from "@/documents";
import { documentsService } from "@/services/documents.service";
import type { RenderState, RequestRenderInput } from "@/types/documents";

export const DOCUMENTS_REFRESH = {
  /** Revisões mudam quando uma renderização termina. */
  manifests: CACHE.live,
  manifest: CACHE.fresh,
  metrics: CACHE.stable,
} as const;

export function useExecutionManifests(executionId: string, enabled = true) {
  return useApiQuery(
    documentsService.keys.manifests(executionId),
    ({ signal }) => documentsService.manifests(executionId, { signal }),
    { ...DOCUMENTS_REFRESH.manifests, enabled: enabled && Boolean(executionId) },
  );
}

export function useManifest(id: string | null) {
  return useApiQuery(
    documentsService.keys.manifest(id ?? ""),
    ({ signal }) => documentsService.manifest(id as string, { signal }),
    { ...DOCUMENTS_REFRESH.manifest, enabled: id !== null },
  );
}

/**
 * Estado da renderização, com acompanhamento enquanto está em curso.
 *
 * `refetchInterval` recebe uma função: o TanStack Query a chama com o último
 * dado e decide o próximo ciclo. É assim que a consulta se desliga sozinha
 * quando o backend termina.
 */
export function useRenderState(executionId: string, enabled = true) {
  return useApiQuery(
    documentsService.keys.renderState(executionId),
    ({ signal }) => documentsService.renderState(executionId, { signal }),
    {
      staleTime: 2 * SECOND,
      enabled: enabled && Boolean(executionId),
      /**
       * O estado do registry decide, não uma lista de strings.
       *
       * `inFlight` é declarado no Document Registry — o mesmo dado que pinta o
       * crachá. Um estado novo do backend passa a ser acompanhado sem tocar
       * neste arquivo.
       */
      refetchInterval: pollWhile<RenderState>(
        (state) => resolveRenderStatus(state.renderStatus).inFlight,
        3 * SECOND,
      ),
    },
  );
}

/**
 * Solicita a renderização.
 *
 * Sem atualização otimista: o backend pode recusar por estado da execução
 * (409), por renderer desconhecido (400) ou por permissão (403). Invalida o
 * estado e as revisões — quem responde o que aconteceu é o servidor.
 */
export function useRequestRender(executionId: string) {
  return useApiMutation(
    (input: RequestRenderInput) =>
      documentsService.requestRender(executionId, input),
    {
      invalidate: [
        documentsService.keys.renderState(executionId),
        documentsService.keys.manifests(executionId),
      ],
    },
  );
}

/**
 * Renderizadores disponíveis nesta instalação.
 *
 * Vêm de `/artifact-rendering/metrics`, que publica `renderers`. Não há
 * endpoint dedicado de catálogo — a lacuna está registrada; enquanto isso, a
 * lista publicada é a fonte, e não uma constante inventada no cliente.
 */
export function useAvailableRenderers() {
  const query = useApiQuery(
    documentsService.keys.metrics(),
    ({ signal }) => documentsService.metrics({ signal }),
    DOCUMENTS_REFRESH.metrics,
  );

  /**
   * `defaultRenderer` vem do backend, não do primeiro item da lista.
   *
   * A ordem de `renderers` é a de registro no módulo do Nest — um detalhe de
   * montagem. Pré-selecionar por ela faria a tela oferecer um motor e a
   * emissão usar outro no dia em que alguém reordenasse os providers.
   */
  return {
    ...query,
    renderers: query.data?.renderers ?? [],
    defaultRenderer: query.data?.defaultRenderer ?? "",
  };
}
