"use client";

/**
 * Leitura visual das notificações.
 *
 * ## Categorias vêm dos dados, não de uma taxonomia paralela
 *
 * `Notification.type` é `VarChar(80)` — texto livre. Existe um literal
 * `NotificationType` com quatro valores (`SYSTEM`, `OPERATION`, `REPORT`,
 * `REMINDER`), mas o `NotificationQueryDto` valida `type` com `@IsString()`,
 * não com `@IsIn`: qualquer módulo pode emitir um tipo novo.
 *
 * Então o mapa abaixo **traduz o que conhece e mostra o resto cru**. As
 * categorias oferecidas no filtro saem dos tipos que realmente apareceram na
 * página — não de uma lista inventada aqui.
 */
import {
  Bell,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  Cpu,
  FileText,
  Plug,
  Workflow,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

type NotificationIcon = ComponentType<LucideProps>;

interface CategoryPresentation {
  readonly label: string;
  readonly icon: NotificationIcon;
  readonly color: string;
}

/**
 * Tipos conhecidos.
 *
 * As chaves cobrem o literal do backend e as convenções por prefixo que os
 * módulos usam ao emitir (`OPERATION_*`, `SCHEDULING_*`).
 */
const CATEGORIES: Readonly<Record<string, CategoryPresentation>> = {
  SYSTEM: { label: "Sistema", icon: Bell, color: "text-muted-foreground" },
  OPERATION: { label: "Operação", icon: Workflow, color: "text-primary" },
  REPORT: { label: "Relatório", icon: FileText, color: "text-amber-400" },
  REMINDER: {
    label: "Lembrete",
    icon: CalendarClock,
    color: "text-violet-400",
  },
  SCHEDULING: {
    label: "Agenda",
    icon: CalendarClock,
    color: "text-violet-400",
  },
  ARTIFACT: {
    label: "Artefato",
    icon: ClipboardCheck,
    color: "text-emerald-400",
  },
  PLAN: { label: "Plano", icon: CreditCard, color: "text-sky-400" },
  SUBSCRIPTION: { label: "Plano", icon: CreditCard, color: "text-sky-400" },
  INTEGRATION: { label: "Integração", icon: Plug, color: "text-fuchsia-400" },
  AI: { label: "Inteligência", icon: Cpu, color: "text-amber-400" },
};

const FALLBACK: CategoryPresentation = {
  label: "Notificação",
  icon: Bell,
  color: "text-muted-foreground",
};

/**
 * Resolve a apresentação de um tipo.
 *
 * Tenta o tipo inteiro e depois o prefixo antes de `_`, o que cobre
 * `OPERATION_ASSIGNED` sem exigir uma entrada por evento. Sem correspondência,
 * o rótulo é o **tipo cru** — um tipo novo precisa ser visto, não virar
 * "Outro".
 */
export function notificationCategory(type: string): CategoryPresentation {
  const normalized = type.trim().toUpperCase();
  const direct = CATEGORIES[normalized];
  if (direct) return direct;

  const prefix = normalized.split("_")[0];
  const byPrefix = prefix ? CATEGORIES[prefix] : undefined;
  if (byPrefix) return byPrefix;

  return { ...FALLBACK, label: type };
}

export function NotificationCategoryIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const category = notificationCategory(type);
  return (
    <category.icon
      className={cn("size-4 shrink-0", category.color, className)}
      aria-hidden
    />
  );
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: "Pendente",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falhou",
};

export function notificationStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Agrupamento por dia.
 *
 * Rótulos relativos só para hoje e ontem; além disso, a data. O agrupamento
 * usa o fuso do navegador — diferente da agenda, uma notificação não tem fuso
 * próprio no contrato, e o instante é o mesmo para quem recebeu.
 */
export function groupByDay(
  notifications: readonly { id: string; createdAt: string }[],
): readonly { key: string; label: string; ids: readonly string[] }[] {
  const groups = new Map<string, string[]>();

  for (const notification of notifications) {
    const date = new Date(notification.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), notification.id]);
  }

  return [...groups.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([key, ids]) => ({ key, label: dayLabel(key), ids }));
}

function dayLabel(key: string): string {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (key === todayKey) return "Hoje";
  if (key === yesterday.toISOString().slice(0, 10)) return "Ontem";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${key}T12:00:00Z`));
}

/**
 * Quanto tempo faz, em uma expressão curta.
 *
 * O popup do sino tem uma linha por notificação e nenhum espaço para
 * `12/09/2026, 19:43` ao lado do título. "há 3 h" responde a pergunta que se
 * faz ali — isto é novo? — e a data completa continua na central.
 *
 * `Intl.RelativeTimeFormat` em vez de uma tabela de plurais escrita à mão:
 * "há 1 mês" e "há 2 meses" saem certos sem ninguém manter a regra.
 */
const RELATIVO = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

const ESCALAS: readonly { limite: number; unidade: Intl.RelativeTimeFormatUnit; em: number }[] = [
  { limite: 60_000, unidade: "second", em: 1_000 },
  { limite: 3_600_000, unidade: "minute", em: 60_000 },
  { limite: 86_400_000, unidade: "hour", em: 3_600_000 },
  { limite: 2_592_000_000, unidade: "day", em: 86_400_000 },
  { limite: 31_536_000_000, unidade: "month", em: 2_592_000_000 },
];

export function relativeTime(iso: string, now = Date.now()): string {
  const instante = new Date(iso).getTime();
  if (Number.isNaN(instante)) return "";

  const distancia = instante - now;
  const modulo = Math.abs(distancia);

  /** Menos de um minuto não vira "há 43 segundos": vira "agora". */
  if (modulo < 60_000) return "agora";

  for (const escala of ESCALAS) {
    if (modulo < escala.limite) {
      return RELATIVO.format(Math.round(distancia / escala.em), escala.unidade);
    }
  }
  return RELATIVO.format(Math.round(distancia / 31_536_000_000), "year");
}
