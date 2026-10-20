/**
 * Quem pode receber um atendimento, e em qual dos dois papéis.
 *
 * ## O buraco que isto fecha
 *
 * Cadastrar alguém como "Técnico operador" não o tornava atribuível. A lista de
 * técnicos do formulário de operação vem de `professional_profiles`, e o
 * cadastro de membro nunca criava essa linha: o dono criava o técnico, abria o
 * formulário e encontrava o seletor vazio — sem nada na tela explicando que
 * faltava um segundo passo, numa outra página, dentro do membro.
 *
 * `validateTechnicianAssignments` recusava pelo mesmo motivo, então não era só
 * a lista: **atribuir era impossível**, mesmo digitando o id à mão.
 *
 * ## Papel de acesso e papel profissional continuam separados
 *
 * O perfil profissional não é um espelho do RBAC — ele carrega credencial e
 * assinatura, e é por isso que existe uma linha própria. O que mudou é só o
 * momento em que ele nasce: quando o acesso concedido já diz que a pessoa
 * executa em campo, o perfil nasce com o cadastro em vez de esperar um ato
 * manual que ninguém sabia que precisava existir. Desligar continua possível.
 *
 * `technicalResponsibleEnabled` fica de fora de propósito: ser responsável
 * técnico é designação legal, amarrada a uma credencial de conselho, e deduzi-la
 * de permissões afirmaria uma coisa que o RBAC não sabe.
 *
 * ## Por derivação do acesso, não por chave de papel
 *
 * `roles.allowed_surfaces` existe com esse argumento escrito ao lado: uma
 * constante com `FIELD_TECHNICIAN` dentro resolve hoje e deixa passar o
 * "Ajudante" que o dono criar amanhã. Aqui vale o mesmo — a pergunta é o que o
 * acesso concede, não como o papel se chama.
 */

/** A superfície do aplicativo de campo. Sem ela não há trabalho em campo. */
const MOBILE = 'MOBILE';

/**
 * Avançar a etapa do atendimento — iniciar, concluir.
 *
 * É o que separa quem executa de quem acompanha: o papel auxiliar recebe o
 * pacote de leitura de campo, que não a tem. É também a permissão que
 * `MobileFieldOperationService.actions` já consultava para liberar `START` e
 * `COMPLETE`, então usar outra aqui criaria duas respostas para a mesma
 * pergunta.
 */
const EXECUTES_FIELD_WORK = 'operations.status.update';

/** Ler o atendimento. O auxiliar acompanha, e isto é todo o trabalho dele. */
const READS_OPERATIONS = 'operations.read';

/** O acesso que vale para a pessoa, já resolvido o override do membro. */
export interface GrantedAccess {
  readonly permissions: readonly string[];
  readonly allowedSurfaces: readonly string[];
}

/**
 * O acesso efetivo de um vínculo.
 *
 * O override do membro substitui o papel inteiro quando existe — é a mesma
 * resolução de `surfacesOf`, e não uma segunda interpretação dela.
 */
export function grantedAccessOf(membership: {
  readonly usesCustomAccess: boolean;
  readonly customPermissions: readonly string[];
  readonly customAllowedSurfaces: readonly string[];
  readonly role: {
    readonly permissions: readonly string[];
    readonly allowedSurfaces: readonly string[];
  };
}): GrantedAccess {
  return membership.usesCustomAccess
    ? {
        permissions: membership.customPermissions,
        allowedSurfaces: membership.customAllowedSurfaces,
      }
    : {
        permissions: membership.role.permissions,
        allowedSurfaces: membership.role.allowedSurfaces,
      };
}

const opens = (access: GrantedAccess, surface: string) =>
  access.allowedSurfaces.some((item) => item.toUpperCase() === surface);

const grants = (access: GrantedAccess, permission: string) =>
  access.permissions.includes(permission);

/**
 * Este acesso descreve alguém que executa atendimento em campo.
 *
 * Verdadeiro para o técnico operador e para quem administra com acesso ao
 * aplicativo — numa empresa pequena quem administra também vai a campo, e o
 * RBAC dessa pessoa diz exatamente isso. Falso para o auxiliar, para o
 * responsável técnico e para qualquer papel só de painel.
 */
export function executesFieldWork(access: GrantedAccess): boolean {
  return opens(access, MOBILE) && grants(access, EXECUTES_FIELD_WORK);
}

/**
 * Este acesso descreve alguém que pode acompanhar um atendimento como auxiliar.
 *
 * ## Por que o auxiliar não precisa de perfil profissional
 *
 * O perfil profissional é da pessoa que assina e responde tecnicamente. O
 * auxiliar lê o atendimento e os documentos já emitidos e **não executa nada** —
 * quem garante isso é `MobileFieldOperationService.isAuxiliaryOnly`, pela
 * atribuição e não pelo papel. Exigir dele um perfil de técnico de campo, como
 * `validateTechnicianAssignments` exigia, era pedir a designação de executante a
 * quem o produto define como observador: o papel "Auxiliar técnico" nunca podia
 * ser auxiliar de nada.
 *
 * Um técnico de campo também serve de auxiliar: ele lê tudo o que o auxiliar lê.
 * Quem é responsável num atendimento é auxiliar em outro, e isso é do
 * atendimento, não da pessoa.
 */
export function assistsFieldWork(access: GrantedAccess): boolean {
  return opens(access, MOBILE) && grants(access, READS_OPERATIONS);
}
