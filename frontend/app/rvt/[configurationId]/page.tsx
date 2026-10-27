import { RvtWorkspace } from "@/components/rvt/rvt-workspace";
import { RvtBackLink } from "@/components/rvt/rvt-back-link";
import { WorkspacePage } from "@/workspace";

/**
 * Detalhe de uma configuração de RVT — URL estável para deep link e recarga.
 */
export default async function RvtConfigurationPage({
  params,
}: {
  params: Promise<{ configurationId: string }>;
}) {
  const { configurationId } = await params;

  return (
    <WorkspacePage
      entity="rvt-configuration"
      title="Visita técnica"
      description="Configuração, visitas previstas e histórico."
      activeLabel="Detalhe"
      suspense={false}
      action={<RvtBackLink />}
    >
      <RvtWorkspace configurationId={configurationId} />
    </WorkspacePage>
  );
}
