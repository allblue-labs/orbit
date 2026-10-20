/**
 * Contrato da fila de trabalho assíncrono.
 *
 * ## Por que Postgres, e não uma fila dedicada
 *
 * O Orbit **não adotou mensageria**: não há Redis, BullMQ, RabbitMQ nem Kafka
 * no projeto — só Postgres e Socket.IO. O enunciado desta PR pede para não
 * criar infraestrutura paralela de jobs se já existir mecanismo reutilizável;
 * como não existia, a escolha foi entre acrescentar um componente ao deploy ou
 * usar o que já está lá.
 *
 * Postgres com `FOR UPDATE SKIP LOCKED` entrega o que a PR exige — exclusão
 * mútua entre réplicas, idempotência, retry, backoff, dead-letter — sem um
 * serviço novo para operar, monitorar e proteger. A mesma transação que grava o
 * resultado do trabalho fecha o job: não existe janela em que um renderizou e o
 * outro acha que ainda não.
 *
 * O limite honesto: isto atende dezenas de jobs por segundo, não milhares. Se o
 * volume exigir, a troca por uma fila dedicada é substituir `BackgroundJobQueue`
 * — nenhum processador conhece Postgres.
 */

export const JOB_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Filas conhecidas. Uma constante evita fila nomeada por engano. */
export const JOB_QUEUES = {
  artifactRender: 'artifact.render',
  /**
   * Manifesto emitido.
   *
   * Nomeada pelo **evento**, não por quem consome. O módulo que emite o
   * manifesto não sabe que existe Financeiro, e não deveria: se amanhã o
   * evento interessar a notificações ou a um webhook, ninguém volta aqui para
   * renomear a fila.
   */
  artifactManifestIssued: 'artifact.manifest.issued',
  /**
   * Orçamento mudou de situação.
   *
   * Nomeada pelo evento comercial, não pelo efeito financeiro: aprovar cria
   * receita prevista hoje, e amanhã pode disparar notificação ao vendedor sem
   * que ninguém volte aqui para renomear a fila.
   */
  quoteStatusChanged: 'quote.status.changed',
  /**
   * Um evento de domínio chegou e precisa ser confrontado com as regras.
   *
   * Fan-out: um job por evento, que avalia as regras da organização e
   * enfileira uma ação de cada vez.
   */
  automationDispatch: 'automation.dispatch',
  /**
   * Uma ação de automação, possivelmente **adiada**.
   *
   * É por esta fila que o "lembrete daqui a seis meses" existe: o job fica
   * pendente até `available_at`, e o worker o reivindica quando a hora chega.
   */
  automationAction: 'automation.action',
  /**
   * Composição e renderização de um relatório gerencial.
   *
   * Assíncrona porque a composição varre o período inteiro de vários domínios
   * e a renderização produz um arquivo: segurar a requisição HTTP até o fim
   * daria tempo limite no primeiro relatório anual.
   */
  managementReport: 'management-report.generate',
  /**
   * O vencimento de um plano PMOC chegou perto, ou passou.
   *
   * Um job por plano e por fase, com `available_at` derivado do vencimento —
   * **não é um cron**: não há varredura periódica de tabela nem agendador
   * paralelo. O ciclo seguinte agenda os próprios avisos quando nasce.
   */
  pmocDueCheck: 'pmoc.due-check',
  mobileSyncCleanup: 'mobile.sync.cleanup',
  mobileEvidenceCleanup: 'mobile.evidence.cleanup',
  mobilePushDelivery: 'mobile.push.delivery',
} as const;
export type JobQueue = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

/**
 * O escopo de dados do job — explícito, nunca deduzido.
 *
 * A revisão PR-26.5 mostrou o custo de deduzir: `businessUnitId = null`
 * significava, ao mesmo tempo, "nenhuma unidade" e "todas as unidades", e o
 * worker escolheu a primeira leitura. Sob RLS real, um relatório de
 * organização inteira compunha zeros — com situação `READY` e hash válido.
 *
 * A união discriminada torna o estado ambíguo **irrepresentável**: ou existe
 * uma unidade, ou existe a lista resolvida de quem pediu. Não há terceiro caso,
 * e o `CHECK` de `background_jobs` repete a mesma regra no banco.
 */
