"use client";

/**
 * Detalhe de um item do catálogo.
 *
 * Painel lateral, não página: o cadastro é curto, e uma rota própria seria uma
 * navegação a mais sem nada a mais. É por isso que o Entity Registry declara
 * `href: () => ROUTES.catalog` — não há rota por item.
 *
 * ## Estoque
 *
 * A seção declarava a ausência do domínio até a Backend PR-23; agora mostra os
 * saldos reais por unidade, de `/inventory/items/:id`.
 *
 * **Preço vem do Catálogo, quantidade vem do Estoque.** Os dois contratos não
 * se misturam: o painel de preço não exibe saldo, e o de saldo não exibe
 * preço.
 *
 * `SERVICE` não recebe controle nenhum — nem saldo zero.
 */
import { PackageSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { InventoryItemSection } from "@/components/inventory/inventory-item.section";
import { useAction } from "@/actions";
import { CATALOG_KIND_LABELS } from "@/entities";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import { ProductKind } from "@/types/contracts";
import type { CatalogItem } from "@/types/catalog";
import {
  CostLabel,
  DetailRow,
  PriceLabel,
  SkuLabel,
  CatalogAvailabilityBadge,
} from "./catalog-presentation";

export function CatalogItemSheet({
  item,
  onOpenChange,
  onEdit,
}: {
  item: CatalogItem | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (item: CatalogItem) => void;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item ? <Body item={item} onEdit={onEdit} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  item,
  onEdit,
}: {
  item: CatalogItem;
  onEdit: (item: CatalogItem) => void;
}) {
  const { formatDateTime } = useDateFormatters();
  const edit = useAction("catalog-item.update");
  const isService = item.kind === ProductKind.SERVICE;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {item.name}
          <CatalogAvailabilityBadge item={item} />
        </SheetTitle>
        <SheetDescription>
          {CATALOG_KIND_LABELS[item.kind] ?? item.kind} · atualizado em{" "}
          {formatDateTime(item.updatedAt)}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        {edit.allowed ? (
          <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
            <edit.definition.icon className="size-4" />
            {edit.label}
          </Button>
        ) : null}

        <dl className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
          <DetailRow label="Tipo">
            <Badge variant="secondary">
              {CATALOG_KIND_LABELS[item.kind] ?? item.kind}
            </Badge>
          </DetailRow>
          <DetailRow label="SKU">
            <SkuLabel sku={item.sku} />
          </DetailRow>
          <DetailRow label="Categoria">
            <span className="text-sm">{item.category?.name ?? "—"}</span>
          </DetailRow>
          <DetailRow label="Unidade de medida">
            <span className="font-mono text-sm">{item.unit}</span>
          </DetailRow>
          <DetailRow label="Preço de venda">
            <PriceLabel item={item} />
          </DetailRow>
          <DetailRow label="Preço de custo">
            <CostLabel item={item} />
          </DetailRow>
          <DetailRow label="Disponível em">
            <span className="text-sm">
              {item.businessUnit
                ? (item.businessUnit.tradeName ?? item.businessUnit.legalName)
                : "Toda a organização"}
            </span>
          </DetailRow>
          <DetailRow label="Cadastrado em">
            <span className="text-sm">{formatDateTime(item.createdAt)}</span>
          </DetailRow>
        </dl>

        {item.description ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              {isService ? "Descrição do serviço" : "Descrição"}
            </h3>
            <p className="text-sm whitespace-pre-line text-muted-foreground">
              {item.description}
            </p>
          </section>
        ) : null}

        {isService ? (
          <ServiceGaps />
        ) : (
          /*
            Sem histórico aqui: o painel lateral é estreito, e a listagem
            completa mora na aba Estoque do Workspace. O que cabe é o saldo.
          */
          <InventoryItemSection
            item={{
              id: item.id,
              name: item.name,
              kind: item.kind,
              unit: item.unit,
            }}
            withHistory={false}
          />
        )}
      </div>
    </>
  );
}

/**
 * Duração de serviço — a ausência, declarada.
 *
 * `CreateProductDto` não aceita `durationMinutes`; verificado contra a API,
 * que responde `400 property durationMinutes should not exist`. A duração
 * prevista de um serviço é informação legítima de catálogo e ainda não existe
 * no contrato.
 */
function ServiceGaps() {
  return (
    <section className="space-y-2 rounded-xl border border-dashed border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <PackageSearch className="size-4 text-muted-foreground" aria-hidden />
        Duração padrão
      </h3>
      <p className="text-sm text-muted-foreground">
        O contrato do catálogo não tem campo de duração. Enquanto isso, a
        unidade de medida (<span className="font-mono">{"H"}</span>,{" "}
        <span className="font-mono">VISITA</span>) e a descrição carregam essa
        informação — e é o agendamento que define a janela real de cada
        execução.
      </p>
    </section>
  );
}
