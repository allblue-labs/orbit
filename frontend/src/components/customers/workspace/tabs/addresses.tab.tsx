"use client";

/**
 * Endereços de atendimento do cliente.
 *
 * ## Não é o endereço do cadastro
 *
 * O cliente tem um endereço no cadastro — o **fiscal**, o que vai na nota.
 * Estes são os lugares para onde o técnico vai, e uma rede com três lojas tem
 * três. Antes disso, o endereço do atendimento acabava digitado na descrição da
 * ordem, onde ninguém consegue agrupar histórico por local.
 *
 * O endereço que o cliente já tinha no cadastro virou o primeiro desta lista na
 * migração, marcado como principal.
 *
 * ## Remover é desativar
 *
 * Ordens antigas apontam para o endereço, e um relatório de período anterior
 * precisa continuar dizendo onde o técnico esteve.
 */
import { useState } from "react";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useCustomerAddresses,
  useRemoveCustomerAddress,
  useUpdateCustomerAddress,
} from "@/hooks/customers/use-customers";
import type { CustomerAddress } from "@/types/customers";
import { CustomerAddressFormDialog } from "./address-form.dialog";

export function AddressesTab({ customerId }: { customerId: string }) {
  const addresses = useCustomerAddresses(customerId);
  const update = useUpdateCustomerAddress(customerId);
  const remove = useRemoveCustomerAddress(customerId);

  /** `null` fechado; `"new"` criando; um endereço editando. */
  const [editando, setEditando] = useState<CustomerAddress | "new" | null>(
    null,
  );
  const [removendo, setRemovendo] = useState<CustomerAddress | null>(null);

  return (
    <PanelFrame
      panelId="customer-addresses"
      title="Endereços de atendimento"
      description="Para onde o técnico vai — separado do endereço fiscal do cadastro"
      actions={
        <Button size="sm" onClick={() => setEditando("new")}>
          <Plus className="size-3.5" />
          Novo endereço
        </Button>
      }
    >
      <div className="space-y-4">
        <PanelState
          query={toPanelQuery(addresses)}
          loadingRows={2}
          isEmpty={(data) => data.length === 0}
          emptyMessage="Nenhum endereço de atendimento. Cadastre ao menos um para que os atendimentos digam onde acontecem."
        >
          {(data) => (
            <ul className="space-y-2">
              {data.map((endereco) => (
                <li
                  key={endereco.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <MapPin
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {endereco.label}
                      {endereco.isPrimary ? (
                        <Badge variant="secondary" className="text-[10px]">
                          principal
                        </Badge>
                      ) : null}
                      {endereco.isActive ? null : (
                        <Badge variant="outline" className="text-[10px]">
                          inativo
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {endereco.summary}
                      {endereco.notes ? ` · ${endereco.notes}` : ""}
                    </p>
                  </div>

                  {!endereco.isPrimary ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: endereco.id,
                          input: { isPrimary: true },
                        })
                      }
                      aria-label={`Tornar ${endereco.label} o principal`}
                    >
                      <Star className="size-4" />
                    </Button>
                  ) : null}

                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() => setEditando(endereco)}
                    aria-label={`Editar ${endereco.label}`}
                  >
                    <Pencil className="size-4" />
                  </Button>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive"
                    disabled={remove.isPending}
                    onClick={() => setRemovendo(endereco)}
                    aria-label={`Remover ${endereco.label}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PanelState>

        <MutationError error={update.error ?? remove.error} />
      </div>

      <CustomerAddressFormDialog
        customerId={customerId}
        address={editando === "new" ? null : editando}
        open={editando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setEditando(null);
        }}
      />

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setRemovendo(null);
        }}
        title="Remover endereço"
        body={
          removendo
            ? `"${removendo.label}" sai da lista e dos atendimentos novos. Os atendimentos que já aconteceram lá continuam dizendo onde foram.`
            : undefined
        }
        confirmLabel="Remover"
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (removendo) remove.mutate(removendo.id);
          setRemovendo(null);
        }}
      />
    </PanelFrame>
  );
}