export type JobScope =
  | { scope: 'BUSINESS_UNIT'; businessUnitId: string }
  | {
      scope: 'ORGANIZATION';
      /**
       * As unidades que o solicitante podia ver **no momento do pedido**.
       *
       * Resolvido por quem enfileira, não por quem executa. É a mesma escolha
       * já feita para `capabilities` e `permissions` do Management Reports: a
       * autorização do pedido viaja com o trabalho, em vez de ser recarregada
       * quando o worker acorda. Resolver aqui também evita o impasse óbvio —
       * consultar `business_units` exige, pela própria política, já saber
       * quais unidades se pode ver.
       */
      businessUnitIds: readonly string[];
    };

export type EnqueueJobInput = JobScope & {
  queue: JobQueue;
  /**
   * Chave de idempotência.
   *
   * Enquanto houver job pendente ou rodando com esta chave, enfileirar de novo
   * devolve o existente em vez de criar um segundo.
   */
  jobKey: string;
  organizationId: string;
  payload: Record<string, unknown>;
  correlationId: string;
  actorUserId?: string | null;
  maxAttempts?: number;
  /**
   * Quando o job passa a ser elegível. Agora, por padrão.
   *
   * É o que permite trabalho **futuro** sem scheduler: a fila já ordena por
   * `available_at` e o worker só reivindica o que já venceu. Um lembrete de
   * seis meses é um job pendente com esta data seis meses à frente.
   */
  availableAt?: Date;
};

export interface BackgroundJobRecord {
  id: string;
  queue: string;
  jobKey: string;
  organizationId: string;
  businessUnitId: string | null;
  scope: 'BUSINESS_UNIT' | 'ORGANIZATION';
  /** O que o worker declara em `app.business_unit_ids`. */
  businessUnitIds: readonly string[];
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  correlationId: string;
  actorUserId: string | null;
  lastError: string | null;
  availableAt: Date;
  createdAt: Date;
}

/**
 * O escopo de um job derivado de outro.
 *
 * Fan-out — despacho que agenda ações, ação que enfileira renderização —
 * herda o escopo já resolvido do job pai em vez de resolver de novo. O job
 * filho nunca enxerga mais do que o pai enxergava.
 */
export function inheritScope(job: BackgroundJobRecord): JobScope {
  return job.scope === 'BUSINESS_UNIT' && job.businessUnitId
    ? { scope: 'BUSINESS_UNIT', businessUnitId: job.businessUnitId }
    : { scope: 'ORGANIZATION', businessUnitIds: job.businessUnitIds };
}

/**
 * Escopo a partir de uma unidade opcional e do contexto de quem pede.
 *
 * Usado onde o domínio realmente pode não ter unidade — um evento de domínio
 * de alcance organizacional, um relatório sem filtro de filial. `units` são as
 * unidades do solicitante: um relatório "da organização inteira" cobre o que
 * quem pediu podia ver, nem mais nem menos.
 */
export function scopeFor(
  businessUnitId: string | null | undefined,
  units: readonly string[],
): JobScope {
  return businessUnitId
    ? { scope: 'BUSINESS_UNIT', businessUnitId }
    : { scope: 'ORGANIZATION', businessUnitIds: [...new Set(units)] };
}

/**
 * Quem sabe executar uma fila.
 *
 * O processador **não conhece a fila**: recebe o job e devolve, ou lança. Se
 * lançar, a política de retry decide entre repetir e mandar para dead-letter.
 */
export interface JobProcessor {
  readonly queue: JobQueue;
  process(job: BackgroundJobRecord): Promise<void>;
}

/**
 * Erro que não deve ser repetido.
 *
 * Um payload inválido ou uma execução que não existe mais não melhoram na
 * terceira tentativa — repetir só gasta janela de trabalho e polui o log.
 */
export class PermanentJobError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PermanentJobError';
  }
}

/**
 * Processadores se inscrevem em `JobProcessorRegistry`.
 *
 * O token multi-provider que existia aqui só enxergava o módulo onde o worker
 * é declarado — ver o comentário do registro.
 */
