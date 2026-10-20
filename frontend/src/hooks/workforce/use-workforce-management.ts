"use client";

/**
 * Quem pode administrar a Equipe.
 *
 * ## O que estava errado
 *
 * As abas Equipes, Especialidades, Certificações, Escalas e Papéis decidiam se
 * mostravam os botões de cadastro com `useAction("team-member.update")`. Essa
 * ação é declarada `available: false` no Action Registry — e com razão: **editar
 * um membro não existe em contrato**, porque nome, e-mail e foto pertencem ao
 * perfil de cada pessoa.
 *
 * O efeito foi que `allowed` respondia `false` para todo mundo, inclusive para
 * quem administra a organização, e "Nova equipe", "Nova especialidade" e "Nova
 * escala" nunca apareciam. A página parecia somente leitura, e o defeito era
 * invisível: um botão que não aparece não deixa rastro no console, e o registry
 * estava certo sobre a ação errada.
 *
 * ## Por que aqui e não no Action Registry
 *
 * O registry descreve **ações sobre um registro** — rótulo, ícone, confirmação,
 * superfície onde aparece. Isto é outra pergunta: "esta pessoa administra este
 * catálogo?". É a mesma que `OrganizationTab` e `BusinessUnitsSection` já fazem
 * direto na sessão, e a resposta é curta.
 *
 * Cada exigência abaixo é a do endpoint correspondente, copiada dos decorators
 * do controller. Nenhuma foi inferida.
 */
import { useSession } from "@/providers/session-provider";

/** Um gate: pode, e quando não pode, por quê. */
export interface Gate {
  readonly allowed: boolean;
  /**
   * Por que os botões não aparecem, para a tela poder dizer.
   *
   * `null` quando aparecem — é mensagem de ausência, não de erro.
   */
  readonly reason: string | null;
}

export interface WorkforceManagement {
  /** Equipes, especialidades e certificações. */
  readonly workforce: Gate;
  /** Papel, situação, link de senha e desligamento de um membro. */
  readonly members: Gate;
  /** Escalas — quem decide é o motor de agenda, não o Workforce. */
  readonly shifts: Gate;
  /** Papéis de acesso da organização. */
  readonly roles: Gate;
}

/**
 * A frase muda com o que falta, porque o destino muda: plano se resolve na
 * assinatura, papel com quem administra a conta. "Sem permissão" mandaria
 * metade das pessoas ao lugar errado.
 */
export function gate(temPlano: boolean, temPapel: boolean, oque: string): Gate {
  if (temPlano && temPapel) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: !temPlano
      ? `O plano atual não inclui ${oque}.`
      : `Seu perfil não autoriza ${oque}.`,
  };
}

export function useWorkforceManagement(): WorkforceManagement {
  const session = useSession();

  return {
    /* `POST /workforce/teams`, `/specialties`, `/members/:id/certifications`:
       @Capabilities('workforce.manage') @Permissions('organization.update'). */
    workforce: gate(
      session.hasCapability("workforce.manage"),
      session.hasPermission("organization.update"),
      "administrar a equipe",
    ),
    /* `PATCH /organizations/current/members/:id`,
       `POST /workforce/members/:id/password-link` e `DELETE` do membro exigem
       `organization.members.update` e plano ativo — **nenhuma capability de
       módulo**. Exigir `workforce.manage` aqui seria mais rígido que o servidor,
       e esconderia o botão de quem ele aceitaria. */
    members: gate(
      true,
      session.hasPermission("organization.members.update"),
      "administrar os membros",
    ),
    /* `POST /scheduling/availability`:
       @Capabilities('scheduling.manage') @Permissions('scheduling.availability.manage'). */
    shifts: gate(
      session.hasCapability("scheduling.manage"),
      session.hasPermission("scheduling.availability.manage"),
      "administrar escalas",
    ),
    /* `POST /organizations/current/roles`: @RequiresActivePlan() e
       @Permissions('organization.roles.manage') — sem capability de módulo. */
    roles: gate(
      true,
      session.hasPermission("organization.roles.manage"),
      "administrar papéis de acesso",
    ),
  };
}
