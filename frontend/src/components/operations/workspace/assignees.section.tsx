"use client";

/**
 * A equipe do atendimento.
 *
 * Até a PR-FE-02 esta seção listava `operation.users` — o vínculo genérico,
 * sem distinguir quem responde de quem acompanha — e o cabeçalho registrava
 * que atribuir era impossível por falta de um seletor no backend. Os dois
 * fatos mudaram: a PR-28 publicou responsável e auxiliares como conceitos
 * separados, e a PR-27 publicou os seletores por papel profissional.
 *
 * O conteúdo é o `OperationTeamPanel`, compartilhado com o que PMOC e RVT vão
 * precisar. O que fica aqui é a moldura do Workspace — título, contagem e os
 * estados de carregamento e erro que todas as seções usam.
 */
import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { readRequiresAuthorization } from "@/components/operations/authorization.section";
import { OperationAuthorizationPanel } from "@/components/operations/operation-authorization.panel";
import { useOrganization } from "@/hooks/organization/use-organization";
import type { Operation } from "@/types/operations";
import { OperationTeamPanel } from "../operation-team.panel";

export function AssigneesSection({ query }: { query: PanelQuery<Operation> }) {
  const operation = query.data;
  /**
   * A exigência é da organização, e a decisão é por atendimento.
   *
   * Lida aqui e passada adiante: `useOrganization` é cache compartilhado, e a
   * mesma leitura serve a aba de Autorização e a de Configurações.
   */
  const organization = useOrganization();
  const exigeAutorizacao = readRequiresAuthorization(
    organization.data?.settings,
  );
  /** Responsável conta como pessoa na equipe, não só os auxiliares. */
  const size = operation
    ? (operation.responsibleFieldTechnician ? 1 : 0) +
      operation.auxiliaryTechnicians.length
    : null;

  return (
    <PanelFrame
      panelId="operation-assignees"
      title="Equipe"
      description="Responsável, auxiliares técnico e histórico de execução"
      actions={size === null ? null : <Badge variant="secondary">{size}</Badge>}
    >
      <PanelState query={query} loadingRows={3}>
        {(current) => (
          <div className="space-y-4">
            <OperationAuthorizationPanel
              operation={current}
              required={exigeAutorizacao}
            />
            <OperationTeamPanel operation={current} />
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}
