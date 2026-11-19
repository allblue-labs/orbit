export const PAYMENT_METHODS = {
  PIX: "Pix",
  CASH: "Dinheiro",
  DEBIT_CARD: "Cartão de débito",
  CREDIT_CARD: "Cartão de crédito",
  BANK_TRANSFER: "Transferência",
  BOLETO: "Boleto",
  OTHER: "Outro",
} as const;

export type SalePaymentMethod = keyof typeof PAYMENT_METHODS;

export interface SaleProduct {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  salePrice: string | null;
  available: string;
}

export interface SaleLine {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

export interface SalePayment {
  method: SalePaymentMethod;
  amount: string;
  installments?: number;
}

export interface Sale {
  id: string;
  customerName: string;
  paidOn: string;
  subtotal: string;
  discount: string;
  total: string;
  items: SaleLine[];
  payments: SalePayment[];
  notes: string | null;
  receipt: { code: string; renderStatus: string | null };
}

export interface SaleInput {
  requestId: string;
  customerId: string;
  paidOn: string;
  items: Pick<SaleLine, "productId" | "quantity" | "unitPrice">[];
  discount: string;
  payments: SalePayment[];
  notes?: string;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export const saleMoney = (value: string) => brl.format(Number(value));

export function scaled(value: string, precision: number): bigint | null {
  const parts = /^(\d{1,12})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!parts || (parts[2]?.length ?? 0) > precision) return null;
  return BigInt(parts[1]! + (parts[2] ?? "").padEnd(precision, "0"));
}

export function decimal(value: bigint, precision = 2): string {
  const digits = value.toString().padStart(precision + 1, "0");
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

export function lineTotal(quantity: bigint, unitPrice: bigint) {
  // O preço tem centavos e a quantidade tem até três casas.
  return (quantity * unitPrice + 500n) / 1000n;
}

export function receiptPending(sale: Sale) {
  return ["PENDING", "RENDERING"].includes(sale.receipt.renderStatus ?? "");
}
