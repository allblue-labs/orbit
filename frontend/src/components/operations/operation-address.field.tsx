"use client";

/**
 * O endereço de atendimento, escolhido entre os do cliente.
 *
 * ## Por que não é o endereço do cadastro
 *
 * `Customer.address` é o endereço **fiscal** — o que vai na nota. Uma rede com
 * três lojas é um cliente e três lugares onde o técnico pode precisar estar, e
 * antes disso o endereço do atendimento acabava digitado na descrição.
 *
 * Sem cliente escolhido não há o que listar, e a tela diz isso.
 */
import Link from "next/link";
import { useState } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { useAction } from "@/actions";
import { CustomerAddressFormDialog } from "@/components/customers/workspace/tabs/address-form.dialog";
import { Button } from "@/components/ui/button";
import type { CustomerAddress } from "@/types/customers";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerAddresses } from "@/hooks/customers/use-customers";
import { ROUTES } from "@/lib/routes";

/** `Select` não aceita item de valor vazio; este é o "não informado". */
const SEM_ENDERECO = "__none__";

export function OperationAddressField({
  customerId,
  value,
  onChange,
}: {
  customerId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const addresses = useCustomerAddresses(customerId || null, true);
  const lista = addresses.data ?? [];
  const manage = useAction("customer.update");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const selected = lista.find((address) => address.id === value);

  return (
    <div className="space-y-3">
      <Label htmlFor="operation-address">Endereço do atendimento</Label>

      {!customerId ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Escolha o cliente primeiro.
        </p>
      ) : addresses.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : lista.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Este cliente não tem endereço de atendimento.{" "}
          <Link
            href={`${ROUTES.customers}/${customerId}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Cadastrar
          </Link>
        </p>
      ) : (
        <>
          <Select
            value={value || SEM_ENDERECO}
            onValueChange={(escolhido) =>
              onChange(escolhido === SEM_ENDERECO ? "" : escolhido)
            }
          >
            <SelectTrigger id="operation-address">
              <SelectValue placeholder="Não informado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_ENDERECO}>Não informado</SelectItem>
              {lista.map((endereco) => (
                <SelectItem key={endereco.id} value={endereco.id}>
                  {endereco.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selected ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{selected.summary}</p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Complemento</dt><dd className="mt-1">{selected.complement || "Não informado"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Ponto de referência e acesso</dt><dd className="mt-1 whitespace-pre-wrap">{selected.notes || "Não informado"}</dd></div>
              </dl>
            </div>
          ) : <p className="text-xs text-muted-foreground">Escolha para onde o técnico vai.</p>}
        </>
      )}
      {customerId && manage.allowed ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" aria-hidden />Novo endereço</Button>
          {selected ? <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(selected); setOpen(true); }}><Pencil className="size-4" aria-hidden />Editar endereço e acesso</Button> : null}
        </div>
      ) : null}
      {customerId ? <CustomerAddressFormDialog customerId={customerId} address={editing} open={open} onOpenChange={setOpen} /> : null}
    </div>
  );
}
