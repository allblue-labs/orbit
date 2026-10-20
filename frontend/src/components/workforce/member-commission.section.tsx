"use client";

/**
 * A comissão da pessoa, dentro da página dela.
 *
 * ## Por que aqui, e não só no Financeiro
 *
 * O Financeiro responde "quem eu tenho a pagar"; a página da pessoa responde "o
 * que aconteceu com a comissão **dela**". São perguntas diferentes, e quem abre
 * o detalhe de um técnico para conferir um pagamento não deveria ter de
 * atravessar duas telas para achar a lista.
 *
 * É o mesmo componente que a aba Comissão usa — duas implementações divergiriam
 * no primeiro número novo.
 *
 * ## Dinheiro tem permissão própria
 *
 * Administrar a equipe não abre quanto alguém recebe. Sem `financial.read` a
 * seção diz isso e para; sem `financial.manage`, mostra sem oferecer pagar nem
 * cancelar.
 */
import { PanelFrame } from "@/components/panels";
import { CommissionDetail } from "@/components/financial/commission-detail";
import { useSession } from "@/providers/session-provider";

export function MemberCommissionSection({ userId }: { userId: string }) {
  const session = useSession();

  if (!session.hasPermission("financial.read")) {
    return (
      <PanelFrame
        panelId="member-commission-denied"
        title="Comissão"
        description="Quanto esta pessoa tem a receber"
      >
        <p className="text-sm text-muted-foreground">
          A comissão é informação financeira, e o seu acesso não inclui o
          Financeiro. Administrar a equipe não abre quanto cada pessoa recebe.
        </p>
      </PanelFrame>
    );
  }

  /* `CommissionDetail` é sempre seção embutida: quem mostra a pessoa e o
     contêiner é a página. */
  return <CommissionDetail userId={userId} />;
}
