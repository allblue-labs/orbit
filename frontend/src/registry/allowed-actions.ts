/**
 * Ações autorizadas por **registro**, decididas pelo backend.
 *
 * ## O que isto resolve
 *
 * `registry/access.ts` responde se a **sessão** pode oferecer algo: o papel tem
 * a permissão, o plano tem a capability. Isso cobre o que é verdade para a
 * conta inteira — e não alcança o que depende do registro concreto.
 *
 * Uma ordem de serviço é o exemplo: mudar o status exige
 * `operations.status.update` **e** participar da operação (ser o responsável ou
 * um auxiliar), a menos que a pessoa gerencie a carteira. Participação é um
 * fato da linha, não da sessão — o navegador não tem como saber. O backend
 * sabe, e por isso publica `allowedActions` em cada Read Model.
 *
 * ```text
 * sessão  → registry/access.ts   → esta conta poderia, em tese?
 * registro → allowedActions      → nesta linha, agora, pode?
 * ```
 *
 * As duas se somam. A primeira esconde o que nunca se aplica; a segunda decide
 * o que se aplica **aqui**.
 *
 * ## Isto continua não sendo autorização
 *
 * O servidor recusa com 403 de qualquer forma. O que se evita é oferecer um
 * botão cuja recusa já está decidida — e, principalmente, **deixar de inferir**
 * a regra no cliente. Antes desta camada o menu de operações escondia ações por
 * permissão apenas: um técnico com `operations.status.update` que não estava
 * escalado via "Alterar status", clicava, e recebia um 403 sem explicação.
 *
 * ## Ausência não é negação
 *
 * Um Read Model que ainda não publica `allowedActions` devolve `undefined`, e
 * aí a decisão volta a ser da camada de sessão — que é o comportamento anterior
 * a esta PR. Nenhuma tela quebra ao adotar o contrato aos poucos.
 */

/** O que a autoridade responde sobre um registro. */
export interface ActionAuthority<TAction extends string> {
  /**
   * O backend publicou a lista?
   *
   * `false` quando o Read Model ainda não traz `allowedActions`. Quem consulta
   * decide o que fazer com a ausência — normalmente, seguir pela sessão.
   */
  readonly declared: boolean;
  /** Esta ação está liberada para este registro agora? */
  permits: (action: TAction) => boolean;
  /**
   * Alguma destas está liberada?
   *
   * Serve a um menu inteiro: sem nenhuma ação, o gatilho não precisa existir.
   */
  permitsAny: (...actions: readonly TAction[]) => boolean;
}

/**
 * Autoridade a partir do que o Read Model publicou.
 *
 * Sem lista publicada, `permits` responde `true`: a decisão fica com quem
 * chamou, exatamente como era antes de o contrato existir. Responder `false`
 * esconderia ações de telas cujo backend ainda não foi atualizado.
 */
export function actionAuthority<TAction extends string>(
  allowedActions: readonly TAction[] | null | undefined,
): ActionAuthority<TAction> {
  if (!allowedActions) {
    return {
      declared: false,
      permits: () => true,
      permitsAny: () => true,
    };
  }

  const granted = new Set<string>(allowedActions);
  return {
    declared: true,
    permits: (action) => granted.has(action),
    permitsAny: (...actions) => actions.some((action) => granted.has(action)),
  };
}

/**
 * As transições que **este** registro aceita agora.
 *
 * A máquina de estados é do servidor. Quando o Read Model a publica, é ela que
 * preenche o seletor; quando não publica — a listagem de operações, por
 * exemplo, é compacta de propósito e só o detalhe traz `transitions` —, esta
 * função devolve `null` e quem chama precisa buscar o detalhe em vez de
 * oferecer o conjunto inteiro do enum.
 *
 * O estado atual nunca é um destino: mudar para onde já se está não é
 * transição, e o backend recusaria.
 */
export function availableTransitions<TStatus extends string>(
  transitions: readonly TStatus[] | null | undefined,
  current: TStatus,
): readonly TStatus[] | null {
  if (!transitions) return null;
  return transitions.filter((status) => status !== current);
}
