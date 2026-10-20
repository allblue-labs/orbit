"use client";

/**
 * Campo de CEP que preenche o endereço.
 *
 * Existe uma vez para que todo formulário de endereço se comporte igual: a
 * pessoa digita o CEP, e rua, bairro, cidade e estado chegam sozinhos. Quem
 * usa só diz o que fazer com o endereço encontrado.
 *
 * ## O que ele não faz
 *
 * Não decide o que é um endereço válido nem impede o cadastro: a consulta é
 * uma conveniência. Serviço fora do ar, CEP inexistente ou digitação
 * incompleta deixam os campos como estavam — **sempre editáveis** —, e a tela
 * diz o que houve em vez de travar.
 *
 * Número e complemento nunca são tocados: são de quem mora lá, não do CEP.
 */
import { useEffect, useRef } from "react";
import { Loader2, MapPin } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { errorCopy } from "@/lib/error-copy";
import {
  formatPostalCode,
  isCompletePostalCode,
  normalizePostalCode,
  type PostalAddress,
} from "@/lib/postal-code";
import { cn } from "@/lib/utils";
import { addressService } from "@/services/address.service";

export function PostalCodeField({
  id,
  value,
  onChange,
  onAddressFound,
  label = "CEP",
  className,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Chamado quando a consulta encontra o endereço do CEP digitado. */
  onAddressFound: (address: PostalAddress) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const digits = normalizePostalCode(value);
  const completo = isCompletePostalCode(digits);

  /**
   * A consulta é uma leitura como qualquer outra do produto.
   *
   * Usar a camada de consultas dá cancelamento, cache por CEP — um CEP não
   * muda de rua — e os estados de carga e erro sem nenhum efeito escrito à mão.
   */
  const consulta = useApiQuery(
    addressService.keys.byPostalCode(digits),
    ({ signal }) => addressService.byPostalCode(digits, { signal }),
    {
      enabled: completo,
      /** Endereço de CEP não envelhece durante um preenchimento. */
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    },
  );

  /**
   * Entrega o endereço uma vez por CEP.
   *
   * Sem esta memória, cada novo render com o mesmo resultado sobrescreveria o
   * que a pessoa tivesse corrigido à mão depois do preenchimento.
   */
  const entregue = useRef<string | null>(null);
  const entregar = useRef(onAddressFound);

  useEffect(() => {
    entregar.current = onAddressFound;
  });

  useEffect(() => {
    if (!consulta.data) return;
    if (entregue.current === digits) return;
    entregue.current = digits;
    entregar.current(consulta.data);
  }, [consulta.data, digits]);

  const avisoId = `${id}-aviso`;

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          value={formatPostalCode(value)}
          onChange={(event) => onChange(event.target.value)}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          disabled={disabled}
          aria-describedby={avisoId}
          aria-busy={consulta.isFetching}
          className="pr-9"
        />
        <span
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        >
          {consulta.isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPin className="size-4" />
          )}
        </span>
      </div>

      {/*
        * O aviso é `polite`: quem usa leitor de tela ouve o resultado sem ser
        * interrompido no meio da digitação.
        */}
      <p
        id={avisoId}
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs",
          consulta.error ? "text-amber-400" : "text-muted-foreground",
        )}
      >
        {consulta.isFetching
          ? "Buscando endereço…"
          : consulta.error
            ? errorCopy(consulta.error)
            : "O endereço é preenchido a partir do CEP."}
      </p>
    </div>
  );
}
