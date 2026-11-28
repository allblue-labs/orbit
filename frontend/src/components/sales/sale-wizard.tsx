"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { queryKeys } from "@/api/query-keys";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { CustomerPicker } from "@/components/customers/customer-picker";
import { today } from "@/components/financial/receipts/receipt-wizard.model";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePaginatedQuery } from "@/hooks/api/use-api-query";
import { useTimeZone } from "@/hooks/use-timezone";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types/customers";
import {
  PAYMENT_METHODS,
  decimal,
  lineTotal,
  saleMoney,
  scaled,
  type SaleInput,
  type SalePaymentMethod,
  type SaleProduct,
} from "./sale-model";

const STEPS = ["Cliente", "Produtos", "Pagamento", "Revisão"] as const;
type Item = { product: SaleProduct; quantity: string; price: string };
type Payment = {
  method: SalePaymentMethod;
  amount: string;
  installments: string;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

export function SaleWizard({
  unitId,
  unitName,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  unitId: string;
  unitName?: string;
  pending: boolean;
  error: unknown;
  onClose(): void;
  onSubmit(input: SaleInput): Promise<void>;
}) {
  const { timeZone } = useTimeZone();
  const [step, setStep] = useState(0);
  const [requestId] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [date, setDate] = useState(() => today(new Date(), timeZone));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [discount, setDiscount] = useState("");
  const [payments, setPayments] = useState<Payment[]>([
    { method: "PIX", amount: "", installments: "" },
  ]);
  const lines = items.map(({ quantity, price, product }) => {
    const qty = scaled(quantity, 3);
    const unitPrice = scaled(price, 2);
    const available = scaled(product.available, 3);
    return qty !== null &&
      qty > 0n &&
      unitPrice !== null &&
      available !== null &&
      qty <= available
      ? {
          productId: product.id,
          quantity: decimal(qty, 3),
          unitPrice: decimal(unitPrice),
          total: lineTotal(qty, unitPrice),
        }
      : null;
  });
  const subtotal = lines.reduce((sum, line) => sum + (line?.total ?? 0n), 0n);
  const rebate = scaled(discount || "0", 2);
  const total = subtotal - (rebate ?? 0n);
  const paymentAmounts = payments.map(({ amount }) =>
    scaled(
      amount || (payments.length === 1 && total > 0n ? decimal(total) : "0"),
      2,
    ),
  );
  const validCustomer =
    customer?.status === "ACTIVE" &&
    Boolean(date) &&
    date <= today(new Date(), timeZone);
  const validItems =
    items.length > 0 &&
    lines.every(Boolean) &&
    subtotal > 0n &&
    subtotal < 100_000_000_000_000n;
  const validPayments =
    rebate !== null &&
    total > 0n &&
    paymentAmounts.every((amount) => amount !== null && amount > 0n) &&
    paymentAmounts.reduce<bigint>((sum, amount) => sum + (amount ?? 0n), 0n) ===
      total &&
    payments.every(
      ({ method, installments }) =>
        method !== "CREDIT_CARD" ||
        !installments ||
        (/^\d+$/.test(installments) &&
          Number(installments) >= 1 &&
          Number(installments) <= 24),
    );
  const validStep = [
    validCustomer,
    validItems,
    validPayments,
    validCustomer && validItems && validPayments,
  ][step];
  const patchItem = (id: string, patch: Partial<Item>) =>
    setItems(
      items.map((item) =>
        item.product.id === id ? { ...item, ...patch } : item,
      ),
    );
  const patchPayment = (index: number, patch: Partial<Payment>) =>
    setPayments(
      payments.map((payment, position) =>
        position === index ? { ...payment, ...patch } : payment,
      ),
    );

  const submit = async () => {
    if (!customer || !validStep || rebate === null) return;
    try {
      await onSubmit({
        requestId,
        customerId: customer.id,
        paidOn: date,
        notes: notes.trim() || undefined,
        discount: decimal(rebate),
        items: lines.flatMap((line) =>
          line
            ? [
                {
                  productId: line.productId,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                },
              ]
            : [],
        ),
        payments: payments.map((payment, index) => ({
          method: payment.method,
          amount: decimal(paymentAmounts[index]!),
          ...(payment.method === "CREDIT_CARD" && payment.installments
            ? { installments: Number(payment.installments) }
            : {}),
        })),
      });
    } catch {
      // O erro da mutação aparece no wizard com o rascunho preservado.
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
          <DialogDescription>
            {STEPS[step]} · Etapa {step + 1} de {STEPS.length}
            {unitName ? ` · ${unitName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((title, index) => (
            <li
              key={title}
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "border-t-2 pt-2 text-xs",
                index <= step
                  ? "border-primary font-medium"
                  : "border-border text-muted-foreground",
              )}
            >
              {title}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="sale-customer">
                Cliente *
              </label>
              <CustomerPicker
                id="sale-customer"
                required
                activeOnly
                value={customer?.id}
                selectedLabel={customer?.tradeName ?? customer?.legalName}
                onChange={setCustomer}
              />
            </div>
            <Field label="Data do recebimento *">
              <Input
                type="date"
                required
                value={date}
                max={today(new Date(), timeZone)}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Field label="Observações">
              <Textarea
                value={notes}
                maxLength={500}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Referência do pagamento ou observação para o recibo"
              />
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            {items.length < 20 ? (
              <ProductSearch
                unitId={unitId}
                items={items}
                onAdd={(product) =>
                  setItems([
                    ...items,
                    {
                      product,
                      quantity:
                        Number(product.available) >= 1
                          ? "1"
                          : String(Number(product.available)).replace(".", ","),
                      price: product.salePrice?.replace(".", ",") ?? "",
                    },
                  ])
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Limite de 20 produtos por venda.
              </p>
            )}
            {items.map(({ product, quantity, price }, index) => (
              <div
                key={product.id}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto] sm:items-end"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {Number(product.available).toLocaleString("pt-BR")}{" "}
                    {product.unit} em estoque
                  </p>
                  {lines[index] ? (
                    <p className="mt-1 tabular-nums">
                      {saleMoney(decimal(lines[index]!.total))}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-destructive">
                      Confira a quantidade e o valor unitário.
                    </p>
                  )}
                </div>
                <Field label="Quantidade *">
                  <Input
                    required
                    inputMode="decimal"
                    aria-label={`Quantidade de ${product.name}`}
                    value={quantity}
                    onChange={(event) =>
                      patchItem(product.id, { quantity: event.target.value })
                    }
                  />
                </Field>
                <Field label="Valor unitário *">
                  <Input
                    required
                    inputMode="decimal"
                    aria-label={`Valor unitário de ${product.name}`}
                    value={price}
                    onChange={(event) =>
                      patchItem(product.id, { price: event.target.value })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover ${product.name}`}
                  onClick={() =>
                    setItems(
                      items.filter((item) => item.product.id !== product.id),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Desconto em reais">
                <Input
                  inputMode="decimal"
                  value={discount}
                  placeholder="0,00"
                  onChange={(event) => setDiscount(event.target.value)}
                />
              </Field>
              <p className="self-end rounded-lg bg-muted px-3 py-2 text-sm">
                Total a receber{" "}
                <strong className="ml-1">
                  {total > 0n ? saleMoney(decimal(total)) : "—"}
                </strong>
              </p>
            </div>
            {payments.map((payment, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              >
                <Field label="Forma de pagamento *">
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={payment.method}
                    onChange={(event) =>
                      patchPayment(index, {
                        method: event.target.value as SalePaymentMethod,
                        installments: "",
                      })
                    }
                  >
                    {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={
                    payments.length === 1
                      ? "Valor recebido"
                      : "Valor recebido *"
                  }
                >
                  <Input
                    inputMode="decimal"
                    value={payment.amount}
                    placeholder={
                      payments.length === 1 && total > 0n
                        ? decimal(total).replace(".", ",")
                        : "0,00"
                    }
                    onChange={(event) =>
                      patchPayment(index, { amount: event.target.value })
                    }
                  />
                </Field>
                {payments.length > 1 ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover pagamento ${index + 1}`}
                    onClick={() =>
                      setPayments(
                        payments.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
                {payment.method === "CREDIT_CARD" ? (
                  <Field label="Parcelas">
                    <Input
                      type="number"
                      min={1}
                      max={24}
                      placeholder="1"
                      value={payment.installments}
                      onChange={(event) =>
                        patchPayment(index, {
                          installments: event.target.value,
                        })
                      }
                    />
                  </Field>
                ) : null}
              </div>
            ))}
            {payments.length < 5 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setPayments([
                    ...payments.map((payment) => ({
                      ...payment,
                      amount:
                        payment.amount ||
                        (total > 0n ? decimal(total).replace(".", ",") : ""),
                    })),
                    { method: "CASH", amount: "", installments: "" },
                  ])
                }
              >
                <Plus className="size-4" /> Adicionar forma de pagamento
              </Button>
            ) : null}
            {!validPayments ? (
              <p className="text-sm text-muted-foreground">
                Confira o desconto e informe pagamentos cuja soma seja igual ao
                total.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            <p className="font-semibold">
              {customer?.tradeName ?? customer?.legalName} ·{" "}
              {date.split("-").reverse().join("/")}
            </p>
            <ul className="space-y-2">
              {items.map((item, index) => (
                <li
                  className="flex justify-between gap-2"
                  key={item.product.id}
                >
                  <span>
                    {item.quantity} {item.product.unit} · {item.product.name}
                  </span>
                  <span>{saleMoney(decimal(lines[index]?.total ?? 0n))}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-1 border-t pt-2">
              <p className="flex justify-between">
                <span>Subtotal</span>
                <span>{saleMoney(decimal(subtotal))}</span>
              </p>
              {rebate && rebate > 0n ? (
                <p className="flex justify-between">
                  <span>Desconto</span>
                  <span>{saleMoney(decimal(rebate))}</span>
                </p>
              ) : null}
              <p className="flex justify-between font-semibold">
                <span>Total recebido</span>
                <span>{saleMoney(decimal(total))}</span>
              </p>
            </div>
            <ul className="text-muted-foreground">
              {payments.map((payment, index) => (
                <li key={index}>
                  {PAYMENT_METHODS[payment.method]} ·{" "}
                  {saleMoney(decimal(paymentAmounts[index] ?? 0n))}
                  {payment.installments
                    ? ` · ${payment.installments} parcela(s)`
                    : ""}
                </li>
              ))}
            </ul>
            {notes.trim() ? <p>Observações: {notes.trim()}</p> : null}
            <p className="text-muted-foreground">
              Confirme somente após receber o pagamento. A venda baixa o estoque
              desta unidade e emite um recibo com a assinatura cadastrada no seu
              perfil.
            </p>
          </div>
        ) : null}

        <MutationError error={error} />
        <div className="flex justify-between gap-2 border-t pt-3">
          <Button
            variant="ghost"
            type="button"
            disabled={pending}
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
          >
            {step === 0 ? "Cancelar" : "Voltar"}
          </Button>
          <Button
            type="button"
            disabled={!validStep || pending}
            onClick={() => (step === 3 ? void submit() : setStep(step + 1))}
          >
            {step === 3 ? (
              <>
                <Check className="size-4" />
                {pending ? "Registrando…" : "Confirmar venda"}
              </>
            ) : (
              "Avançar"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductSearch({
  unitId,
  items,
  onAdd,
}: {
  unitId: string;
  items: Item[];
  onAdd(product: SaleProduct): void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ search: "", page: 1 });
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters({ search: search.trim(), page: 1 }),
      250,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const products = usePaginatedQuery<SaleProduct>(
    queryKeys.query("sales", "products", { unitId, ...filters }),
    "/sales/products",
    { ...filters, limit: 8 },
  );

  return (
    <div className="space-y-2">
      <Field label="Buscar produtos">
        <Input
          value={search}
          maxLength={120}
          placeholder="Nome ou SKU"
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      {products.isPending ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Carregando produtos…
        </p>
      ) : null}
      {products.error ? <MutationError error={products.error} /> : null}
      {products.data?.data.length ? (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
          {products.data.data.map((product) => {
            const selected = items.some(
              (item) => item.product.id === product.id,
            );
            const available = Number(product.available) > 0;
            return (
              <li
                key={product.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      product.sku,
                      available
                        ? `${Number(product.available).toLocaleString("pt-BR")} ${product.unit} disponíveis`
                        : "Sem estoque",
                      product.salePrice ? saleMoney(product.salePrice) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={selected || !available}
                  title={selected ? "Já incluído" : "Adicionar produto"}
                  aria-label={`Adicionar ${product.name}`}
                  onClick={() => onAdd(product)}
                >
                  {selected ? (
                    <Check className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : products.data ? (
        <p className="text-sm text-muted-foreground">
          Nenhum produto encontrado.
        </p>
      ) : null}
      {(products.data?.meta.totalPages ?? 0) > 1 ? (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={filters.page === 1 || products.isFetching}
            onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          >
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              filters.page >= products.data!.meta.totalPages ||
              products.isFetching
            }
            onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </div>
  );
}
