import { MemberDetail } from "@/components/workforce/member-detail";
import { Breadcrumbs, entityCrumbs } from "@/navigation";
import { WorkspacePage } from "@/workspace";

/**
 * Detalhe de um membro da equipe.
 *
 * Server Component: resolve o parâmetro da rota; o `WorkspacePage` compõe guards
 * e shell. O conteúdo é Client Component porque editar papéis, pagar comissão e
 * navegar entre as listas é interação.
 *
 * ## Era um painel lateral
 *
 * O conteúdo é de tela: carga, perfil profissional, especialidades,
 * certificações, permissões, unidades, listas relacionadas e comissão. Num
 * drawer isso era uma coluna estreita com rolagem longa, sem endereço próprio —
 * e o painel recebia o objeto da listagem, então recarregar ou abrir em outra aba
 * não tinham de onde buscar a pessoa.
 *
 * O guard é `organization.read`, o mesmo da página de Equipe de onde se chega. O
 * que é financeiro dentro da página tem a própria checagem.
 */
export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  return (
    <WorkspacePage
      permission="organization.read"
      contained={false}
      activeLabel="Equipe"
      breadcrumb={<Breadcrumbs items={entityCrumbs("team-member", "Membro")} />}
    >
      <MemberDetail userId={userId} />
    </WorkspacePage>
  );
}
