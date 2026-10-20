"use client";

/**
 * Os selos do PMOC.
 *
 * Um primitivo por conceito, para que a tela não confunda o estado do
 * **contrato** com o da **execução do plano** nem com o do **equipamento**.
 * Os três usam a mesma paleta semântica do produto — verde é concluído,
 * âmbar é atenção, vermelho é atraso — em vez de uma cor por enum.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  complianceStatus,
  cycleStatus,
  documentStatus,
  equipmentExecutionStatus,
  planStatus,
  type PmocPresentation,
  type PmocTone,
} from "@/registry";

const TONE: Readonly<Record<PmocTone, string>> = {
  neutral: "bg-surface-strong text-muted-foreground",
  info: "bg-primary/15 text-primary",
  warning: "bg-amber-500/15 text-amber-400",
  critical: "bg-destructive/15 text-destructive",
  success: "bg-emerald-500/15 text-emerald-400",
};

function Chip({
  presentation,
  className,
}: {
  presentation: PmocPresentation;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      title={presentation.description}
      className={cn("font-normal", TONE[presentation.tone], className)}
    >
      {presentation.label}
    </Badge>
  );
}

export const PlanStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={planStatus(status)} />
);

/** Conformidade do plano — calculada pelo servidor, nunca pelo relógio local. */
export const ComplianceBadge = ({ status }: { status: string }) => (
  <Chip presentation={complianceStatus(status)} />
);

export const CycleStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={cycleStatus(status)} />
);

export const ExecutionStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={equipmentExecutionStatus(status)} />
);

export const DocumentStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={documentStatus(status)} />
);
