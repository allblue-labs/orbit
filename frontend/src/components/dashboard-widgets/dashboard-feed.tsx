"use client";

/**
 * Um item das listas do Dashboard: ícone do que é, a frase do evento, o
 * registro e o cliente, quem e quando — e o clique leva ao registro.
 */
import Link from "next/link";
import {
  CalendarCheck,
  ClipboardCheck,
  FileText,
  LifeBuoy,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { entityHref, type EntityId } from "@/entities";
import { cn } from "@/lib/utils";
import type { DashboardFeedItem } from "@/types/dashboard";
import { feedSentence, type FeedTone } from "./dashboard-feed.model";

const ICONES: Record<DashboardFeedItem["kind"], LucideIcon> = {
  OPERATION: Wrench,
  SERVICE_REQUEST: LifeBuoy,
  QUOTE: FileText,
  PMOC: ClipboardCheck,
  RVT: CalendarCheck,
};

const TONS: Record<FeedTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  danger: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  info: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  warning: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  neutral: "bg-muted text-muted-foreground ring-border",
};

export function FeedList({
  items,
  when,
  personPrefix,
}: {
  items: readonly DashboardFeedItem[];
  /** "há 3 h" ou "amanhã 09:00". */
  when: (item: DashboardFeedItem) => string;
  /** "por" (quem fez) ou "com" (quem vai). */
  personPrefix: string;
}) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const Icone = ICONES[item.kind];
        const frase = feedSentence(item);
        const href = entityHref(item.entityType as EntityId, item.entityId);
        const corpo = (
          <>
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                TONS[frase.tone],
              )}
              aria-hidden
            >
              <Icone className="size-4" />
            </span>
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{frase.text}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {when(item)}
                </span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[item.code, item.title].filter(Boolean).join(" · ")}
              </span>
              {item.customerName || item.personName ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    item.customerName,
                    item.personName ? `${personPrefix} ${item.personName}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            {href ? (
              <Link
                href={href}
                className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {corpo}
              </Link>
            ) : (
              <div className="flex items-start gap-3 py-2.5">{corpo}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
