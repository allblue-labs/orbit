import { PmocWorkspace } from "@/components/pmoc/pmoc-workspace";
import { Breadcrumbs, entityCrumbs } from "@/navigation";
import { WorkspacePage } from "@/workspace";

/**
 * Detalhe de um PMOC — URL estável para deep link e recarga.
 *
 * A trilha existe porque esta tela é alcançada por link direto: de um
 * atendimento, de um documento, de uma notificação. Sem ela, quem chega de
 * fora não sabe onde está nem como subir um nível.
 */
export default async function PmocPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;

  return (
    <WorkspacePage
      entity="pmoc-plan"
      title="Plano de PMOC"
      description="Configuração, cobertura, execuções e histórico."
      activeLabel="Detalhe"
      suspense={false}
      breadcrumb={<Breadcrumbs items={entityCrumbs("pmoc-plan", "Detalhe")} />}
    >
      <PmocWorkspace planId={planId} />
    </WorkspacePage>
  );
}
