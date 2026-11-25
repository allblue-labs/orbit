/**
 * Grupos de filas — o isolamento (bulkhead) do trabalho de fundo.
 *
 * Cada fila pertence a exatamente um grupo, e o grupo decide como ela roda:
 * em que processo, quantos jobs ao mesmo tempo, quantos de uma mesma
 * organização, quanto tempo cada um pode levar e como repete quando falha.
 * Um PDF pesado não disputa vaga com uma notificação, e uma organização com
 * trezentos relatórios na fila não atrasa a vizinha (ver o `claim` em
 * `background-job.queue.ts`).
 *
 * ## Por que a configuração mora aqui, e não em cada processador
 *
 * O processador sabe executar; não sabe — nem deveria — quanto a máquina
 * aguenta. Concorrência, teto por organização e tempo limite são decisão de
 * operação, ajustável por variável de ambiente sem tocar no domínio.
 *
 * ## `fiscal` e `ai` ainda não têm filas
 *
 * Estão declarados para que a primeira integração entre com a política certa
 * desde o primeiro job: NF-e repete por horas com idempotência permanente, e
 * agentes de IA respeitam limite de taxa por organização e global. Uma fila
 * `fiscal.*` ou `ai.*` que caia em outro grupo quebra a validação abaixo.
 */
import { JOB_QUEUES, type JobQueue } from './background-job.types';

export type QueueGroupName = 'pdf' | 'comms' | 'core' | 'fiscal' | 'ai';

export interface BackoffPolicy {
  /** Espera depois da primeira falha. Dobra a cada tentativa. */
  readonly baseMs: number;
  /** Teto da espera. */
  readonly ceilingMs: number;
}

export interface RateWindow {
  /** Quantos jobs podem **começar** dentro da janela. */
  readonly max: number;
  readonly windowMs: number;
}

export interface QueueGroupConfig {
  readonly name: QueueGroupName;
  readonly queues: readonly JobQueue[];
  /** Prefixo reservado ao grupo — `fiscal.` e `ai.`. */
  readonly queuePrefix?: string;
  /** Processo que consome o grupo. `combined` consome todos. */
  readonly role: 'worker' | 'documents';
  /** Jobs simultâneos do grupo **por processo**. */
  readonly concurrency: number;
  /** Jobs simultâneos de uma mesma organização no grupo, somando réplicas. */
  readonly perOrganizationLimit: number;
  /** Tempo máximo de um job; estourou, o sinal é abortado e o job repete. */
  readonly timeoutMs: number;
  /** `thread`: o trabalho pesado roda numa thread encerrável (PDF). */
  readonly isolation: 'inline' | 'thread';
  readonly maxAttempts: number;
  readonly backoff: BackoffPolicy;
  /**
   * `while-active`: a mesma chave não entra duas vezes enquanto pendente ou
   * rodando (o padrão da fila). `permanent`: nem depois de concluída — só um
   * job `DEAD` libera a chave, para reenvio consciente.
   */
  readonly idempotency: 'while-active' | 'permanent';
  readonly rateLimit?: {
    readonly perOrganization: RateWindow;
    readonly global: RateWindow;
  };
}

