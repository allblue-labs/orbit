import { OperationsTabs } from "@/components/operations/operations-tabs";
import { WorkspacePage } from "@/workspace";

/**
 * Operações — listagem e centro de gestão.
 *
 * Server Component: o `WorkspacePage` compõe guards, shell e cabeçalho.
 *
 * `suspense={false}` porque as abas já resolvem os próprios estados de carga —
 * uma segunda fronteira só adiaria a primeira pintura.
 */
export default function OperationsPage() {
  return (
    <WorkspacePage
      entity="operation"
      description="Ordens de serviço da unidade ativa: criação, reagendamento, atribuição e acompanhamento."
      suspense={false}
    >
      <OperationsTabs />
    </WorkspacePage>
  );
}
