"use client";

/**
 * Query Layer do Asset Workspace.
 *
 * Além das leituras do próprio módulo, este arquivo reúne as consultas
 * **cruzadas** que dão ao ativo a visão de 360°. Todas reutilizam os serviços
 * já existentes (`operations`, `scheduling`, `artifact-executions`) filtrando
 * por `assetId`, que é filtro real nos três contratos — nada é recortado no
 * cliente.
 *
 * ## Sobre atualização otimista
 *
 * `PATCH /assets/:id` pode ser **recusado** por motivos que o cliente não
 * enxerga: identificador duplicado na organização (`@@unique`), unidade ou
 * cliente inexistentes. Escrever o valor novo na tela antes da confirmação
 * mostraria um dado que o servidor talvez rejeite — e teria de ser desfeito na
 * frente do usuário.
 *
 * Por isso a escrita **semeia o cache com a resposta**, que é o estado
 * confirmado, em vez de antecipar. É o que o contrato suporta: ele devolve o
 * ativo atualizado, o que já elimina a releitura.
 */
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { artifactExecutionsService } from "@/services/artifact-executions.service";
import { assetsService } from "@/services/assets.service";
import { operationsService } from "@/services/operations.service";
import { schedulingService } from "@/services/scheduling.service";
import type {
  Asset,
  AssetQuery,
  CreateAssetInput,
  UpdateAssetInput,
} from "@/types/assets";

/**
 * Cadência por leitura, nomeada pelo Query Core.
 *
 * Cadastro de ativo muda por configuração, não por evento operacional — daí
 * `stable` e `fresh`, nenhum deles com recarga automática. As listas cruzadas
 * acompanham a cadência do módulo dono.
 */
export const ASSETS_REFRESH = {
  list: CACHE.stable,
  detail: CACHE.fresh,
  related: CACHE.fresh,
} as const;

/** Horizonte da agenda futura do ativo, em dias. */
const SCHEDULE_HORIZON_DAYS = 90;
/** Quantos registros relacionados cada painel mostra. */
export const RELATED_PAGE_SIZE = 5;

export function useAssetsList(
  query: AssetQuery,
  /** `enabled` para quem só pergunta depois de escolher o cliente. */
  options?: { enabled?: boolean },
) {
  return useApiQuery(
    assetsService.keys.list(query),
    ({ signal }) => assetsService.list(query, { signal }),
    {
      ...ASSETS_REFRESH.list,
      /** Mantém a página anterior visível durante a troca de página. */
      placeholderData: (previous) => previous,
      ...(options ?? {}),
    },
  );
}

export function useAsset(id: string) {
  return useApiQuery(
    assetsService.keys.detail(id),
    ({ signal }) => assetsService.get(id, { signal }),
    ASSETS_REFRESH.detail,
  );
}

/** Operações do ativo — `assetId` é filtro real de `OperationQueryDto`. */
export function useAssetOperations(assetId: string) {
  const query = { assetId, limit: RELATED_PAGE_SIZE, page: 1 } as const;
  return useApiQuery(
    operationsService.keys.list(query),
    ({ signal }) => operationsService.list(query, { signal }),
    ASSETS_REFRESH.related,
  );
}

/**
 * Agenda futura do ativo.
 *
 * A janela vai de agora até 90 dias — recorte de apresentação, não regra. As
 * ocorrências vêm expandidas pelo motor de recorrência do backend.
 */
export function useAssetSchedule(assetId: string) {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + SCHEDULE_HORIZON_DAYS);

  const query = {
    assetId,
    from: from.toISOString(),
    to: to.toISOString(),
  };

  return useApiQuery(
    schedulingService.keys.occurrences(query),
    ({ signal }) => schedulingService.occurrences(query, { signal }),
    ASSETS_REFRESH.related,
  );
}

/** Execuções de artefato do ativo — `assetId` é filtro real do contrato. */
export function useAssetExecutions(assetId: string) {
  const query = { assetId, limit: RELATED_PAGE_SIZE, page: 1 } as const;
  return useApiQuery(
    artifactExecutionsService.keys.list(query),
    ({ signal }) => artifactExecutionsService.list(query, { signal }),
    ASSETS_REFRESH.related,
  );
}

/**
 * Contagem total de um vínculo, como o servidor a devolveu.
 *
 * Usa `limit: 1` porque só interessa `meta.total`: contar é do banco, e trazer
 * a página inteira para medir o tamanho dela seria desperdício.
 */
export function useAssetOperationsCount(assetId: string, status?: string) {
  const query = { assetId, status, limit: 1, page: 1 } as const;
  return useApiQuery(
    operationsService.keys.list(query),
    ({ signal }) => operationsService.list(query, { signal }),
    ASSETS_REFRESH.related,
  );
}

export function useAssetExecutionsCount(assetId: string) {
  const query = { assetId, limit: 1, page: 1 } as const;
  return useApiQuery(
    artifactExecutionsService.keys.list(query),
    ({ signal }) => artifactExecutionsService.list(query, { signal }),
    ASSETS_REFRESH.related,
  );
}

function useAssetWriteOptions(id?: string) {
  const queryClient = useQueryClient();

  return {
    onSuccess: async (asset: Asset) => {
      const key = assetsService.keys.detail(id ?? asset.id);
      await queryClient.cancelQueries({ queryKey: key });
      /** Estado confirmado pelo servidor — não antecipação. */
      queryClient.setQueryData(key, asset);
      await queryClient.invalidateQueries({
        queryKey: assetsService.keys.lists(),
      });
    },
  } as const;
}

export function useCreateAsset() {
  const options = useAssetWriteOptions();
  return useApiMutation(
    (input: CreateAssetInput) => assetsService.create(input),
    { ...options, notify: "Equipamento cadastrado" },
  );
}

export function useUpdateAsset(id: string) {
  const options = useAssetWriteOptions(id);
  return useApiMutation(
    (input: UpdateAssetInput) => assetsService.update(id, input),
    { ...options, scope: { id: `assets:${id}` }, notify: "Equipamento atualizado" },
  );
}

export function useRemoveAsset() {
  const queryClient = useQueryClient();
  return useApiMutation((id: string) => assetsService.remove(id), {
    notify: "Equipamento removido",
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: assetsService.keys.module() }),
  });
}
