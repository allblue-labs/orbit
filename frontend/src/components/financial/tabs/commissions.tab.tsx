"use client";

/**
 * Comissão — configuração e fechamento.
 *
 * ## Por que fica no Financeiro
 *
 * Comissão é dinheiro a pagar, e a permissão é a financeira: `financial.read`
 * consulta, `financial.manage` configura e paga. Quem administra a equipe não
 * passa a ver quanto cada técnico recebe.
 *
 * A **tabela de técnicos** aparece aqui e na página da Equipe. É o mesmo
 * componente: duas implementações divergiriam no primeiro número novo, e a da
 * Equipe — que quem administra abre mais — seria a que ficaria para trás.
 */
import { PanelFrame } from "@/components/panels";
import { useSession } from "@/providers/session-provider";
import { CommissionPolicySection } from "../commission-policy.section";
import { CommissionTechniciansSection } from "../commission-technicians.section";

export function FinancialCommissionsTab() {
  const session = useSession();
  const canRead = session.hasPermission("financial.read");
  const canManage =
    session.hasPermission("financial.manage") &&
    session.hasCapability("financial.manage");

  if (!canRead) {
    return (
      <PanelFrame
        panelId="commission-denied"
        title="Comissão"
        description="Quanto cada técnico tem a receber"
      >
        <p className="text-sm text-muted-foreground">
          A comissão é informação financeira, e o seu acesso não inclui o
          Financeiro. Administrar a equipe não abre quanto cada pessoa recebe.
        </p>
      </PanelFrame>
    );
  }

  return (
    <div className="space-y-6">
      <CommissionTechniciansSection canManage={canManage} />
      <CommissionPolicySection canManage={canManage} />
    </div>
  );
}
