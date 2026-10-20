/**
 * O que precisa ser chamado para a atribuição ficar como a pessoa deixou na tela.
 *
 * ## Por que o PATCH não serve
 *
 * `PATCH /operations/:id` **recusa** mudar técnicos, e com razão: trocar o
 * responsável mexe em mais coisas do que uma coluna. O servidor retira o escolhido
 * da lista de auxiliares se ele estava lá, atualiza as alocações do evento na
 * agenda, grava histórico e registra a participação. Um `PATCH` silencioso faria a
 * coluna mudar e o resto ficar para trás.
 *
 * Então existem três comandos — `PATCH :id/responsible-field-technician`,
 * `POST :id/auxiliary-technicians`, `DELETE :id/auxiliary-technicians/:userId` — e o
 * formulário de edição precisa traduzir "era assim, ficou assim" nessa sequência. O
 * painel de equipe da tela de detalhe já fazia isso um clique por vez; o formulário
 * mandava tudo no PATCH e recebia 400 **sempre** que havia técnico escolhido.
 *
 * ## Por que num módulo
 *
 * Porque a tradução tem uma armadilha de ordem. Promover um auxiliar a responsável é
 * um comando só: o servidor o retira dos auxiliares na mesma transação. Emitir
 * também o `DELETE` dele produziria um erro — ou, pior, removeria a pessoa que
 * acabou de ser promovida, dependendo de qual chegasse primeiro.
 */

export interface AtribuicaoDaOperacao {
  readonly responsavel: string;
  readonly auxiliares: readonly string[];
}

export type ComandoDeAtribuicao =
  | { readonly tipo: "responsavel"; readonly userId: string }
  | { readonly tipo: "adicionar-auxiliar"; readonly userId: string }
  | { readonly tipo: "remover-auxiliar"; readonly userId: string };

/**
 * A sequência de comandos que leva de `atual` para `desejado`.
 *
 * Vazia quando nada mudou — e isso importa: sem a comparação, abrir e salvar uma
 * operação sem tocar na equipe reemitiria a atribuição, gravando histórico de uma
 * troca que não houve.
 *
 * O responsável vem primeiro porque o comando dele também mexe nos auxiliares.
 */
export function comandosDeAtribuicao(
  atual: AtribuicaoDaOperacao,
  desejado: AtribuicaoDaOperacao,
): readonly ComandoDeAtribuicao[] {
  const comandos: ComandoDeAtribuicao[] = [];

  /*
   * Limpar o responsável não é expressável.
   *
   * O comando exige um `userId`: a API não tem "desatribuir responsável", porque um
   * atendimento sem dono é o estado que a atribuição existe para evitar. Então
   * esvaziar o campo não emite nada — e a tela avisa, em vez de prometer calada.
   */
  const trocouResponsavel =
    desejado.responsavel.length > 0 &&
    desejado.responsavel !== atual.responsavel;
  if (trocouResponsavel) {
    comandos.push({ tipo: "responsavel", userId: desejado.responsavel });
  }

  /* Quem virou responsável sai dos auxiliares pelo servidor; mandar o `DELETE` dele
     removeria quem acabou de ser promovido. */
  const promovido = trocouResponsavel ? desejado.responsavel : null;

  for (const userId of atual.auxiliares) {
    if (desejado.auxiliares.includes(userId)) continue;
    if (userId === promovido) continue;
    comandos.push({ tipo: "remover-auxiliar", userId });
  }

  for (const userId of desejado.auxiliares) {
    if (atual.auxiliares.includes(userId)) continue;
    /* Ninguém é responsável e auxiliar ao mesmo tempo — o servidor recusa, e o
       formulário já tira um da lista do outro. */
    if (userId === desejado.responsavel) continue;
    comandos.push({ tipo: "adicionar-auxiliar", userId });
  }

  return comandos;
}
