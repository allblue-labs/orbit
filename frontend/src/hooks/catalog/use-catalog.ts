"use client";

/**
 * Query Layer do Catálogo.
 *
 * ## Cadência
 *
 * O cadastro muda por edição; sua disponibilidade também muda com as
 * movimentações em campo. Por isso usamos `CACHE.live` para os itens e
 * `CACHE.catalog` para as categorias.
 *
 * ## Sem atualização otimista
 *
 * `POST`/`PATCH /catalog/products` podem ser recusados por SKU duplicado
 * (`@@unique([organizationId, sku])`), por categoria inexistente ou por
 * unidade inválida. As escritas **semeiam o cache com a resposta**, que é o
 * estado confirmado — antecipar mostraria um dado que o servidor talvez
 * rejeite.
 *
 * ## Invalidação
 *
 * Escrever um item derruba as listas de itens. Escrever uma categoria derruba
 * as categorias **e** as listas de itens — porque cada item traz a categoria
 * embutida (`include`), e renomear uma categoria muda o que as linhas exibem.
 */
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { catalogService } from "@/services/catalog.service";
import { inventoryService } from "@/services/inventory.service";
import { useActiveScope } from "@/providers/use-active-scope";
import type {
  CatalogItem,
  CatalogQuery,
  CreateCatalogCategoryInput,
  CreateCatalogItemInput,
  UpdateCatalogCategoryInput,
  UpdateCatalogItemInput,
} from "@/types/catalog";

export const CATALOG_REFRESH = {
  list: CACHE.live,
  detail: CACHE.fresh,
  categories: CACHE.catalog,
} as const;

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

export function useCatalogItems(query: CatalogQuery) {
  const { organizationId, businessUnitId } = useActiveScope();
  const scoped = {
    ...query,
    businessUnitId: query.businessUnitId ?? businessUnitId ?? undefined,
  };
  return useApiQuery(
    catalogService.keys.scopedList(scoped, organizationId),
    ({ signal }) => catalogService.list(scoped, { signal }),
    {
      ...CATALOG_REFRESH.list,
      enabled: Boolean(organizationId),
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      /** Mantém a página anterior visível durante a troca de página. */
      placeholderData: (previous, previousQuery) => {
        const previousScope = previousQuery?.queryKey[4] as
          { organizationId?: string } | undefined;
        const previousParams = previousQuery?.queryKey[3] as
          CatalogQuery | undefined;
        return previousScope?.organizationId === organizationId &&
          previousParams?.businessUnitId === scoped.businessUnitId &&
          previousParams?.kind === scoped.kind
          ? previous
          : undefined;
      },
    },
  );
}

export function useCatalogItem(id: string | null) {
  return useApiQuery(
    catalogService.keys.detail(id ?? ""),
    ({ signal }) => catalogService.get(id as string, { signal }),
    { ...CATALOG_REFRESH.detail, enabled: id !== null },
  );
}

export function useCatalogCategories() {
  return useApiQuery(
    catalogService.keys.categories(),
    ({ signal }) => catalogService.categories({ signal }),
    CATALOG_REFRESH.categories,
  );
}

/**
 * Contagem de um recorte do catálogo.
 *
 * `limit: 1` e o número vem do `meta.total` do servidor. É a mesma técnica do
 * Execution Center, pelo mesmo motivo: **o Analytics não cobre catálogo**
 * (`AnalyticsDomain` é operações, PMOC, equipamentos, técnicos, contratos e
 * ambiente), e contar no cliente daria o tamanho da página, não o do catálogo.
 */
export function useCatalogCount(query: CatalogQuery) {
  const { organizationId, businessUnitId } = useActiveScope();
  const scoped: CatalogQuery = {
    ...query,
    businessUnitId: query.businessUnitId ?? businessUnitId ?? undefined,
    page: 1,
    limit: 1,
  };
  const result = useApiQuery(
    catalogService.keys.scopedList(scoped, organizationId),
    ({ signal }) => catalogService.list(scoped, { signal }),
    {
      ...CACHE.stable,
      enabled: Boolean(organizationId),
      refetchOnMount: "always",
    },
  );

  return {
    total: result.data?.meta.total,
    isPending: result.isPending,
    error: result.error,
    refetch: result.refetch,
  };
}

/* ------------------------------------------------------------------ */
/* Escritas                                                            */
/* ------------------------------------------------------------------ */

function useItemWriteOptions(id?: string) {
  const queryClient = useQueryClient();

  return {
    onSuccess: async (item: CatalogItem) => {
      const key = catalogService.keys.detail(id ?? item.id);
      await queryClient.cancelQueries({ queryKey: key });
      /** Estado confirmado pelo servidor — não antecipação. */
      queryClient.setQueryData(key, item);
      await queryClient.invalidateQueries({
        queryKey: catalogService.keys.lists(),
      });
      await Promise.all(
        [
          inventoryService.keys.all(),
          inventoryService.keys.balanceLists(),
          inventoryService.keys.movementLists(),
          inventoryService.keys.summary(),
          inventoryService.keys.consumption(),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  } as const;
}

export function useCreateCatalogItem() {
  const options = useItemWriteOptions();
  return useApiMutation(
    (input: CreateCatalogItemInput) => catalogService.create(input),
    options,
  );
}

export function useUpdateCatalogItem(id: string) {
  const options = useItemWriteOptions(id);
  return useApiMutation(
    (input: UpdateCatalogItemInput) => catalogService.update(id, input),
    /** Serializa as escritas do mesmo item — desativar e editar não se cruzam. */
    { ...options, scope: { id: `catalog:${id}` } },
  );
}

export function useRemoveCatalogItem() {
  const queryClient = useQueryClient();
  return useApiMutation((id: string) => catalogService.remove(id), {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: catalogService.keys.lists(),
      });
    },
  });
}

/**
 * Escritas de categoria invalidam **as duas** listas.
 *
 * O item traz `category` embutida pelo `include` do repositório: renomear uma
 * categoria muda o que as linhas de produto mostram, e manter as listas em
 * cache exibiria o nome antigo até a próxima navegação.
 */
function useCategoryInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: catalogService.keys.categoriesModule(),
      }),
      queryClient.invalidateQueries({
        queryKey: catalogService.keys.lists(),
      }),
    ]);
  };
}

export function useCreateCatalogCategory() {
  const invalidate = useCategoryInvalidation();
  return useApiMutation(
    (input: CreateCatalogCategoryInput) => catalogService.createCategory(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateCatalogCategory(id: string) {
  const invalidate = useCategoryInvalidation();
  return useApiMutation(
    (input: UpdateCatalogCategoryInput) =>
      catalogService.updateCategory(id, input),
    { onSuccess: invalidate, scope: { id: `catalog-category:${id}` } },
  );
}

/**
 * Remoção de categoria.
 *
 * O backend recusa com 409 quando há filhas ou produtos vinculados
 * (`categoryDependencies`). A tela não pré-verifica: perguntar antes seria uma
 * segunda fonte de verdade, desatualizada no instante seguinte.
 */
export function useRemoveCatalogCategory() {
  const invalidate = useCategoryInvalidation();
  return useApiMutation((id: string) => catalogService.removeCategory(id), {
    onSuccess: invalidate,
  });
}
