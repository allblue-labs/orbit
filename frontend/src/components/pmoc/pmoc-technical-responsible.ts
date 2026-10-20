/**
 * Quem responde tecnicamente pelo PMOC.
 *
 * ## Dois papéis que o nome parecido confunde
 *
 * O **técnico responsável** (`technicianUserId`) é quem vai ao local: abre a
 * execução, preenche o roteiro, atende o equipamento. O **Responsável Técnico**
 * (`technicalResponsibleUserId`) é quem responde tecnicamente pelo contrato e cuja
 * assinatura sai no documento do PMOC — normalmente alguém com a credencial de
 * conselho esperada, e muitas vezes o próprio dono da plataforma.
 *
 * São colunas diferentes no plano e já eram desde sempre; o que faltava era o
 * formulário oferecer a segunda. O wizard dizia "o Responsável Técnico profissional
 * é definido no detalhe do plano, antes da ativação" — e quem criava um PMOC saía
 * dali com um plano que não podia iniciar execução nenhuma, sem saber por quê.
 *
 * ## A assinatura é o que importa de verdade
 *
 * `POST /pmoc/.../executions` exige Responsável Técnico **com assinatura ativa**
 * (`assertTechnicalResponsible` com `requireSignature`). A criação do plano não
 * exige, e está certo: contrato se assina depois de redigido. Mas escolher aqui
 * alguém sem assinatura é escolher um plano que vai travar na primeira execução — e
 * é por isso que a tela mostra o estado da assinatura ao lado de cada nome em vez de
 * deixar a pessoa descobrir no dia do atendimento.
 */

/** O mínimo que a escolha precisa saber de cada candidato. */
export interface CandidatoRT {
  readonly id: string;
  readonly name: string;
  readonly signatureAvailable: boolean;
}

/**
 * Quem vem pré-selecionado.
 *
 * O dono, quando elegível — é ele na esmagadora maioria dos casos, e abrir o campo
 * vazio obrigaria todo mundo a escolher a si mesmo em todo plano.
 *
 * Não sendo elegível, o primeiro **com assinatura**: um candidato sem assinatura
 * pré-selecionado produziria um plano que trava na execução sem ninguém ter
 * escolhido isso. Se ninguém tem assinatura, o primeiro da lista — ele ainda é
 * melhor que vazio, e a tela avisa o que falta.
 */
export function responsavelTecnicoPadrao(
  candidatos: readonly CandidatoRT[],
  ownerUserId: string | null,
): string {
  if (candidatos.length === 0) return "";

  const dono = ownerUserId
    ? candidatos.find((item) => item.id === ownerUserId)
    : undefined;
  if (dono) return dono.id;

  const comAssinatura = candidatos.find((item) => item.signatureAvailable);
  return (comAssinatura ?? candidatos[0]!).id;
}

/** O que a tela diz sobre a escolha atual, e se é um impedimento. */
export interface AvisoDoRT {
  readonly texto: string;
  readonly bloqueia: boolean;
}

/**
 * O aviso da escolha.
 *
 * `bloqueia` não impede criar o plano — o servidor aceita, e contrato se redige
 * antes de assinar. Ele marca o que vai travar depois, para a tela poder diferenciar
 * "falta algo" de "está pronto" sem inventar uma recusa que o domínio não faz.
 */
export function avisoDoResponsavelTecnico(
  candidatos: readonly CandidatoRT[],
  escolhido: string,
): AvisoDoRT | null {
  if (candidatos.length === 0) {
    return {
      texto:
        "Ninguém está habilitado como Responsável Técnico nesta unidade. Habilite em Equipe › o membro › Perfil profissional.",
      bloqueia: true,
    };
  }

  if (!escolhido) {
    return {
      texto:
        "Sem Responsável Técnico o plano é criado, mas nenhuma execução pode começar.",
      bloqueia: true,
    };
  }

  const pessoa = candidatos.find((item) => item.id === escolhido);
  if (!pessoa) return null;

  if (!pessoa.signatureAvailable) {
    return {
      texto: `${pessoa.name} ainda não tem assinatura cadastrada. É a assinatura que sai no documento do PMOC — sem ela a execução não abre. Pode ser cadastrada no aplicativo de campo, em Minha assinatura.`,
      bloqueia: true,
    };
  }

  return null;
}
