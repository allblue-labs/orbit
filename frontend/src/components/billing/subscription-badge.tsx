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

import { useTimeZone } from "@/hooks/use-timezone";
import { useSession } from "@/providers/session-provider";
import { ROUTE_ASSINATURA, dataDeVencimento } from "./subscription-access";
import {
  requiresInitialPayment,
  expiredSubscriptionNotice,
} from "./billing-session";

export function SubscriptionBadge() {
  const session = useSession();
  const { timeZone } = useTimeZone();
  if (!session.isAuthenticated || session.subscriptionActive) return null;

  const pending = requiresInitialPayment(session.session);
  const notice = expiredSubscriptionNotice(session.session);
  const venceuEm = notice ? dataDeVencimento(notice.end, timeZone) : null;
  const label = pending
    ? "Pagamento pendente"
    : notice
      ? "Assinatura vencida"
      : "Verificar assinatura";

  return (
    <Link
      href={ROUTE_ASSINATURA}
      title={
        pending
          ? "Conclua o pagamento para liberar seu plano."
          : venceuEm
            ? `A assinatura venceu em ${venceuEm}. Só leitura e download até escolher um plano.`
            : "Confira a situação da assinatura."
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <CalendarX2 className="size-3.5 shrink-0" aria-hidden />
      {/*
        Em telas estreitas sobra o ícone, e o nome acessível continua completo:
        o `title` não substitui rótulo para quem usa leitor de tela.
      */}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label} — ver planos</span>
    </Link>
  );
}