/** Inteiro positivo do ambiente, dentro de limites; senão, o padrão. */
export function envInt(
  name: string,
  fallback: number,
  { min = 1, max = 1_000 }: { min?: number; max?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function buildQueueGroups(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<QueueGroupName, QueueGroupConfig>> {
  return {
    pdf: {
      name: 'pdf',
      queues: [
        JOB_QUEUES.artifactRender,
        JOB_QUEUES.managementReport,
        JOB_QUEUES.documentExport,
      ],
      role: 'documents',
      concurrency: envInt('JOBS_PDF_CONCURRENCY', 2, { max: 8 }, env),
      perOrganizationLimit: envInt('JOBS_PDF_PER_ORG', 2, { max: 8 }, env),
      timeoutMs: 120_000,
      isolation: 'thread',
      maxAttempts: 3,
      backoff: { baseMs: 5_000, ceilingMs: 300_000 },
      idempotency: 'while-active',
    },
    comms: {
      name: 'comms',
      queues: [JOB_QUEUES.mobilePushDelivery, JOB_QUEUES.mobileNotification],
      role: 'worker',
      concurrency: envInt('JOBS_COMMS_CONCURRENCY', 8, { max: 64 }, env),
      perOrganizationLimit: envInt('JOBS_COMMS_PER_ORG', 4, { max: 64 }, env),
      timeoutMs: 30_000,
      isolation: 'inline',
      maxAttempts: 5,
      backoff: { baseMs: 5_000, ceilingMs: 300_000 },
      idempotency: 'while-active',
    },
    core: {
      name: 'core',
      queues: [
        JOB_QUEUES.artifactManifestIssued,
        JOB_QUEUES.quoteStatusChanged,
        JOB_QUEUES.automationDispatch,
        JOB_QUEUES.automationAction,
        JOB_QUEUES.pmocDueCheck,
        JOB_QUEUES.mobileSyncCleanup,
        JOB_QUEUES.mobileEvidenceCleanup,
        JOB_QUEUES.documentExportCleanup,
      ],
      role: 'worker',
      concurrency: envInt('JOBS_CORE_CONCURRENCY', 2, { max: 32 }, env),
      perOrganizationLimit: envInt('JOBS_CORE_PER_ORG', 1, { max: 32 }, env),
      timeoutMs: 60_000,
      isolation: 'inline',
      maxAttempts: 3,
      backoff: { baseMs: 5_000, ceilingMs: 300_000 },
      idempotency: 'while-active',
    },
    fiscal: {
      name: 'fiscal',
      queues: [],
      queuePrefix: 'fiscal.',
      role: 'worker',
      concurrency: envInt('JOBS_FISCAL_CONCURRENCY', 1, { max: 16 }, env),
      perOrganizationLimit: 1,
      timeoutMs: 60_000,
      isolation: 'inline',
      maxAttempts: 12,
      /* 1 min, 2, 4… até 6 h: SEFAZ fora do ar costuma voltar em horas. */
      backoff: { baseMs: 60_000, ceilingMs: 6 * 3_600_000 },
      idempotency: 'permanent',
    },
    ai: {
      name: 'ai',
      queues: [],
      queuePrefix: 'ai.',
      role: 'worker',
      concurrency: envInt('JOBS_AI_CONCURRENCY', 2, { max: 16 }, env),
      perOrganizationLimit: 1,
      timeoutMs: 90_000,
      isolation: 'inline',
      maxAttempts: 3,
      backoff: { baseMs: 10_000, ceilingMs: 600_000 },
      idempotency: 'while-active',
      rateLimit: {
        perOrganization: {
          max: envInt('JOBS_AI_RATE_ORG', 10, { max: 1_000 }, env),
          windowMs: 60_000,
        },
        global: {
          max: envInt('JOBS_AI_RATE_GLOBAL', 60, { max: 10_000 }, env),
          windowMs: 60_000,
        },
      },
    },
  };
}

/**
 * Toda fila conhecida em exatamente um grupo, e nenhum prefixo reservado fora
 * do seu. Roda no carregamento do módulo: uma fila nova sem grupo quebra o
 * boot e os testes, não a produção às três da manhã.
 */
export function assertQueueGroups(
  groups: Readonly<Record<QueueGroupName, QueueGroupConfig>>,
  known: readonly string[] = Object.values(JOB_QUEUES),
): void {
  const owner = new Map<string, QueueGroupName>();
  for (const group of Object.values(groups)) {
    for (const queue of group.queues) {
      const previous = owner.get(queue);
      if (previous)
        throw new Error(
          `[jobs] fila ${queue} em dois grupos: ${previous} e ${group.name}`,
        );
      owner.set(queue, group.name);
    }
  }
  for (const queue of known) {
    const group = owner.get(queue);
    if (!group) throw new Error(`[jobs] fila ${queue} sem grupo`);
    for (const reserved of Object.values(groups))
      if (
        reserved.queuePrefix &&
        queue.startsWith(reserved.queuePrefix) &&
        group !== reserved.name
      )
        throw new Error(
          `[jobs] fila ${queue} usa o prefixo de ${reserved.name} mas está em ${group}`,
        );
  }
}

export const QUEUE_GROUPS = buildQueueGroups();
assertQueueGroups(QUEUE_GROUPS);

const BY_QUEUE = new Map<string, QueueGroupConfig>(
  Object.values(QUEUE_GROUPS).flatMap((group) =>
    group.queues.map((queue) => [queue, group] as const),
  ),
);

/** O grupo de uma fila. Fila desconhecida é erro de programação. */
export function groupOf(queue: string): QueueGroupConfig {
  const group = BY_QUEUE.get(queue);
  if (!group) throw new Error(`[jobs] fila ${queue} sem grupo`);
  return group;
}

/** Backoff exponencial com teto: base, 2×base, 4×base… até o teto. */
export function backoffDelay(attempts: number, policy: BackoffPolicy): number {
  return Math.min(
    policy.baseMs * 2 ** Math.max(0, attempts - 1),
    policy.ceilingMs,
  );
}
