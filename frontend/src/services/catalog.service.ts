/**
 * Serviços do módulo Catálogo.
 *
 * Espelho um-para-um do `CatalogController`. Nenhuma regra vive aqui:
 * unicidade de SKU, validade das referências, dependências de categoria e
 * disponibilidade são decisões do backend.
 *
 * ## Uma coleção, dois recursos de cache
 *
 * Produtos, serviços e peças estão na mesma tabela e no mesmo endpoint —
 * `kind` os separa. As **keys** usam o recurso `catalog`, e `kind` entra nos
 * parâmetros: a aba Serviços e uma futura busca por serviços compartilham a
 * mesma consulta.
 *
 * Categorias são um recurso próprio (`catalog-categories`) porque têm ciclo de
 * vida independente: criar um produto não invalida a lista de categorias, e
 * criar uma categoria não invalida a lista de produtos.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { PaginatedResult, QueryParams, RequestOptions } from "@/types/api";
import type {
  CatalogCategory,
  CatalogItem,
  CatalogQuery,
  CreateCatalogCategoryInput,
  CreateCatalogItemInput,
  UpdateCatalogCategoryInput,
  UpdateCatalogItemInput,
} from "@/types/catalog";

const ITEMS = "catalog";
const CATEGORIES = "catalog-categories";

const BASE_PATH = "/catalog";
const PRODUCTS_PATH = `${BASE_PATH}/products`;
const CATEGORIES_PATH = `${BASE_PATH}/categories`;

const asParams = (query: object | undefined): QueryParams | undefined =>
  query as QueryParams | undefined;

const product = (id: string): string =>
  `${PRODUCTS_PATH}/${encodeURIComponent(id)}`;
const category = (id: string): string =>
  `${CATEGORIES_PATH}/${encodeURIComponent(id)}`;

export const catalogService = {
  basePath: BASE_PATH,

  list: (
    query?: CatalogQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<CatalogItem>> =>
    apiClient.get<PaginatedResult<CatalogItem>>(PRODUCTS_PATH, {
      ...options,
      query: asParams(query),
    }),

  get: (id: string, options?: RequestOptions): Promise<CatalogItem> =>
    apiClient.get<CatalogItem>(product(id), options),

  create: (input: CreateCatalogItemInput): Promise<CatalogItem> =>
    apiClient.post<CatalogItem>(PRODUCTS_PATH, input),

  update: (id: string, input: UpdateCatalogItemInput): Promise<CatalogItem> =>
    apiClient.patch<CatalogItem>(product(id), input),

  /**
   * Soft delete.
   *
   * Diferente de desativar: o item some das listagens. Desativar é
   * `update(id, { status: 'INACTIVE' })` e o mantém visível e auditável.
   */
  remove: (id: string): Promise<void> => apiClient.delete<void>(product(id)),

  /**
   * Categorias.
   *
   * `GET /catalog/categories` **não é paginado** — devolve o array inteiro,
   * ordenado por nome. É coerente: uma organização tem dezenas de categorias,
   * não milhares, e a árvore precisa estar completa para ser montada.
   */
  categories: (options?: RequestOptions): Promise<CatalogCategory[]> =>
    apiClient.get<CatalogCategory[]>(CATEGORIES_PATH, options),

  createCategory: (
    input: CreateCatalogCategoryInput,
  ): Promise<CatalogCategory> =>
    apiClient.post<CatalogCategory>(CATEGORIES_PATH, input),

  updateCategory: (
    id: string,
    input: UpdateCatalogCategoryInput,
  ): Promise<CatalogCategory> =>
    apiClient.patch<CatalogCategory>(category(id), input),

  removeCategory: (id: string): Promise<void> =>
    apiClient.delete<void>(category(id)),

  keys: {
    module: (): QueryKey => queryKeys.module(ITEMS),
    lists: (): QueryKey => queryKeys.lists(ITEMS),
    list: (query?: CatalogQuery): QueryKey =>
      queryKeys.list(ITEMS, asParams(query)),
    scopedList: (
      query: CatalogQuery,
      organizationId: string | null,
    ): QueryKey => [
      ...queryKeys.list(ITEMS, asParams(query)),
      { organizationId },
    ],
    detail: (id: string): QueryKey => queryKeys.detail(ITEMS, id),

    categoriesModule: (): QueryKey => queryKeys.module(CATEGORIES),
    categories: (): QueryKey => queryKeys.list(CATEGORIES),
  },
} as const;
