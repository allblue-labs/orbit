"use client";

/**
 * O vocabulário visual da área do cliente na web — o mesmo do app: cartões
 * com ícone do que é cada item, data em destaque e estado em selo.
 */
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type PortalTone = "info" | "success" | "warning" | "danger" | "neutral";

const TOM: Record<PortalTone, string> = {
  info: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  success:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  warning:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  danger:
    "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  neutral:
    "bg-muted text-muted-foreground ring-border dark:bg-muted/40",
};

export function operationTone(code: string): PortalTone {
  if (code === "completed") return "success";
  if (code === "inProgress") return "info";
  if (code === "paused") return "warning";
  if (code === "cancelled") return "danger";
  return "neutral";
}

export function assetTone(code: string): PortalTone {
  if (code === "active") return "success";
  if (code === "maintenance") return "warning";
  return "neutral";
}

export function Pill({ tone, children }: { tone: PortalTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TOM[tone],
      )}
    >
      {children}
    </span>
  );
}

export function IconTile({
  icon: Icon,
  tone = "info",
}: {
  icon: LucideIcon;
  tone?: PortalTone;
}) {
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
        TOM[tone],
      )}
      aria-hidden
    >
      <Icon className="size-5" />
    </span>
  );
}

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function DateBlock({ iso, tone = "neutral" }: { iso: string | null; tone?: PortalTone }) {
  const data = iso ? new Date(iso) : null;
  return (
    <span
      className={cn(
        "flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5 ring-1 ring-inset",
        TOM[tone],
      )}
    >
      {data ? (
        <>
          <span className="text-lg font-semibold leading-tight tabular-nums">
            {String(data.getDate()).padStart(2, "0")}
          </span>
          <span className="text-[10px] font-semibold tracking-wider">
            {MESES[data.getMonth()]}
          </span>
        </>
      ) : (
        <span className="py-2 text-xs">—</span>
      )}
    </span>
  );
}

/** Um item de lista clicável: o padrão de todos os cartões do portal. */
export function ItemCard({
  leading,
  title,
  subtitle,
  meta,
  badges,
  trailing,
  onClick,
}: {
  leading: ReactNode;
  title: string;
  subtitle?: string | null;
  meta?: ReactNode;
  badges?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const conteudo = (
    <>
      {leading}
      <span className="min-w-0 flex-1 space-y-1 text-left">
        <span className="line-clamp-2 block font-medium leading-snug">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
        {meta ? <span className="block text-xs text-muted-foreground">{meta}</span> : null}
        {badges ? <span className="flex flex-wrap gap-1.5 pt-1">{badges}</span> : null}
      </span>
      {trailing ?? (onClick ? <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" /> : null)}
    </>
  );
  const classes =
    "flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(classes, "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {conteudo}
    </button>
  ) : (
    <div className={classes}>{conteudo}</div>
  );
}

/** Rótulo em cima, valor embaixo — não quebra em tela estreita. */
export function Facts({ items }: { items: readonly (readonly [string, string | null | undefined])[] }) {
  const linhas = items.filter(([, valor]) => valor && valor.trim().length > 0);
  if (linhas.length === 0) return null;
  return (
    <dl className="divide-y divide-border rounded-xl border border-border bg-card px-4 shadow-sm">
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="py-3">
          <dt className="text-xs text-muted-foreground">{rotulo}</dt>
          <dd className="mt-0.5 whitespace-pre-line text-sm">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

export function Note({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
      <Icon className="size-5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`. Data civil: sem fuso. */
export function civilDate(value: string | null | undefined): string | null {
  if (!value || value.length < 10) return null;
  const [ano, mes, dia] = value.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : null;
}

/**
 * A ficha lateral do portal: atendimento, equipamento, chamado.
 *
 * O fundo do painel é sólido — a cor suave fica só no corpo. Antes a cor
 * translúcida ia no próprio painel e substituía o fundo, e a ficha aparecia
 * transparente por cima da página escurecida.
 *
 * Cabeçalho em cartão (o que é, o nome, o estado), corpo rolável e, quando há,
 * as ações fixas embaixo — à mão em qualquer altura da rolagem.
 */
export function PortalDrawer({
  open,
  onClose,
  icon: Icon,
  tone = "info",
  leading,
  eyebrow,
  title,
  badges,
  meta,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon?: LucideIcon;
  tone?: PortalTone;
  /** No lugar do ícone — a data em bloco, por exemplo. */
  leading?: ReactNode;
  eyebrow: string;
  title: string;
  badges?: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(valor) => !valor && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="space-y-3 border-b border-border bg-card px-5 pt-6 pb-4 text-left sm:px-6">
          <div className="flex items-start gap-3 pr-6">
            {leading ?? (Icon ? <IconTile icon={Icon} tone={tone} /> : null)}
            <div className="min-w-0 flex-1 space-y-1">
              <SheetDescription className="truncate text-xs font-semibold tracking-wider uppercase">
                {eyebrow}
              </SheetDescription>
              <SheetTitle className="text-lg leading-snug">{title}</SheetTitle>
            </div>
          </div>
          {badges || meta ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {badges}
              {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
            </div>
          ) : null}
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto bg-muted/40 px-5 py-5 sm:px-6">
          {children}
        </div>
        {footer ? (
          <div className="space-y-2 border-t border-border bg-card px-5 py-4 sm:px-6">{footer}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
