"use client";

/**
 * Catalog Workspace — a fonte oficial de produtos e serviços.
 *
 * ## Uma tabela, cinco abas
 *
 * Produtos, serviços e peças são o **mesmo registro** com `kind` diferente
 * dentro de `products`. As abas existem porque quem cadastra pensa neles como
 * coisas distintas; o contrato continua sendo um, e `kind` é filtro do
 * servidor.
 *
 * É por isso que **não há Catalog Registry**: um registry resolve "o que este
 * identificador significa", e aqui não há identificador para resolver — há uma
 * entidade (`catalog-item`) no Entity Registry, com as suas ações no Action
 * Registry. Criar um registry para dois valores de `kind` seria cerimônia.
 *
 * ## Fonte oficial
 *
 * O catálogo é onde preço, descrição e unidade de medida vivem. Nenhum outro
 * módulo os redeclara: quando Operações, Orçamentos ou Vendas precisarem de um
 * item, o caminho é `GET /catalog/products` com o filtro adequado — não uma
 * cópia local.
 *
 * ## O que não existe, e está declarado
 *
 * Estoque, duração de serviço, Analytics de catálogo e IA por item não têm
 * contrato. Cada ausência aparece onde seria consumida, com o motivo — em vez
 * de sumir da tela ou virar número inventado.
 */
import { ContentContainer } from "@/components/layout/page-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductKind } from "@/types/contracts";
import { TabBoundary } from "@/workspace";
import { CatalogKpis } from "./catalog-kpis";
import { CatalogCategoriesTab } from "./tabs/categories.tab";
import { CatalogItemsTab } from "./tabs/items.tab";
import { CatalogStockTab } from "./tabs/stock.tab";

export function CatalogWorkspace() {
  return (
    <ContentContainer size="wide" className="space-y-6">
      <TabBoundary id="catalog-kpis" label="os indicadores">
        <CatalogKpis />
      </TabBoundary>

      <Tabs defaultValue="produtos">
        <TabsList>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="servicos">Serviços</TabsTrigger>
          <TabsTrigger value="pecas">Peças</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
        </TabsList>

        <TabsContent value="produtos">
          <TabBoundary id="catalog-products" label="os produtos">
            <CatalogItemsTab
              kind={ProductKind.PRODUCT}
              noun="produto"
              emptyTitle="Nenhum produto cadastrado"
              emptyDescription="Produtos são os itens físicos que a organização vende ou aplica em campo."
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="servicos">
          <TabBoundary id="catalog-services" label="os serviços">
            <CatalogItemsTab
              kind={ProductKind.SERVICE}
              noun="serviço"
              emptyTitle="Nenhum serviço cadastrado"
              emptyDescription="Serviços trazem preço e unidade de cobrança — e são o que as operações passarão a referenciar."
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="pecas">
          <TabBoundary id="catalog-parts" label="as peças">
            <CatalogItemsTab
              kind={ProductKind.PART}
              noun="peça"
              gender="f"
              emptyTitle="Nenhuma peça cadastrada"
              emptyDescription="Peças de reposição usadas em manutenção. O contrato já as distingue de produtos (`kind: PART`)."
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="categorias">
          <TabBoundary id="catalog-categories" label="as categorias">
            <CatalogCategoriesTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="estoque">
          <TabBoundary id="catalog-stock" label="o estoque">
            <CatalogStockTab />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
