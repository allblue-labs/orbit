"use client";

/**
 * Leitura visual dos literais de agendamento.
 *
 * Status e prioridade são listas fechadas no DTO; `type` **não é** — é texto
 * livre normalizado para maiúsculas, então o rótulo cai no valor cru quando
 * não há tradução, em vez de virar "Outro".
 */
import { cn } from "@/lib/utils";

/** Exportado para o Entity Registry referenciar — nunca copiar. */
export const SCHEDULING_STATUS_LABELS: Readonly<Record<string, string>> = {
  TENTATIVE: "Provisório",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

const STATUS_CLASSES: Readonly<Record<string, string>> = {
  TENTATIVE: "bg-amber-500/15 text-amber-400",
  CONFIRMED: "bg-primary/15 text-primary",
  IN_PROGRESS: "bg-sky-500/15 text-sky-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-400",
  CANCELLED: "bg-surface-strong text-muted-foreground line-through",
};

/** Barra lateral do bloco na grade — a cor que identifica o status de relance. */
const STATUS_ACCENT: Readonly<Record<string, string>> = {
  TENTATIVE: "border-l-amber-400",
  CONFIRMED: "border-l-primary",
  IN_PROGRESS: "border-l-sky-400",
  COMPLETED: "border-l-emerald-400",
  CANCELLED: "border-l-muted-foreground",
};

const PRIORITY_LABELS: Readonly<Record<string, string>> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export function eventStatusLabel(status: string): string {
  return SCHEDULING_STATUS_LABELS[status] ?? status;
}

export function eventPriorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

/**
 * O tipo do evento em palavras.
 *
 * Os tipos criados pelo próprio Orbit vêm em inglês (`OPERATION`,
 * `TECHNICAL_VISIT`) e os sugeridos no formulário em português sem acento
 * (`VISITA_TECNICA`). Os dois viram a mesma palavra; um tipo que a organização
 * inventou cai na forma legível do próprio código.
 */
const EVENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  OPERATION: "Atendimento",
  TECHNICAL_VISIT: "Visita técnica",
  VISITA_TECNICA: "Visita técnica",
  MAINTENANCE: "Manutenção",
  MANUTENCAO: "Manutenção",
  INSTALLATION: "Instalação",
  INSTALACAO: "Instalação",
  INSPECTION: "Inspeção",
  INSPECAO: "Inspeção",
  PMOC: "PMOC",
  RVT: "RVT",
  REMINDER: "Lembrete",
  LEMBRETE: "Lembrete",
  APPOINTMENT: "Compromisso",
  COMPROMISSO: "Compromisso",
  MEETING: "Reunião",
  REUNIAO: "Reunião",
  BLOCK: "Bloqueio",
  BLOQUEIO: "Bloqueio",
  OTHER: "Outro",
  OUTRO: "Outro",
};

export function eventTypeLabel(type: string): string {
  const known = EVENT_TYPE_LABELS[type.trim().toUpperCase()];
  if (known) return known;
  const normalized = type.replace(/_/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function eventStatusAccent(status: string): string {
  return STATUS_ACCENT[status] ?? "border-l-border";
}

export function EventStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
        STATUS_CLASSES[status] ?? "bg-surface-strong text-muted-foreground",
        className,
      )}
    >
      {eventStatusLabel(status)}
    </span>
  );
}

export function EventPriorityBadge({ priority }: { priority: string }) {
  if (priority === "NORMAL" || priority === "LOW") return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase",
        priority === "CRITICAL"
          ? "bg-destructive/15 text-destructive"
          : "bg-amber-500/15 text-amber-400",
      )}
    >
      {eventPriorityLabel(priority)}
    </span>
  );
}

const SEVERITY_CLASSES: Readonly<Record<string, string>> = {
  CRITICAL: "bg-destructive/15 text-destructive",
  WARNING: "bg-amber-500/15 text-amber-400",
};

const CONFLICT_LABELS: Readonly<Record<string, string>> = {
  EVENT_OVERLAP: "Sobreposição de eventos",
  RESOURCE_OVERLAP: "Recurso em dois lugares",
  BLOCKED_AVAILABILITY: "Dentro de bloqueio",
  OUTSIDE_AVAILABILITY: "Fora da disponibilidade",
};

export function conflictTypeLabel(type: string): string {
  return CONFLICT_LABELS[type] ?? type;
}

export function ConflictSeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase",
        SEVERITY_CLASSES[severity] ?? "bg-surface-strong text-muted-foreground",
      )}
    >
      {severity === "CRITICAL" ? "Crítico" : "Atenção"}
    </span>
  );
}
