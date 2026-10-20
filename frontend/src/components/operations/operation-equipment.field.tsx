"use client";

/**
 * Os equipamentos do atendimento.
 *
 * ## Por que é lista, e por que filtra pelo cliente
 *
 * O campo era um seletor de **um** equipamento, com busca sobre o catálogo
 * inteiro da organização. Duas coisas erradas ao mesmo tempo: o técnico vai ao
 * endereço e atende os aparelhos que estão lá — raramente um —, e oferecer o
 * catálogo inteiro permitia anexar o equipamento de outro cliente, que o
 * servidor recusa (e com razão) só depois de preenchido o formulário todo.
 *
 * Sem cliente escolhido não há o que listar, e a tela diz isso em vez de
 * mostrar uma lista vazia que parece falha de carregamento.
 */
import { Check, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetsList } from "@/hooks/assets/use-assets";

export function OperationEquipmentField({
  customerId,
  selectedIds,
  onChange,
}: {
  customerId: string;
  selectedIds: readonly string[];
  onChange: (ids: readonly string[]) => void;
}) {
  const assets = useAssetsList(
    { customerId, limit: 100 },
    { enabled: Boolean(customerId) },
  );

  const lista = assets.data?.data ?? [];

  const alternar = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((atual) => atual !== id)
        : [...selectedIds, id],
    );

  return (
    <div className="space-y-2">
      <Label>Equipamentos</Label>

      {!customerId ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Escolha o cliente primeiro — os equipamentos são os dele.
        </p>
      ) : assets.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : lista.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Este cliente ainda não tem equipamentos cadastrados. O atendimento
          pode ser criado assim mesmo.
        </p>
      ) : (
        <>
          <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
            {lista.map((equipamento) => (
              <li key={equipamento.id}>
                <label className="flex cursor-pointer items-center gap-3 p-2.5">
                  <Checkbox
                    checked={selectedIds.includes(equipamento.id)}
                    onCheckedChange={() => alternar(equipamento.id)}
                    aria-label={equipamento.name}
                  />
                  <Wrench
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {equipamento.name}
                    </span>
                    {equipamento.location ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {equipamento.location}
                      </span>
                    ) : null}
                  </span>
                  {equipamento.identifier ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {equipamento.identifier}
                    </Badge>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {selectedIds.length > 0 ? (
              <Check className="size-3.5" aria-hidden />
            ) : null}
            {selectedIds.length === 0
              ? "Nenhum marcado. O atendimento pode ser criado sem equipamento."
              : `${selectedIds.length} de ${lista.length} marcado(s).`}
          </p>
        </>
      )}
    </div>
  );
}
