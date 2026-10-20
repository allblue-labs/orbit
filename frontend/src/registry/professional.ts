/**
 * Como papéis profissionais, credenciais e bloqueios aparecem na tela.
 *
 * ## Papel profissional não é permissão
 *
 * `FIELD_TECHNICIAN` e `TECHNICAL_RESPONSIBLE` descrevem o que a pessoa **faz
 * em campo** — quem executa o atendimento e quem responde tecnicamente pelo
 * documento. Não concedem nada no sistema: quem pode clicar em quê continua
 * sendo decidido por RBAC e pelas `allowedActions` do registro.
 *
 * Misturar os dois é o erro clássico deste domínio, e ele custa caro nos dois
 * sentidos: um técnico com papel profissional achando que pode gerenciar a
 * carteira, ou um gestor sem papel profissional achando que pode assinar um
 * laudo. A interface separa as duas leituras desde o rótulo.
 *
 * ## Um mapa, não um `switch` por tela
 *
 * Equipe, seletor de responsável, painel de atribuição e — adiante — PMOC e
 * RVT mostram os mesmos papéis. Um mapa central evita que cada tela invente o
 * seu rótulo e a sua cor.
 */
import type {
  ProfessionalEligibilityBlockedReason,
  ProfessionalCredentialReadModel,
  PublicProfessionalRole,
} from "@/types/contracts/modules/workforce/workforce.read-models";

/* ------------------------------------------------------------------ */
/* Papéis profissionais                                                */
/* ------------------------------------------------------------------ */

export interface ProfessionalRolePresentation {
  readonly label: string;
  /** O que o papel significa, para quem nunca viu a tela. */
  readonly description: string;
}

/**
 * Os dois papéis do domínio, com os nomes que o produto usa.
 *
 * Um mesmo profissional pode ter os dois — e aí aparecem os dois rótulos.
 * Não existe "híbrido": inventar um terceiro papel para representar a soma
 * criaria um conceito que o backend não tem.
 *
 * ## Por que os nomes são estes
 *
 * "Técnico em Campo" e "Técnico responsável" conviviam com "Responsável Técnico" em
 * telas diferentes, e as três expressões usam as mesmas duas palavras em ordens
 * diferentes para dizer coisas opostas. Num PMOC isso não é detalhe: um é quem vai
 * ao local, o outro é quem responde pelo contrato e assina o documento com a
 * credencial que a norma exige.
 *
 * **Técnico Operacional** não se confunde com **Responsável Técnico** nem lido
 * rápido, e é o nome que o resto do produto passa a usar — aqui, no catálogo de
 * papéis de acesso e nos formulários.
 */
export const PROFESSIONAL_ROLES: Readonly<
  Record<PublicProfessionalRole, ProfessionalRolePresentation>
> = {
  FIELD_TECHNICIAN: {
    label: "Técnico Operacional",
    description:
      "Técnico em refrigeração que executa o serviço no cliente: abre o atendimento, cumpre o roteiro e registra o que foi feito.",
  },
  TECHNICAL_RESPONSIBLE: {
    label: "Responsável Técnico",
    description:
      "Responde tecnicamente pelo contrato de manutenção e assina o documento emitido, com a credencial que o PMOC exige.",
  },
};

export function professionalRoleLabel(role: PublicProfessionalRole): string {
  return PROFESSIONAL_ROLES[role]?.label ?? role;
}

/** Os rótulos de quem tem um papel, dois, ou nenhum. */
export function professionalRoleLabels(
  roles: readonly PublicProfessionalRole[] | undefined,
): readonly string[] {
  return (roles ?? []).map(professionalRoleLabel);
}

/* ------------------------------------------------------------------ */
/* Credenciais                                                         */
/* ------------------------------------------------------------------ */

/**
 * Conselho profissional — sigla como o registro é conhecido.
 *
 * A sigla **é** o nome que a pessoa usa ("CREA 12345-D"); traduzir seria
 * afastar da linguagem do ofício. O que o mapa acrescenta é o nome por
 * extenso, para quem não conhece a sigla.
 */
export const CREDENTIAL_TYPES: Readonly<Record<string, string>> = {
  CREA: "Conselho Regional de Engenharia e Agronomia",
  CFT: "Conselho Federal dos Técnicos Industriais",
  CRT: "Conselho Regional dos Técnicos Industriais",
  OTHER: "Outro registro profissional",
};

export function credentialTypeName(type: string): string {
  return CREDENTIAL_TYPES[type] ?? "Registro profissional";
}

/**
 * "CREA 12345-D/PE" — o rótulo curto de uma credencial.
 *
 * `displayLabel` vem pronto quando o backend o publica; só quando não vem é
 * que a etiqueta é montada aqui, e ainda assim a partir dos campos do
 * contrato, sem inventar formatação regional.
 */
