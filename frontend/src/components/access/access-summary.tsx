"use client";

/**
 * "O que eu posso fazer aqui" — em frases, não em chaves de permissão.
 *
 * A derivação está em `access-summary.model.ts`, que é testável sem DOM; aqui só
 * sobra o desenho. O porquê de tudo está lá.
 */
import { useMemo } from "react";
import { Check, Lock, Sparkles } from "lucide-react";

import {
  buildAccessSummary,
  enumerate,
  type AccessArea,
  type BlockedBy,
} from "./access-summary.model";
import { useSession } from "@/providers/session-provider";
import { cn } from "@/lib/utils";

const BLOCKED_GROUPS: readonly {
  by: BlockedBy;
  icon: typeof Lock;
  prefix: string;
}[] = [
  {
    by: "plano",
    icon: Sparkles,
    prefix: "Disponível em um plano com mais recursos:",
  },
  {
    by: "papel",
    icon: Lock,
    prefix: "Precisa de autorização de quem administra a conta:",
  },
];

export function AccessSummary({ className }: { className?: string }) {
  const session = useSession();
  const areas = useMemo(() => buildAccessSummary(session), [session]);

  const withAccess = areas.filter((area) => area.allowed.length > 0);
  const withoutAccess = areas.filter((area) => area.allowed.length === 0);
  const byPlan = areas.flatMap((area) =>
    area.blocked.filter((item) => item.by === "plano"),
  ).length;

  return (
    <div className={cn("space-y-4", className)}>
      <p className="text-sm text-muted-foreground">
        Você tem acesso a {withAccess.length} das {areas.length} áreas do Orbit.
        {byPlan > 0
          ? " Algumas operações dependem de um plano com mais recursos."
          : ""}
      </p>

      <ul className="space-y-2">
        {withAccess.map((area) => (
          <li
            key={area.id}
            className="rounded-lg border border-border px-3 py-2"
          >
            <p className="flex items-start gap-2 text-sm">
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-emerald-500"
                aria-hidden
              />
              <span>
                <span className="font-medium">{area.name}</span>
                {": "}
                <span className="text-muted-foreground">
                  {enumerate(area.allowed)}
                </span>
              </span>
            </p>
            <Blocked items={area.blocked} />
          </li>
        ))}
      </ul>

      {withoutAccess.length > 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Sem acesso a{" "}
            {enumerate(
              withoutAccess.map((area) => area.name.toLocaleLowerCase("pt-BR")),
            )}
            .
          </span>
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Este resumo é informativo. Quem autoriza cada operação é o servidor, no
        momento em que ela acontece.
      </p>
    </div>
  );
}

function Blocked({ items }: { items: AccessArea["blocked"] }) {
  return (
    <>
      {BLOCKED_GROUPS.map((group) => {
        const labels = items
          .filter((item) => item.by === group.by)
          .map((item) => item.label);
        if (labels.length === 0) return null;

        const Icon = group.icon;
        return (
          <p
            key={group.by}
            className="mt-1 flex items-start gap-2 pl-[1.375rem] text-xs text-muted-foreground"
          >
            <Icon className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              {group.prefix} {enumerate(labels)}.
            </span>
          </p>
        );
      })}
    </>
  );
}
