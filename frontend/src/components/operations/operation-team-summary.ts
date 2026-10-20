/**
 * Quem atende, resumido para uma célula da listagem.
 *
 * ## O defeito que isto corrige
 *
 * A coluna "Equipe" lia `operation.users` — a tabela genérica de participação,
 * escrita por `POST /operations/:id/assign` e pelo PMOC quando uma execução começa.
 * Atribuir no formulário de criação grava outra coisa:
 * `responsible_field_technician_id` e `operation_auxiliary_technicians`, que é o
 * modelo que o aplicativo de campo filtra e que `validateTechnicianAssignments`
 * confere.
 *
 * O resultado era um atendimento com Eduardo Queiroz atribuído, chegando no celular
 * dele, e a listagem dizendo **"Sem técnico"**. Quem criou a operação concluiu, com
 * razão, que a atribuição não funcionou — e a tela de detalhe já mostrava o nome
 * certo, porque ela lê o modelo de campo.
 *
 * ## Por que um módulo
 *
 * Porque a célula tem três casos (ninguém, só o responsável, responsável e
 * auxiliares) e um deles é texto com contagem. Dentro do `map` da tabela isso são
 * ternários encadeados que ninguém consegue provar — e foi um ternário encadeado
 * sobre a lista errada que produziu "Sem técnico".
 */

interface Pessoa {
  readonly displayName: string;
}

export interface EquipeDaOperacao {
  readonly responsibleFieldTechnician?: Pessoa | null;
  readonly auxiliaryTechnicians?: readonly { readonly user: Pessoa }[];
}

/**
 * O texto da coluna Equipe.
 *
 * O responsável vem primeiro porque é quem executa; os auxiliares aparecem como
 * contagem, e não como nomes, porque a célula tem uma linha e o detalhe tem a lista
 * inteira.
 *
 * Auxiliar sem responsável não acontece — o servidor recusa —, mas se acontecesse
 * dizer "Sem técnico" esconderia gente atribuída, então os auxiliares são contados
 * de todo jeito.
 */
export function resumoDaEquipe(operation: EquipeDaOperacao): string {
  const responsavel = operation.responsibleFieldTechnician?.displayName?.trim();
  const auxiliares = operation.auxiliaryTechnicians?.length ?? 0;

  if (!responsavel) {
    if (auxiliares === 0) return "Sem técnico";
    return auxiliares === 1 ? "1 auxiliar" : `${auxiliares} auxiliares`;
  }

  return auxiliares === 0 ? responsavel : `${responsavel} +${auxiliares}`;
}
