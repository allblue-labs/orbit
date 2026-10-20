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

  return (
    <div className="space-y-2">
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

          {/* O endereço inteiro, para conferir antes de mandar alguém. */}
          <p className="text-xs text-muted-foreground">
            {lista.find((endereco) => endereco.id === value)?.summary ??
              "Escolha para onde o técnico vai."}
          </p>
        </>
      )}
    </div>
  );
}
