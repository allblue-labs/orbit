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
let active = 0;

export function shouldOffloadPdf() {
  return isMainThread && processRole() === 'api';
}

/** Keep the existing synchronous HTTP contract without blocking its event loop. */
export async function renderPdfInThread<T>(
  task: PdfTask,
  ...args: unknown[]
): Promise<T> {
  if (active >= 2) {
    throw new ServiceUnavailableException(
      'A geração de PDFs está ocupada. Tente novamente.',
    );
  }
  active++;
  let worker: Worker | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    worker = new Worker(join(__dirname, 'pdf-thread.entry.js'), {
      env: {},
      workerData: { task, input: serialize(args) },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const running = worker;
    return await new Promise<T>((resolve, reject) => {
      const failed = () =>
        reject(
          new ServiceUnavailableException(
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
      running.once('error', failed);
      running.once('exit', failed);
      timer = setTimeout(failed, 30_000);
    });
  } finally {
    clearTimeout(timer);
    try {
      await worker?.terminate();
    } finally {
      active--;
    }
  }
}