export function credentialLabel(
  credential: ProfessionalCredentialReadModel | null | undefined,
): string | null {
  if (!credential) return null;
  if (credential.displayLabel) return credential.displayLabel;
  const region = credential.region ? `/${credential.region}` : "";
  return `${credential.type} ${credential.registrationNumber}${region}`;
}

/* ------------------------------------------------------------------ */
/* Motivos de bloqueio                                                 */
/* ------------------------------------------------------------------ */

/**
 * Por que este profissional não pode assinar — em português.
 *
 * O backend responde com códigos (`SIGNATURE_MISSING`), que servem ao log e à
 * integração. Mostrá-los na tela transferiria para o usuário a tarefa de
 * decifrar o sistema. Cada código vira uma frase que diz **o que resolver**.
 *
 * Só os motivos que o contrato publica. Um código novo cai no texto genérico
 * em vez de aparecer cru — e a ausência de tradução é um defeito visível no
 * teste, não um vazamento em produção.
 */
export const BLOCKED_REASONS: Readonly<
  Record<ProfessionalEligibilityBlockedReason, string>
> = {
  PROFESSIONAL_PROFILE_INACTIVE: "Perfil profissional inativo.",
  PROFESSIONAL_ROLE_MISSING:
    "Não possui o papel profissional exigido por este documento.",
  SIGNATURE_MISSING: "Assinatura profissional não cadastrada.",
  BUSINESS_UNIT_SCOPE_MISSING: "Não atua na unidade deste atendimento.",
  DOCUMENT_POLICY_DENIED:
    "A política deste tipo de documento não permite esta assinatura.",
};

const GENERIC_BLOCK = "Não elegível para assinar este documento.";

export function blockedReasonLabel(
  reason: ProfessionalEligibilityBlockedReason | null | undefined,
): string | null {
  if (!reason) return null;
  return BLOCKED_REASONS[reason] ?? GENERIC_BLOCK;
}

/**
 * A frase **apenas** se este mapa conhecer o código.
 *
 * `blockedReasonLabel` sempre responde algo, e o genérico dele fala de
 * assinatura de documento — o que é certo no contexto profissional e errado
 * fora dele. Quando outro domínio encadeia neste mapa (o PMOC encadeia), ele
 * precisa distinguir "não sei" de "sei que é genérico": responder
 * "não elegível para assinar" a um código de plano suspenso seria pior que
 * não responder.
 */
export function knownBlockedReason(reason: string): string | null {
  return (
    BLOCKED_REASONS[reason as ProfessionalEligibilityBlockedReason] ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Assinatura                                                          */
/* ------------------------------------------------------------------ */

/**
 * Assinatura cadastrada, ou não.
 *
 * Sem alarmismo: a ausência é um fato administrativo comum — a pessoa entrou
 * essa semana, ou não assina documento. O que a tela não faz é esconder,
 * porque é o que impede a emissão quando chega a hora.
 */
export function signatureStatusLabel(available: boolean): string {
  return available ? "Assinatura cadastrada" : "Assinatura não cadastrada";
}

/* ------------------------------------------------------------------ */
/* Alocação na Agenda                                                  */
/* ------------------------------------------------------------------ */

/**
 * O papel de alguém numa alocação de evento.
 *
 * A Agenda espelha a equipe do atendimento: quando o evento vem de uma
 * Operation, o backend replica responsável e auxiliares como alocações. Os
 * códigos são os do domínio de agenda — próximos dos papéis profissionais,
 * mas não os mesmos —, e chegavam crus à tela até esta PR.
 */
export const ALLOCATION_ROLES: Readonly<Record<string, string>> = {
  RESPONSIBLE_FIELD_TECHNICIAN: "Responsável",
  AUXILIARY_TECHNICIAN: "Auxiliar técnico",
};

export function allocationRoleLabel(role: string | null): string | null {
  if (!role) return null;
  /**
   * Código desconhecido não vira rótulo.
   *
   * Mostrar `SOMETHING_NEW` seria pior que não mostrar nada: o usuário não tem
   * o que fazer com isso, e a ausência é visível para quem mantém a tela.
   */
  return ALLOCATION_ROLES[role] ?? null;
}

/**
 * Quem manda no vínculo deste evento.
 *
 * `OPERATION` significa que a equipe pertence ao atendimento e a Agenda apenas
 * reflete — editar aqui criaria duas verdades. `SCHEDULING` é o evento
 * independente, que responde por si.
 */
export const ASSIGNMENT_AUTHORITY: Readonly<Record<string, string>> = {
  OPERATION: "Definido pelo atendimento",
  SCHEDULING: "Definido nesta agenda",
};

export function assignmentAuthorityLabel(authority: string): string | null {
  return ASSIGNMENT_AUTHORITY[authority] ?? null;
}
