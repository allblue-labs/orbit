"use client";

/**
 * Criação e edição de item do catálogo.
 *
 * Escreve em `POST /catalog/products` e `PATCH /catalog/products/:id`. O
 * formulário oferece exatamente o que `CreateProductDto` aceita — nome, tipo,
 * SKU, descrição, unidade, preço de venda, preço de custo, categoria e unidade
 * de negócio — e nada além.
 *
 * ## O que não é decidido aqui
 *
 * - **Disponibilidade na criação.** `CreateProductDto` não tem `status`: o
 *   item nasce `ACTIVE` pelo default do schema. Retirar de circulação é uma
 *   ação posterior, verificada — `POST` com `status` responde
 *   `400 property status should not exist`.
 * - **O SKU na criação.** Não é pedido: o servidor o gera, com contagem própria
 *   por fluxo. O campo era opcional e ninguém o preenchia — todo item nascia sem
 *   código. Na edição ele aparece, porque quem importou um catálogo antigo precisa
 *   ajustar o código para bater com a nota fiscal de antes.
 * - **Unicidade do SKU.** O banco tem `@@unique([organizationId, sku])`; a
 *   tela não pré-verifica. Duplicidade volta como 409 e aparece como veio.
 * - **`taxData` e `metadata`.** JSON livre do tenant, sem esquema no contrato.
 *   O formulário não inventa campos para eles.
 * - **Qualquer conta.** Margem, imposto, total: nenhum número é derivado de
 *   outro aqui. Preço de venda e custo são dois campos independentes que o
 *   usuário informa.
 *
 * ## Escopo do item
 *
 * `businessUnitId` é opcional no contrato: sem ele, o item vale para a
 * organização inteira. É o padrão do formulário, porque um catálogo costuma
 * ser da empresa — restringir a uma unidade é a exceção, e o `UpdateProductDto`
 * oferece `organizationWide` justamente para desfazer.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG_KIND_LABELS } from "@/entities";
import {
  useCatalogCategories,
  useCreateCatalogItem,
  useUpdateCatalogItem,
} from "@/hooks/catalog/use-catalog";
import { useActiveScope } from "@/providers/use-active-scope";
import { ProductKind } from "@/types/contracts";
import {
  CATALOG_LIMITS,
  type CatalogItem,
  type CreateCatalogItemInput,
  type UpdateCatalogItemInput,
} from "@/types/catalog";

/** "Sem categoria" e "toda a organização" precisam de um valor no `Select`. */
const NONE = "__none__";

interface FormState {
  name: string;
  kind: ProductKind;
  sku: string;
  description: string;
  unit: string;
  salePrice: string;
  costPrice: string;
  categoryId: string;
  businessUnitId: string;
}

function initialState(item: CatalogItem | null, kind: ProductKind): FormState {
  return {
    name: item?.name ?? "",
    kind: item?.kind ?? kind,
    sku: item?.sku ?? "",
    description: item?.description ?? "",
    unit: item?.unit ?? (kind === ProductKind.SERVICE ? "H" : "UN"),
    salePrice: item?.salePrice ?? "",
    costPrice: item?.costPrice ?? "",
    categoryId: item?.categoryId ?? "",
    businessUnitId: item?.businessUnitId ?? "",
  };
}

const optional = (value: string): string | undefined =>
  value.trim() ? value.trim() : undefined;

/**
 * Texto → número, só na fronteira com a API.
 *
 * O DTO aceita `@IsNumber({ maxDecimalPlaces: 2 })`. Campo vazio vira
 * `undefined` (sem preço), não `0` — que significaria "de graça".
 */
