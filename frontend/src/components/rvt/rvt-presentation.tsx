"use client";

/**
 * Os selos do RVT.
 *
 * Um primitivo por conceito, para que a tela não confunda o estado da
 * **configuração** com o da **ocorrência** nem com o da **execução**. Todos
 * usam a paleta semântica do produto — verde é concluído, âmbar é atenção,
 * vermelho é atraso — em vez de uma cor por enum.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  configurationStatus,
  rvtDocumentStatus,
  dueState,
  rvtExecutionStatus,
  occurrenceStatus,
  renderStatus,
  scheduleMode,
  type RvtPresentation,
  type RvtTone,
} from "@/registry";

const TONE: Readonly<Record<RvtTone, string>> = {
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
  presentation: RvtPresentation;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn("border-none", TONE[presentation.tone], className)}
      title={presentation.description}
    >
      {presentation.label}
    </Badge>
  );
}

export const ConfigurationStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={configurationStatus(status)} />
);

/**
 * O tipo de manutenção, pelo rótulo que a organização deu a ele.
 *
 * Era um mapa de dois códigos — `WEEKLY` e `SEMIANNUAL` — traduzidos no
 * cliente. Agora o tipo é cadastro: quem nomeia é o dono da organização, e
 * qualquer tradução aqui só teria como acertar os dois de antes.
 */
export const MaintenanceTypeBadge = ({
  label,
}: {
  label: string | null | undefined;
}) => (
  <Chip
    presentation={{
      label: label ?? "Sem tipo",
      tone: label ? "info" : "neutral",
    }}
  />
);

export const ScheduleModeBadge = ({ mode }: { mode: string }) => (
  <Chip presentation={scheduleMode(mode)} />
);

export const OccurrenceStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={occurrenceStatus(status)} />
);

/**
 * O vencimento só vira selo quando diz algo.
 *
 * "No prazo" é o estado normal de quase toda visita futura; carimbá-lo em
 * cada linha gastaria a atenção do leitor no que não pede ação.
 */
export function DueStateBadge({ state }: { state: string }) {
  if (state === "UPCOMING") return null;
  return <Chip presentation={dueState(state)} />;
}

export const ExecutionStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={rvtExecutionStatus(status)} />
);

export const DocumentStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={rvtDocumentStatus(status)} />
);

export const RenderStatusBadge = ({ status }: { status: string }) => (
  <Chip presentation={renderStatus(status)} />
);
