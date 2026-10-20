/**
 * O fundamento legal citado nos documentos de PMOC.
 *
 * Num arquivo só porque dois documentos citam a mesma lei, e citações que
 * divergem entre o plano e a execução dão exatamente a impressão que a peça
 * existe para desfazer: a de que ninguém conferiu qual norma se aplica.
 *
 * O texto **não** emite parecer de conformidade. Ele diz sob qual norma o
 * documento foi produzido — dizer que o cliente *está* conforme é atestado
 * técnico, e isso é da responsabilidade de quem assina, não do gerador de PDF.
 */

/** Rodapé legal do relatório de execução. */
export const PMOC_EXECUTION_LEGAL_REFERENCE =
  'Plano de Manutenção, Operação e Controle — Lei nº 13.589/2018.';

/**
 * Rodapé legal do documento do plano.
 *
 * Mais longo de propósito: este é o papel que o fiscal pede na porta, e ele
 * precisa dizer o que declara — parque coberto, periodicidade e responsável
 * técnico — para que se veja de imediato se o documento atende ao pedido.
 */
export const PMOC_PLAN_LEGAL_REFERENCE =
  'Documento emitido nos termos da Lei nº 13.589/2018, que obriga os ' +
  'edifícios de uso público e coletivo com sistemas de climatização a manter ' +
  'Plano de Manutenção, Operação e Controle. Declara o parque coberto, a ' +
  'periodicidade contratada e o responsável técnico pela execução. Não ' +
  'constitui atestado de conformidade: a avaliação técnica é de quem assina.';
