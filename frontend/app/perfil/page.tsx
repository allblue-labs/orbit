import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { WorkspacePage } from "@/workspace";

/**
 * Minha conta — o que é da própria pessoa.
 *
 * Fica separada de Configurações de propósito: ali se administra a
 * organização, aqui se administra a si mesmo. Consolidar a navegação não
 * significa misturar donos — dados pessoais, senha e preferências continuam
 * pertencendo a quem entrou, não à empresa.
 *
 * Server Component: o `WorkspacePage` compõe guards, shell e cabeçalho.
 *
 * **Sem capability nem permissão**: todo mundo administra a própria conta, e
 * exigir algo do plano para alguém trocar a própria senha seria absurdo. O
 * `RequireAuth` do `WorkspacePage` já garante o que importa — estar
 * autenticado.
 *
 * `contained={false}` porque as abas gerenciam a própria largura.
 */
export default function ProfilePage() {
  return (
    <WorkspacePage
      title="Minha conta"
      description="Seus dados, segurança, preferências e o contexto em que você está trabalhando."
      activeLabel="Minha conta"
      subscription={false}
      contained={false}
    >
      <ProfileWorkspace />
    </WorkspacePage>
  );
}
