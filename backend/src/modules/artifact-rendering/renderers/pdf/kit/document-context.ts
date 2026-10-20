/**
 * O que um documento premium precisa saber além do formulário.
 *
 * ## O problema que isto resolve
 *
 * O `RenderInput` carrega o que a **execução** é: seções, respostas,
 * assinaturas, evidências. É suficiente para imprimir um formulário, e era
 * exatamente isso que o Orbit imprimia — uma lista de rótulo e valor.
 *
 * Um PMOC de verdade tem cabeçalho com o CNPJ de quem emite, o endereço do
 * cliente, a tabela dos equipamentos atendidos e a vigência do plano. Nada
 * disso é resposta de campo: pedir que o técnico redigite o CNPJ da própria
 * empresa num formulário seria transformar cadastro em digitação, e a primeira
 * vez que alguém errasse o documento sairia errado com aparência de certo.
 *
 * Este contexto é montado a partir do que o sistema **já sabe**.
 *
 * ## Tudo é opcional, e o desenho lida com a ausência
 *
 * Uma organização pode não ter logo; um cliente pode não ter telefone; uma
 * execução avulsa pode não ter plano. O documento omite a linha em vez de
 * imprimir "—" em toda parte, e nenhum bloco depende de um campo que talvez
 * não exista.
 */

/** Quem emite — a unidade de negócio responsável pelo documento. */
export interface DocumentEmitter {
  readonly tradeName?: string;
  readonly legalName?: string;
  /** Já formatado (`CNPJ 21.505.237/0001-02`), porque formatar é do domínio. */
  readonly document?: string;
  readonly address?: string;
  readonly cityState?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  /** Bytes do logo, quando a unidade tem um e ele foi carregado. */
  readonly logo?: Buffer;
  readonly logoMimeType?: string;
}

/** Para quem o serviço foi prestado. */
export interface DocumentCustomer {
  readonly name?: string;
  /** Só quando difere do nome — repetir o mesmo texto duas vezes é ruído. */
  readonly legalName?: string;
  readonly document?: string;
  readonly address?: string;
  readonly contactName?: string;
  readonly contactPhone?: string;
  readonly contactEmail?: string;
}

/** Uma linha da tabela de equipamentos. */
export interface DocumentEquipment {
  readonly sector?: string;
  readonly name?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly capacity?: string;
  readonly identifier?: string;
}

/** O atendimento que originou o documento. */
export interface DocumentOperation {
  readonly code?: string;
  readonly title?: string;
  readonly sector?: string;
  /** Natureza do atendimento — corretiva, preventiva, instalação. */
  readonly kind?: string;
  readonly priority?: string;
  /** O que o cliente pediu, como foi registrado na abertura. */
  readonly description?: string;
  readonly status?: string;
  readonly openedAt?: string;
  readonly scheduledFor?: string;
  readonly scheduledEnd?: string;
  readonly authorizedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  /** Já em palavras: "2 h 15 min". */
  readonly duration?: string;
  readonly fieldTechnician?: string;
  readonly technicalResponsible?: string;
  readonly startedBy?: string;
  readonly completedBy?: string;
  readonly auxiliaryTechnicians?: readonly string[];
}

/** O plano de manutenção, quando o documento nasce de um. */
export interface DocumentPlan {
  readonly code?: string;
  readonly name?: string;
  readonly coverageStart?: string;
  readonly coverageEnd?: string;
  /** Já em palavras: "Mensal", "a cada 3 meses". */
  readonly cadence?: string;
  readonly serviceTypes?: readonly string[];
  readonly notes?: string;
}

/**
 * Qual manutenção deste equipamento é esta.
 *
 * `sequence` é a contagem **do equipamento** no plano, não a do ciclo: um
 * aparelho que entra no contrato no meio da vigência, ou que fica de fora de um
 * ciclo, tem história própria — e é a dele que o relatório afirma.
 *
 * `total` vem da vigência com a periodicidade e é **ausente** em plano sem prazo
 * final: imprimir "3 de 120" por causa de um teto interno seria inventar uma
 * cláusula.
 */
export interface DocumentMaintenance {
  readonly sequence?: number;
  readonly total?: number;
}

export interface DocumentContext {
  readonly emitter?: DocumentEmitter;
  readonly customer?: DocumentCustomer;
  readonly operation?: DocumentOperation;
  readonly plan?: DocumentPlan;
  readonly maintenance?: DocumentMaintenance;
  readonly equipment?: readonly DocumentEquipment[];
  /** Referência legal impressa ao pé do documento, quando há. */
  readonly legalReference?: string;
}

/**
 * Lê o contexto de dentro do `RenderInput`.
 *
 * Viaja em `metadata.documentContext` porque `RenderInput` é o contrato dos
 * renderers e acrescentar um campo obrigatório a ele quebraria todo renderer
 * existente — inclusive o HTML, que não precisa de nada disto. A leitura é
 * tolerante: metadata é JSON livre, e um documento sem contexto continua
 * saindo, apenas mais pobre.
 */
export function readDocumentContext(
  metadata: Readonly<Record<string, unknown>>,
): DocumentContext {
  const bruto = metadata.documentContext;
  if (!bruto || typeof bruto !== 'object') return {};
  return bruto;
}
