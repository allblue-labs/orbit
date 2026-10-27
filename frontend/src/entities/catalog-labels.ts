/**
 * Rótulos dos literais do catálogo.
 *
 * Ficam aqui, e não em um componente, porque o Entity Registry precisa deles e
 * o registry não deve depender de árvore de componentes. `ProductKind` e
 * `ProductStatus` são listas fechadas nos contratos sincronizados
 * (`backend/src/contracts/literals`); o mapa cobre exatamente esses valores e
 * qualquer outro é exibido cru.
 */
import type { ProductKind, ProductStatus } from "@/types/contracts";

export const CATALOG_KIND_LABELS: Readonly<
  Record<ProductKind | string, string>
> = {
  PRODUCT: "Produto",
  SERVICE: "Serviço",
  PART: "Peça",
};

export const CATALOG_STATUS_LABELS: Readonly<
  Record<ProductStatus | string, string>
> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};
