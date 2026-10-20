import { CatalogsWorkspace } from "@/components/catalogs/catalogs-workspace";
import { WorkspacePage } from "@/workspace";

/**
 * Central de Catálogos.
 *
 * Server Component: o `WorkspacePage` compõe guards, shell e cabeçalho.
 *
 * A autorização é por **permissão**, e não por capability de plano: o que se
 * cadastra aqui — roteiros e unidades — alimenta módulos que têm capabilities
 * próprias, e cada aba já é recusada pelo servidor quando o plano não inclui o
 * módulo dela.
 */
export default function CatalogsPage() {
  return (
    <WorkspacePage
      title="Central de Catálogos"
      description="O que se cadastra uma vez e a operação reaproveita: roteiros de atendimento, tipos de manutenção de RVT e unidades de PMOC."
      permission="checklists.read"
      contained={false}
    >
      <CatalogsWorkspace />
    </WorkspacePage>
  );
}
