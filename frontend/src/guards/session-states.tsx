"use client";

/**
 * Estados visuais dos guards.
 *
 * Composições finas sobre o Design System existente (`LoadingState`,
 * `EmptyState`, `Button`). Nenhum componente, token ou estilo novo é criado
 * aqui — só o arranjo dos que já existem.
 */
import { SUBSCRIPTION_STATUS_LABELS } from "@/types/billing";
import Link from "next/link";
import { Lock, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState, LoadingState } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

export function SessionLoading({
  label = "Verificando sessão…",
}: {
  label?: string;
}) {
  return (
    <CenteredScreen>
      <LoadingState label={label} />
    </CenteredScreen>
  );
}

/** Sem permissão para a página (o backend também recusaria). */
export function PermissionDenied({
  description = "Você não tem permissão para acessar esta área. Fale com o administrador da sua organização.",
}: {
  description?: string;
}) {
  return (
    <CenteredScreen>
      <EmptyState
        icon={<Lock className="size-5" />}
        title="Acesso restrito"
        description={description}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.dashboard}>Voltar ao início</Link>
          </Button>
        }
      />
    </CenteredScreen>
  );
}

/** Módulo fora do plano contratado. */
export function CapabilityDenied({
  description = "Este módulo não está incluído no plano atual da sua organização.",
}: {
  description?: string;
}) {
  return (
    <CenteredScreen>
      <EmptyState
        icon={<Sparkles className="size-5" />}
        title="Módulo indisponível no plano"
        description={description}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.dashboard}>Voltar ao início</Link>
          </Button>
        }
      />
    </CenteredScreen>
  );
}

/** Assinatura vencida ou cancelada — o backend recusa as rotas do tenant. */
export function SubscriptionBlocked({
  status,
  onSignOut,
}: {
  status?: string;
  onSignOut?: () => void;
}) {
  return (
    <CenteredScreen>
      <EmptyState
        icon={<TriangleAlert className="size-5" />}
        title="Assinatura inativa"
        description={
          status
            ? `A assinatura da organização está com a situação "${(SUBSCRIPTION_STATUS_LABELS[status] ?? "inativa").toLowerCase()}". Regularize o pagamento para voltar a usar a plataforma.`
            : "A assinatura da organização não está ativa. Regularize o pagamento para voltar a usar a plataforma."
        }
        action={
          onSignOut ? (
            <Button variant="outline" size="sm" onClick={onSignOut}>
              Sair da conta
            </Button>
          ) : null
        }
      />
    </CenteredScreen>
  );
}

/** Sessão sem organização em uma rota de tenant (ex.: Platform Administrator). */
export function OrganizationRequired() {
  return (
    <CenteredScreen>
      <EmptyState
        icon={<ShieldAlert className="size-5" />}
        title="Nenhuma organização ativa"
        description="Esta conta não está vinculada a uma organização. Use o painel da plataforma ou entre com uma conta da organização."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.platform}>Ir para o painel da plataforma</Link>
          </Button>
        }
      />
    </CenteredScreen>
  );
}
