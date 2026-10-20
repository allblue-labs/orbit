"use client";

/**
 * A faixa de indicadores do plano.
 *
 * ## Por que medidor, e não gráfico
 *
 * Cada número aqui é **uma razão contra um teto** — usuários sobre o limite de
 * usuários, ordens do mês sobre a cota do mês. Uma razão contra um limite se lê
 * num medidor; virar barra ou pizza acrescentaria eixo e legenda para dizer a
 * mesma coisa com mais tinta.
 *
 * A aba já mostrava esses números em duas colunas de texto. O que faltava era
 * proporção: "25 · ilimitado" e "1.546 · ilimitado" ocupam a mesma linha e não
 * dizem qual está perto de acabar.
 *
 * ## Ilimitado não ganha barra
 *
 * Uma proporção sobre um teto inexistente não significa nada, e uma barra cheia
 * sugeriria o contrário — que acabou. O valor aparece sozinho, com "sem teto"
 * no lugar da barra.
 *
 * ## A cor é estado, não enfeite
 *
 * Verde não existe aqui: estar dentro do limite é o normal e o normal não pede
 * cor. Âmbar e vermelho só aparecem perto e acima do teto, e nunca sozinhos —
 * vêm com o número e o rótulo, que é o que um leitor com daltonismo lê.
 */
import { Infinity as InfinityIcon, TrendingUp } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ResourceEntitlement } from "@/types/billing";
import {
  faixaDeUso,
  formatConsumo,
  percentualDeUso,
  rotuloDoRecurso,
} from "./billing-format";

/**
 * O que merece um cartão.
 *
 * Não é tudo o que o servidor publica: sete medidores lado a lado viram um
 * painel que ninguém lê. São os tetos que de fato travam uma operação — gente,
 * carteira e volume do mês.
 */
const DESTAQUES = [
  "PLATFORM_USERS",
  "FIELD_TECHNICIANS",
  "ACTIVE_CUSTOMERS",
  "SERVICE_ORDERS_CREATED",
] as const;

const COR_DA_BARRA: Readonly<Record<string, string>> = {
  normal: "",
  atencao: "[&>div]:bg-amber-500",
  alto: "[&>div]:bg-destructive",
};

const COR_DO_NUMERO: Readonly<Record<string, string>> = {
  normal: "",
  atencao: "text-amber-600 dark:text-amber-500",
  alto: "text-destructive",
};

export function PlanKpis({
  allocation,
  usage,
}: {
  allocation: readonly ResourceEntitlement[];
  usage: readonly ResourceEntitlement[];
}) {
  const porRecurso = new Map(
    [...allocation, ...usage].map((item) => [item.resource, item]),
  );

  const cartoes = DESTAQUES.flatMap((recurso) => {
    const item = porRecurso.get(recurso);
    return item ? [item] : [];
  });

  if (cartoes.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cartoes.map((item) => (
        <Kpi key={item.resource} item={item} />
      ))}
    </div>
  );
}

function Kpi({ item }: { item: ResourceEntitlement }) {
  const percentual = percentualDeUso(item);
  const faixa = percentual === null ? "normal" : faixaDeUso(percentual);
  const doMes = item.resource === "SERVICE_ORDERS_CREATED";

  return (
    <div className="rounded-xl border border-border p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {doMes ? (
          <TrendingUp className="size-3.5" aria-hidden />
        ) : null}
        {rotuloDoRecurso(item.resource)}
      </p>

      {/*
        Figuras proporcionais, e não tabulares: `tabular-nums` dá a cada dígito
        a largura de um zero, e num número grande isolado isso fica frouxo.
      */}
      <p
        className={cn(
          "mt-1 font-display text-2xl font-semibold",
          COR_DO_NUMERO[faixa],
        )}
      >
        {item.current.toLocaleString("pt-BR")}
      </p>

      {percentual === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfinityIcon className="size-3.5" aria-hidden />
          sem teto
        </p>
      ) : (
        <>
          <Progress
            value={percentual}
            className={cn("mt-2 h-1.5", COR_DA_BARRA[faixa])}
            aria-label={`${rotuloDoRecurso(item.resource)}: ${formatConsumo(item)}`}
          />
          <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
            {formatConsumo(item)}
            {item.remaining !== null && item.remaining <= 0
              ? " · teto atingido"
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
