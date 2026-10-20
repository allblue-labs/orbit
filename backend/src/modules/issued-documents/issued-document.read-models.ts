/**
 * Um documento emitido, qualquer que seja o motor que o emitiu.
 *
 * ## Por que existe uma leitura só
 *
 * Porque a organização emite documentos por dois caminhos, e a central mostrava
 * um. O Artifact Engine emite execução + manifesto — PMOC, ordem de serviço,
 * recibo e, agora, orçamento. O módulo de relatórios gerenciais emite
 * `management_reports`, com arquivo guardado e hash de origem, numa tabela
 * própria. Os dois são documento emitido; só o primeiro aparecia em "Documentos
 * emitidos".
 *
 * ## Por que não se juntam no navegador
 *
 * Porque a contagem e a paginação deixariam de ser verdade. Foi o defeito que a
 * própria central já corrigiu uma vez: ela separava filas em memória, e a aba
 * dizia 3 enquanto havia 200. Duas listas paginadas somadas no cliente têm o
 * mesmo problema — a página 2 de uma não é a continuação da página 1 da outra.
 * A união acontece no banco, e `total` continua sendo o total.
 *
 * ## Por que metade dos campos é nula
 *
 * Porque os dois documentos não descrevem a mesma coisa, e fingir que sim seria
 * pior. Uma execução tem código, título, cliente e atendimento; um relatório
 * gerencial tem tipo e período, e não tem cliente — ele fala da operação inteira
 * num intervalo. Cada linha traz o que ela tem, e a tela mostra o que veio em vez
 * de inventar um código para quem não tem.
 */

/** Qual motor emitiu. A tela mostra isto: são documentos de naturezas diferentes. */
export type IssuedDocumentSource = 'EXECUTION' | 'REPORT';

export interface IssuedDocumentReadModel {
  readonly source: IssuedDocumentSource;
  /** O id na origem: execução ou relatório. É por ele que a tela abre o item. */
  readonly id: string;
  /** Código do documento. Relatório gerencial não tem — ele se identifica pelo período. */
  readonly code: string | null;
  /** Título da execução. Nulo no relatório, que se nomeia pelo tipo. */
  readonly title: string | null;
  /**
   * O tipo.
   *
   * Da execução vem do **snapshot**, e não do template: o documento é do tipo que
   * valia quando a execução nasceu, e trocar o template depois não reescreve o
   * passado. Do relatório vem a coluna `type`, cujo rótulo o catálogo publica.
   */
  readonly type: string;
  /**
   * Estado do arquivo, num vocabulário só.
   *
   * Os dois motores já usavam as mesmas quatro palavras para a mesma coisa —
   * `PENDING`, `GENERATING`/`RENDERING`, `READY`, `FAILED` —, então a tradução é
   * de uma palavra: o relatório diz `GENERATING` onde a execução diz `RENDERING`.
   * `NOT_RENDERED` é só da execução: relatório sem arquivo nunca foi pedido.
   */
  readonly renderStatus: string;
  /** Situação na origem, no vocabulário dela. A tela não traduz um no outro. */
  readonly status: string;
  readonly businessUnitId: string | null;
  readonly customerId: string | null;
  readonly operationId: string | null;
  readonly createdAt: string;
  /** A última vez que saiu arquivo. Nulo quando ainda não saiu nenhum. */
  readonly issuedAt: string | null;
  /** Quantas vezes já saiu. Zero enquanto não saiu nenhuma. */
  readonly revisions: number;
  /**
   * O intervalo que o relatório retrata. Nulo na execução, que é de um evento.
   *
   * Os dois limites são meia-noite **UTC** da data civil que a pessoa escolheu: o
   * formulário manda `YYYY-MM-DD` e o contrato o interpreta assim. Quem formatar
   * isto precisa formatar em UTC — no fuso de quem olha, um período que começa em
   * 1º de março passa a dizer 28 de fevereiro. O fuso de agregação do relatório é
   * outra informação, e mora na página dele.
   */
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
}