const price = (value: string): number | undefined => {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function CatalogItemFormDialog({
  open,
  onOpenChange,
  editing = null,
  /** Tipo pré-selecionado — a aba que abriu o formulário. */
  defaultKind = ProductKind.PRODUCT,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: CatalogItem | null;
  defaultKind?: ProductKind;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <Body
          key={editing?.id ?? `new:${defaultKind}`}
          editing={editing}
          defaultKind={defaultKind}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  defaultKind,
  onOpenChange,
}: {
  editing: CatalogItem | null;
  defaultKind: ProductKind;
  onOpenChange: (open: boolean) => void;
}) {
  const { businessUnits } = useActiveScope();
  const categories = useCatalogCategories();
  const [form, setForm] = useState<FormState>(() =>
    initialState(editing, defaultKind),
  );

  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem(editing?.id ?? "");
  const mutation = editing ? update : create;

  const set = <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const base = (): CreateCatalogItemInput => ({
    name: form.name.trim(),
    kind: form.kind,
    sku: optional(form.sku),
    description: optional(form.description),
    unit: optional(form.unit),
    salePrice: price(form.salePrice),
    costPrice: price(form.costPrice),
    categoryId: optional(form.categoryId),
    businessUnitId: optional(form.businessUnitId),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const done = () => onOpenChange(false);

    if (!editing) {
      create.mutate(base(), { onSuccess: done });
      return;
    }

    /*
      `undefined` significa "não mexa" no DTO — não há como pedir "remova"
      passando vazio. Por isso os dois desligamentos explícitos que o
      `UpdateProductDto` oferece.
    */
    const input: UpdateCatalogItemInput = {
      ...base(),
      uncategorized: editing.categoryId !== null && !form.categoryId,
      organizationWide: editing.businessUnitId !== null && !form.businessUnitId,
    };
    update.mutate(input, { onSuccess: done });
  };

  const incomplete = form.name.trim().length < CATALOG_LIMITS.nameMinLength;
  const isService = form.kind === ProductKind.SERVICE;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {editing
            ? `Editar ${CATALOG_KIND_LABELS[form.kind]?.toLowerCase() ?? "item"}`
            : `Novo ${CATALOG_KIND_LABELS[defaultKind]?.toLowerCase() ?? "item"}`}
        </DialogTitle>
        <DialogDescription>
          O catálogo é a fonte oficial de preço e descrição da plataforma.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" htmlFor="catalog-name" className="sm:col-span-2">
          <Input
            id="catalog-name"
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            maxLength={CATALOG_LIMITS.nameMaxLength}
            placeholder={
              isService
                ? "Ex.: Limpeza de evaporadora"
                : "Ex.: Filtro G4 620x620"
            }
            required
          />
        </Field>

        <Field label="Tipo" htmlFor="catalog-kind">
          <Select
            value={form.kind}
            onValueChange={(value) => set("kind", value as ProductKind)}
          >
            <SelectTrigger id="catalog-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(ProductKind).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {CATALOG_KIND_LABELS[kind] ?? kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Unidade de medida"
          htmlFor="catalog-unit"
          hint={
            isService
              ? "Como o serviço é cobrado: H (hora), VISITA, M2…"
              : "UN, CX, M, KG…"
          }
        >
          <Input
            id="catalog-unit"
            value={form.unit}
            onChange={(event) => set("unit", event.target.value.toUpperCase())}
            maxLength={CATALOG_LIMITS.unitMaxLength}
            className="font-mono uppercase"
          />
        </Field>

        {/*
          Na criação o SKU não é pedido: o servidor o gera, com contagem própria
          do fluxo — `PRD-000001` para produto, `SRV-000001` para serviço,
          `PEC-000001` para peça. O campo existia, ninguém preenchia, e todo item
          nascia sem código.

          Na edição ele aparece: quem vem de outro sistema precisa poder ajustar o
          código para bater com a nota fiscal antiga, e o contrato aceita.
        */}
        {editing ? (
          <Field
            label="SKU"
            htmlFor="catalog-sku"
            hint="Gerado pelo sistema na criação. Único na organização: não é possível repetir um código já usado."
          >
            <Input
              id="catalog-sku"
              value={form.sku}
              onChange={(event) => set("sku", event.target.value)}
              maxLength={CATALOG_LIMITS.skuMaxLength}
              className="font-mono"
            />
          </Field>
        ) : (
          <Field label="SKU">
            <p className="text-muted-foreground text-sm">
              Gerado pelo sistema quando o item for criado, com a contagem
              própria de{" "}
              {CATALOG_KIND_LABELS[form.kind]?.toLowerCase() ?? "item"}.
            </p>
          </Field>
        )}

        <Field label="Categoria" htmlFor="catalog-category">
          <Select
            value={form.categoryId || NONE}
            onValueChange={(value) =>
              set("categoryId", value === NONE ? "" : value)
            }
          >
            <SelectTrigger id="catalog-category">
              <SelectValue placeholder="Sem categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem categoria</SelectItem>
              {(categories.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Preço de venda"
          htmlFor="catalog-sale-price"
          hint="Vazio significa sem preço definido, não gratuito."
        >
          <Input
            id="catalog-sale-price"
            value={form.salePrice}
            onChange={(event) => set("salePrice", event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className="tabular-nums"
          />
        </Field>

        <Field label="Preço de custo" htmlFor="catalog-cost-price">
          <Input
            id="catalog-cost-price"
            value={form.costPrice}
            onChange={(event) => set("costPrice", event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className="tabular-nums"
          />
        </Field>

        <Field
          label="Disponível em"
          htmlFor="catalog-unit-scope"
          className="sm:col-span-2"
          hint="Sem organização, o item vale para a conta inteira."
        >
          <Select
            value={form.businessUnitId || NONE}
            onValueChange={(value) =>
              set("businessUnitId", value === NONE ? "" : value)
            }
          >
            <SelectTrigger id="catalog-unit-scope">
              <SelectValue placeholder="Toda a organização" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Toda a organização</SelectItem>
              {businessUnits.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.tradeName ?? unit.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={isService ? "Descrição do serviço" : "Descrição"}
          htmlFor="catalog-description"
          className="sm:col-span-2"
          hint={
            isService
              ? "O que está incluso, o que não está, e as observações que a equipe precisa ver."
              : undefined
          }
        >
          <Textarea
            id="catalog-description"
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            rows={isService ? 5 : 3}
          />
        </Field>
      </div>

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || mutation.isPending}>
          {mutation.isPending ? "Salvando…" : editing ? "Salvar" : "Criar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  /**
   * Opcional porque há um campo que não é campo: o SKU na criação é texto
   * informativo, sem controle para o rótulo apontar. `<Label htmlFor>` vazio
   * apontaria para um `id` inexistente, e leitor de tela anuncia rótulo órfão.
   */
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {htmlFor ? (
        <Label htmlFor={htmlFor}>{label}</Label>
      ) : (
        <span className="text-sm font-medium leading-none">{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
