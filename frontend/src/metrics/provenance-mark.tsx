"use client";

/**
 * Marca visual de procedência.
 *
 * O componente **não decide** se deve marcar — quem decide é o
 * `dataQualityBehavior` da métrica no registry. Aqui só renderiza o que foi
 * resolvido.
 */
import { CircleDashed, FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DataQuality } from "@/types/dashboard";
import type { ProvenanceMark } from "./metric-registry";

const DESCRIPTIONS: Readonly<Record<DataQuality, string>> = {
  OBSERVED: "Contagem direta dos registros da organização.",
  DERIVED: "Calculado a partir dos registros da operação.",
  PROXY:
    "Aproximação: usa um dado equivalente enquanto a fonte definitiva não existe.",
  MOCK: "Valor não observado — não representa dados reais da sua operação.",
};

const LABELS: Readonly<Record<DataQuality, string>> = {
  OBSERVED: "Observado",
  DERIVED: "Derivado",
  PROXY: "Proxy",
  MOCK: "Não observado",
};

export function MetricProvenanceMark({
  quality,
  mark,
  source,
  className,
}: {
  quality: DataQuality;
  mark: ProvenanceMark;
  source?: string;
  className?: string;
}) {
  if (mark === "none") return null;
  const Icon = mark === "explicit" ? FlaskConical : CircleDashed;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            mark === "explicit"
              ? "bg-warning/15 text-warning"
              : "bg-surface-strong text-muted-foreground",
            className,
          )}
        >
          <Icon className="size-3" aria-hidden />
          {LABELS[quality]}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{DESCRIPTIONS[quality]}</p>
        {source ? (
          <p className="mt-1 font-mono text-[11px] opacity-80">
            fonte: {source}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Aviso de Read Model inteiro não observado.
 *
 * Usado onde o próprio contrato declara a procedência do bloco — o clima
 * (`source: 'MOCK'`) e o impacto ambiental (`source: 'MOCK_DERIVED'`).
 */
export function SimulatedSourceNotice({
  source,
  className,
}: {
  source: "MOCK" | "MOCK_DERIVED";
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-warning/40 text-warning", className)}
    >
      <FlaskConical className="size-3" aria-hidden />
      {source === "MOCK"
        ? "Fonte simulada"
        : "Derivado de fonte simulada"}
    </Badge>
  );
}
