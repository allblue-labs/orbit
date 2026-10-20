"use client";

/**
 * O selo de assinatura vencida na topbar.
 *
 * Discreto de propósito: quem está vencido já recebeu o aviso na entrada e
 * continua tendo trabalho a fazer. O selo é o lembrete que fica — presente em
 * toda tela, sem interromper nenhuma — e é também o caminho mais curto para a
 * ação que resolve.
 *
 * Só aparece quando há o que dizer. Assinatura em dia não ganha selo: um
 * indicador permanentemente verde vira ruído e some da percepção justamente
 * quando muda de cor.
 */
import Link from "next/link";
import { CalendarX2 } from "lucide-react";

import { useSession } from "@/providers/session-provider";
import { ROUTE_ASSINATURA, dataDeVencimento } from "./subscription-access";

export function SubscriptionBadge() {
  const session = useSession();
  if (!session.isAuthenticated || session.subscriptionActive) return null;

  const venceuEm = dataDeVencimento(session.subscriptionEndsAt);

  return (
    <Link
      href={ROUTE_ASSINATURA}
      title={
        venceuEm
          ? `A assinatura venceu em ${venceuEm}. Só leitura e download até escolher um plano.`
          : "Assinatura vencida. Só leitura e download até escolher um plano."
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <CalendarX2 className="size-3.5 shrink-0" aria-hidden />
      {/*
        Em telas estreitas sobra o ícone, e o nome acessível continua completo:
        o `title` não substitui rótulo para quem usa leitor de tela.
      */}
      <span className="hidden sm:inline">Assinatura vencida</span>
      <span className="sr-only sm:hidden">
        Assinatura vencida — ver planos
      </span>
    </Link>
  );
}
