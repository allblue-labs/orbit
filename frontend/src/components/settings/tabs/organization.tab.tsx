"use client";

/**
 * Organização — dados, recursos do plano e unidades.
 *
 * ## Reusa, não copia
 *
 * `GeneralSection`, `CapabilitiesSection` e `BusinessUnitsSection` são as
 * mesmas do Organization Workspace (PR-09). Reescrevê-las aqui criaria duas
 * telas para o mesmo contrato, que divergiriam no primeiro campo novo.
 *
 * ## Plano e consumo saíram daqui
 *
 * Havia duas telas respondendo à mesma pergunta: esta aba mostrava plano,
 * limites e consumo, e a aba **Plano e assinatura** mostrava tudo isso outra
 * vez — com preço, periodicidade e as ações que o servidor autoriza. A daqui
 * era a mais pobre das duas e ainda caía no código interno do plano quando o
 * rótulo comercial faltava.
 *
 * Ficou uma. Esta aba aponta para ela.
 */
import { PanelError, PanelLoading } from "@/components/panels";
import { BusinessUnitsSection } from "@/components/organization/business-units.section";
import { UsersSection } from "@/components/organization/integrations.section";
import { CapabilitiesSection } from "@/components/organization/capabilities.section";
import { GeneralSection } from "@/components/organization/general.section";
import { useOrganization } from "@/hooks/organization/use-organization";
import { useSession } from "@/providers/session-provider";
import { SubscriptionPointer } from "../subscription-pointer";

export function OrganizationTab() {
  const session = useSession();
  const query = useOrganization();

  const canManageOrganization = session.hasPermission("organization.update");
  const canManageUnits =
    session.hasPermission("business_units.update") &&
    session.hasCapability("business_units.manage");

  if (query.isPending) return <PanelLoading rows={8} />;
  if (query.error || !query.data) {
    return (
      <PanelError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="min-w-0 space-y-6">
        <GeneralSection
          organization={query.data}
          canManage={canManageOrganization}
        />
        <BusinessUnitsSection canManage={canManageUnits} />
        {/*
          * Veio da página `/organizacao`, que deixou de existir como porta
          * separada. É um encaminhamento para o Workspace da Equipe, não uma
          * segunda administração de membros.
          */}
        <UsersSection />
      </div>

      <div className="min-w-0 space-y-6">
        <SubscriptionPointer />
        <CapabilitiesSection />
      </div>
    </div>
  );
}
