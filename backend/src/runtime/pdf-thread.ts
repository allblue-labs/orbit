/**
 * PDF numa thread encerrável.
 *
 * ## Dois donos, duas regras
 *
 * - **`api`** (rotas síncronas): no máximo 2 renderizações por processo e
 *   30 s cada. Sem vaga, 503 na hora — segurar a requisição HTTP numa fila
 *   interna só trocaria o erro por um tempo limite do proxy.
 * - **`documents`** (grupo `pdf` da fila): as vagas são a concorrência do
 *   grupo, e quem chega sem vaga **espera** — o job já está na fila certa, e
 *   devolvê-lo com 503 gastaria uma tentativa à toa. O tempo limite e o sinal
 *   vêm do job (`withPdfBudget`), aberto pelo worker em volta do processador.
 *
 * ## Encerrar de verdade
 *
 * Estourou o tempo, o job foi abortado ou a thread passou de 256 MB: a
 * promessa rejeita e a thread recebe `terminate()`. A vaga só é devolvida
 * **depois** que `terminate()` termina — senão uma thread nova subiria
 * enquanto a memória da anterior ainda não foi liberada.
 *
 * `combined` (desenvolvimento e E2E) renderiza na própria thread, como antes:
 * o ponto de entrada compilado da thread só existe no build.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { isMainThread, Worker } from 'node:worker_threads';
import { ServiceUnavailableException } from '../exceptions';
import { processRole } from './process-role';

export type PdfTask =
  | 'artifact'
  | 'premium'
  | 'quote'
  | 'pmoc'
  | 'report'
  | 'accepted-quote'
  | 'equipment';

/** O que o job concede à renderização: tempo, sinal de cancelamento e vagas. */
export interface PdfBudget {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly concurrency: number;
}

const budgets = new AsyncLocalStorage<PdfBudget>();

/** Roda `work` com o orçamento do job; toda renderização dentro dele o usa. */
export function withPdfBudget<T>(budget: PdfBudget, work: () => T): T {
  return budgets.run(budget, work);
}

const API_CONCURRENCY = 2;
const API_TIMEOUT_MS = 30_000;
const THREAD_HEAP_MB = 256;

/**
 * Semáforo das threads.
 *
 * `release` só é chamado depois de `terminate()`; os que esperam (papel
 * `documents`) são acordados em ordem de chegada.
 */
class ThreadSlots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  get inUse(): number {
    return this.active;
  }

  tryAcquire(limit: number): boolean {
    if (this.active >= limit) return false;
    this.active++;
    return true;
  }

  acquire(limit: number, signal?: AbortSignal): Promise<void> {
    if (this.tryAcquire(limit)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const wake = () => {
        if (!this.tryAcquire(limit)) return this.waiting.push(wake);
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const index = this.waiting.indexOf(wake);
        if (index >= 0) this.waiting.splice(index, 1);
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new Error('aborted'));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(wake);
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiting.shift()?.();
  }
}

const slots = new ThreadSlots();

/** Quantas threads de PDF estão vivas agora (para teste e observabilidade). */
export function pdfThreadsInUse(): number {
  return slots.inUse;
}

export function shouldOffloadPdf() {
  const role = processRole();
  return isMainThread && (role === 'api' || role === 'documents');
}

/** Ponto de entrada da thread; substituível só pelo teste. */
let entryFile = join(__dirname, 'pdf-thread.entry.js');
export function setPdfThreadEntryForTest(file: string): void {
  entryFile = file;
}

export async function renderPdfInThread<T>(
  task: PdfTask,
  ...args: unknown[]
): Promise<T> {
  const budget = budgets.getStore();
  const queued = processRole() === 'documents' || budget !== undefined;
  const timeoutMs = budget?.timeoutMs ?? API_TIMEOUT_MS;
  const signal = budget?.signal;

  if (queued) {
    await slots.acquire(budget?.concurrency ?? API_CONCURRENCY, signal);
  } else if (!slots.tryAcquire(API_CONCURRENCY)) {
    throw new ServiceUnavailableException(
      'A geração de PDFs está ocupada. Tente novamente.',
    );
  }

  let worker: Worker | undefined;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    worker = new Worker(entryFile, {
      env: {},
      workerData: { task, input: serialize(args) },
      resourceLimits: { maxOldGenerationSizeMb: THREAD_HEAP_MB },
    });
    const running = worker;
    return await new Promise<T>((resolve, reject) => {
      const failed = (reason?: unknown) =>
        reject(
          reason instanceof Error && signal?.aborted
            ? reason
            : new ServiceUnavailableException(
                'Não foi possível concluir o PDF. Tente novamente.',
              ),
        );
      running.once('message', (result: Uint8Array | null) => {
        if (!result) return failed();
        try {
          resolve(deserialize(result) as T);
        } catch {
          failed();
        }
      });
      /* `error` cobre também ERR_WORKER_OUT_OF_MEMORY (limite de 256 MB). */
      running.once('error', () => failed());
      running.once('exit', () => failed());
      timer = setTimeout(() => failed(), timeoutMs);
      if (signal) {
        onAbort = () => failed(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    try {
      await worker?.terminate();
    } finally {
      slots.release();
    }
  }
}
