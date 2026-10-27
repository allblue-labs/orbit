/**
 * Contratos do Catálogo (`/catalog`).
 *
 * Os **literais** (`ProductKind`, `ProductStatus`) vêm dos contratos
 * sincronizados e não são redeclarados.
 *
 * A forma do item é **espelhada**: o módulo não publica Read Model — o
 * controller devolve o registro do Prisma com os `include` de categoria e
 * unidade. Mudança silenciosa naquele `include` não quebra a compilação;
 * quebra em runtime, com campo nulo. Daí cada acesso a relação ser tolerante.
 *
 * ## Produtos e serviços são o mesmo registro
 *
 * Não há duas tabelas: `kind` distingue `PRODUCT`, `SERVICE` e `PART` dentro
 * de `products`. O Workspace apresenta abas separadas porque a pessoa que
 * cadastra pensa neles como coisas diferentes, mas o contrato é um só — e é
 * por isso que filtrar por `kind` é filtro do servidor, não recorte de tela.
 *
 * ## Preços chegam como texto
 *
 * `salePrice` e `costPrice` são `Decimal(14,2)` no banco e o Prisma os
 * serializa como **string** (`"89.9"`). É o certo: `number` em JavaScript
 * perde precisão em dinheiro. A tela converte só para formatar, e nunca
 * calcula sobre eles.
 */
import type { ProductKind, ProductStatus } from "./contracts";

export type { ProductKind, ProductStatus };

/** Recorte de categoria devolvido junto do item. */
export interface CatalogCategoryRef {
  id: string;
  name: string;
  slug: string;
}

/** Recorte de unidade devolvido junto do item. */
export interface CatalogBusinessUnitRef {
  id: string;
  legalName: string;
  tradeName: string | null;
}

/** Item do catálogo — produto, serviço ou peça. */
export interface CatalogItem {
  id: string;
  organizationId: string;
  /** `null` quando o item vale para a organização inteira. */
  businessUnitId: string | null;
  categoryId: string | null;
  kind: ProductKind;
  sku: string | null;
  name: string;
  description: string | null;
  /** Unidade de medida — texto livre no contrato (`UN`, `H`, `M2`…). */
  unit: string;
  /** `Decimal(14,2)` serializado como string. */
  salePrice: string | null;
  costPrice: string | null;
  /** JSON livre — o backend não interpreta. */
  taxData: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: ProductStatus;
  /** Disponibilidade física no escopo consultado; serviços não têm estoque. */
  stockAvailable?: boolean | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category: CatalogCategoryRef | null;
  businessUnit: CatalogBusinessUnitRef | null;
}

/** Categoria do catálogo — hierárquica por `parentId`. */
export interface CatalogCategory {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
  /** Derivado do nome pelo servidor; a tela não o gera. */
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** `GET /catalog/products` (`CatalogQueryDto`). */
export interface CatalogQuery {
  search?: string;
  kind?: ProductKind;
  categoryId?: string;
  businessUnitId?: string;
  status?: ProductStatus;
  page?: number;
  limit?: number;
}

/** `POST /catalog/products` (`CreateProductDto`). */
export interface CreateCatalogItemInput {
  name: string;
  kind: ProductKind;
  sku?: string;
  description?: string;
  unit?: string;
  salePrice?: number;
  costPrice?: number;
  categoryId?: string;
  businessUnitId?: string;
  taxData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  initialStock?: number;
  initialStockBusinessUnitId?: string;
}

/**
 * `PATCH /catalog/products/:id` (`UpdateProductDto`).
 *
 * Acrescenta `status` — ativar e desativar — e os dois desligamentos
 * explícitos que o DTO oferece, porque `undefined` significa "não mexa" e não
 * há como pedir "remova" de outro jeito.
 */
export interface UpdateCatalogItemInput extends Partial<
  Omit<CreateCatalogItemInput, "initialStock" | "initialStockBusinessUnitId">
> {
  status?: ProductStatus;
  /** Remove o recorte de unidade e torna o item da organização inteira. */
  organizationWide?: boolean;
  /** Remove a categoria atual. */
  uncategorized?: boolean;
}

/** `POST /catalog/categories` (`CreateProductCategoryDto`). */
export interface CreateCatalogCategoryInput {
  name: string;
  description?: string;
  parentId?: string;
}

export type UpdateCatalogCategoryInput = Partial<CreateCatalogCategoryInput>;

/** Limites declarados pelo `class-validator`, para retorno imediato na tela. */
export const CATALOG_LIMITS = {
  nameMinLength: 2,
  nameMaxLength: 180,
  skuMaxLength: 80,
  unitMaxLength: 20,
  searchMaxLength: 180,
  categoryNameMinLength: 2,
  categoryNameMaxLength: 140,
} as const;

/**
 * O que o contrato do catálogo **não** tem, e que a tela por isso não inventa:
 *
 * - **duração padrão de serviço** — não há coluna; `POST` com
 *   `durationMinutes` é recusado pelo `forbidNonWhitelisted`;
 * - **Analytics de catálogo** — `AnalyticsDomain` cobre operações, PMOC,
 *   equipamentos, técnicos, contratos e ambiente. Catálogo não está lá;
 * - **IA por item** — `AiExecutionQueryDto` não aceita `productId`.
 *
 * Um tenant pode gravar qualquer um deles em `metadata`, que é JSON livre —
 * mas isso é convenção da organização, não contrato, e a tela não o promove a
 * campo de primeira classe.
 */
export const CATALOG_CONTRACT_GAPS = [
  "serviceDuration",
  "analytics",
  "intelligence",
] as const;
