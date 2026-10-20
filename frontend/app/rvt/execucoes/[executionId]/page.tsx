import { RvtExecutionWorkspace } from "@/components/rvt/rvt-execution";
import { WorkspacePage } from "@/workspace";

/**
 * A execução de uma visita — equipamentos, equipe, evidências e documento.
 *
 * Rota própria porque a visita é um fato com identidade: dá para compartilhar
 * o link, abrir direto e recarregar. Ocorrência não tem rota porque não tem
 * endpoint de leitura própria — ela vive dentro da configuração.
 */
export default async function RvtExecutionPage({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;

  return (
    <WorkspacePage
      entity="rvt-configuration"
      title="Visita técnica realizada"
      description="Equipamentos atendidos, equipe, evidências e documento."
      activeLabel="Execução"
      suspense={false}
    >
      <RvtExecutionWorkspace executionId={executionId} />
    </WorkspacePage>
  );
}
