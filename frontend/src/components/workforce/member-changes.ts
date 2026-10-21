/**
 * O que o formulário de "Editar usuário" vai mandar, e para qual rota.
 *
 * ## Por que fora do componente
 *
 * São duas rotas — `PATCH .../team/members/:id` para o cadastro e
 * `PATCH .../members/:id` para o acesso — e cada corpo é um `PATCH` parcial:
 * campo ausente significa "não mexa", e campo presente com o valor antigo é uma
 * reescrita desnecessária que ainda assim passa pelas validações do servidor.
 *
 * O erro que importa está em `permissions` e `allowedSurfaces`: mandá-los
 * quando nada no acesso mudou troca um acesso que segue o papel por uma cópia
 * congelada dele — e a pessoa para de receber o que o papel passar a conceder,
 * sem nada na tela dizendo que isso aconteceu.
 */
import {
  MembershipStatus,
  type TeamMember,
  type UpdateMemberInput,
  type UpdateTeamMemberInput,
} from "@/types/workforce";

/** O que está nos campos agora. */
export interface MemberFormState {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
  status: string;
  businessUnitIds: readonly string[];
  useRoleDefaults: boolean;
  permissions: readonly string[];
  allowedSurfaces: readonly string[];
}

export interface MemberChanges {
  /** `null` quando nada no cadastro mudou — ou quando é o dono. */
  dados: UpdateTeamMemberInput | null;
  /** `null` quando nada no acesso mudou. */
  acesso: UpdateMemberInput | null;
}

export function memberChanges(
  member: TeamMember,
  form: MemberFormState,
): MemberChanges {
  return { dados: dadosDe(member, form), acesso: acessoDe(member, form) };
}

/**
 * Nome e e-mail.
 *
 * O dono fica fora: o servidor recusa (400) porque apontar o e-mail dele para
 * outro endereço, somado à recuperação pública de senha, é assumir a conta.
 * Montar o corpo aqui e descobrir isso na resposta faria a tela pedir uma
 * mudança que ela já sabia impossível.
 */
function dadosDe(
  member: TeamMember,
  form: MemberFormState,
): UpdateTeamMemberInput | null {
  if (member.isOwner) return null;

  const dados: UpdateTeamMemberInput = {};
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const email = form.email.trim();

  if (firstName && firstName !== member.firstName) dados.firstName = firstName;
  if (lastName && lastName !== member.lastName) dados.lastName = lastName;
  /* Comparação sem caixa: o servidor normaliza para o índice único, e trocar
     `Marcos@` por `marcos@` não é uma correção que valha um pedido. */
  if (email && email.toLowerCase() !== member.email.toLowerCase())
    dados.email = email;

  return Object.keys(dados).length > 0 ? dados : null;
}

function acessoDe(
  member: TeamMember,
  form: MemberFormState,
): UpdateMemberInput | null {
  /*
   * Os três campos de acesso andam juntos de propósito.
   *
   * `useRoleDefaults` decide se os outros dois valem; mandar um sem o outro
   * deixaria o servidor com metade da decisão.
   */
  const acessoMudou =
    form.useRoleDefaults !== member.access.useRoleDefaults ||
    !mesmosValores(form.allowedSurfaces, member.access.allowedSurfaces) ||
    !mesmosValores(form.permissions, member.access.permissions);

  const unidadesMudaram = !mesmosValores(
    form.businessUnitIds,
    member.businessUnits.map((unit) => unit.id),
  );

  const acesso: UpdateMemberInput = {};
  if (form.roleId !== member.role.id) acesso.roleId = form.roleId;
  if (form.status !== member.status)
    acesso.status = form.status as MembershipStatus;
  if (unidadesMudaram) acesso.businessUnitIds = [...form.businessUnitIds];
  if (acessoMudou) {
    acesso.useRoleDefaults = form.useRoleDefaults;
    if (!form.useRoleDefaults) {
      acesso.permissions = [...form.permissions];
      acesso.allowedSurfaces = [...form.allowedSurfaces];
    }
  }

  return Object.keys(acesso).length > 0 ? acesso : null;
}

function mesmosValores(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const ordenadoEsquerda = [...left].sort();
  const ordenadoDireita = [...right].sort();
  return ordenadoEsquerda.every(
    (value, index) => value === ordenadoDireita[index],
  );
}
