"use client";

/**
 * Cadastro de um endereço de atendimento.
 *
 * O CEP preenche rua, bairro, cidade e UF — número e complemento não, porque o
 * CEP conhece a rua e não a porta. É o mesmo componente que o cadastro do
 * cliente usa, pelo mesmo motivo: digitar endereço à mão erra, e errar aqui
 * manda o técnico ao lugar errado.
 */
import { useState } from "react";

import { PostalCodeField } from "@/components/address/postal-code-field";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateCustomerAddress,
  useUpdateCustomerAddress,
} from "@/hooks/customers/use-customers";
import type { PostalAddress } from "@/lib/postal-code";
import type { CustomerAddress } from "@/types/customers";

export function CustomerAddressFormDialog({
  customerId,
  address,
  open,
  onOpenChange,
}: {
  customerId: string;
  /** `null` cria; preenchido edita. */
  address: CustomerAddress | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* `key` remonta o corpo ao trocar de endereço. */}
        <Body
          key={address?.id ?? "new"}
          customerId={customerId}
          address={address}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  customerId,
  address,
  onOpenChange,
}: {
  customerId: string;
  address: CustomerAddress | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateCustomerAddress(customerId);
  const update = useUpdateCustomerAddress(customerId);
  const mutation = address ? update : create;

  const [label, setLabel] = useState(address?.label ?? "");
  const [postalCode, setPostalCode] = useState(address?.postalCode ?? "");
  const [street, setStreet] = useState(address?.street ?? "");
  const [number, setNumber] = useState(address?.number ?? "");
  const [complement, setComplement] = useState(address?.complement ?? "");
  const [district, setDistrict] = useState(address?.district ?? "");
  const [city, setCity] = useState(address?.city ?? "");
  const [stateCode, setStateCode] = useState(address?.stateCode ?? "");
  const [notes, setNotes] = useState(address?.notes ?? "");
  const [isPrimary, setIsPrimary] = useState(address?.isPrimary ?? false);

  const preencher = (encontrado: PostalAddress) => {
    setPostalCode(encontrado.postalCode);
    setStreet(encontrado.street);
    setDistrict(encontrado.district);
    setCity(encontrado.city);
    setStateCode(encontrado.stateCode);
  };

  const opcional = (valor: string) => valor.trim() || undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      label: label.trim(),
      street: street.trim(),
      city: city.trim(),
      number: opcional(number),
      complement: opcional(complement),
      district: opcional(district),
      stateCode: opcional(stateCode)?.toUpperCase(),
      postalCode: opcional(postalCode),
      notes: opcional(notes),
      isPrimary,
    };
    const fechar = () => onOpenChange(false);

    if (address) {
      update.mutate({ id: address.id, input: payload }, { onSuccess: fechar });
      return;
    }
    create.mutate(payload, { onSuccess: fechar });
  };

  const incompleto =
    label.trim().length < 2 ||
    street.trim().length < 2 ||
    city.trim().length < 2;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {address ? "Editar endereço" : "Novo endereço de atendimento"}
        </DialogTitle>
        <DialogDescription>
          Para onde o técnico vai. O endereço fiscal do cliente continua no
          cadastro dele.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="address-label">Nome deste lugar</Label>
          <Input
            id="address-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Matriz, Loja Shopping, Obra Norte…"
            required
          />
          <p className="text-xs text-muted-foreground">
            É como a equipe vai reconhecê-lo na hora de abrir o atendimento.
          </p>
        </div>

        <PostalCodeField
          id="address-postal-code"
          value={postalCode}
          onChange={setPostalCode}
          onAddressFound={preencher}
        />

        <div className="space-y-2">
          <Label htmlFor="address-district">Bairro</Label>
          <Input
            id="address-district"
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="address-street">Logradouro</Label>
          <Input
            id="address-street"
            value={street}
            onChange={(event) => setStreet(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address-number">Número</Label>
          <Input
            id="address-number"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address-complement">Complemento</Label>
          <Input
            id="address-complement"
            value={complement}
            onChange={(event) => setComplement(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address-city">Cidade</Label>
          <Input
            id="address-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address-state">UF</Label>
          <Input
            id="address-state"
            value={stateCode}
            onChange={(event) => setStateCode(event.target.value)}
            maxLength={2}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="address-notes">Acesso</Label>
          <Textarea
            id="address-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Portaria, ponto de referência, horário liberado…"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
          <Checkbox
            checked={isPrimary}
            onCheckedChange={(marcado) => setIsPrimary(marcado === true)}
          />
          <span className="text-sm">
            Endereço principal deste cliente
            <span className="block text-xs text-muted-foreground">
              É o que o formulário de atendimento oferece primeiro.
            </span>
          </span>
        </label>
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
        <Button type="submit" disabled={incompleto || mutation.isPending}>
          {mutation.isPending ? "Salvando…" : address ? "Salvar" : "Criar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
