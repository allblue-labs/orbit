import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pdfThreadsInUse,
  renderPdfInThread,
  setPdfThreadEntryForTest,
  withPdfBudget,
} from './pdf-thread';

const dir = mkdtempSync(join(tmpdir(), 'orbit-pdf-thread-'));
function entry(name: string, body: string): string {
  const file = join(dir, `${name}.js`);
  writeFileSync(
    file,
    `const { parentPort, workerData } = require('node:worker_threads');
     const { serialize } = require('node:v8');
     ${body}`,
  );
  return file;
}

const TRAVA = entry('trava', 'setInterval(() => undefined, 1000);');
const RAPIDO = entry(
  'rapido',
  "setTimeout(() => parentPort.postMessage(serialize('ok')), 50);",
);
const MEMORIA = entry(
  'memoria',
  'const guardado = []; for (;;) guardado.push(new Array(1e6).fill(Math.random()));',
);

describe('renderPdfInThread', () => {
  const role = process.env.ORBIT_PROCESS_ROLE;
  afterEach(() => {
    process.env.ORBIT_PROCESS_ROLE = role;
  });

  describe('no container documents (grupo pdf)', () => {
    beforeEach(() => {
      process.env.ORBIT_PROCESS_ROLE = 'documents';
    });

    it('encerra a thread no tempo limite e só então devolve a vaga', async () => {
      setPdfThreadEntryForTest(TRAVA);
      const started = Date.now();
      await expect(
        withPdfBudget({ timeoutMs: 300, concurrency: 1 }, () =>
          renderPdfInThread('quote', {}),
        ),
      ).rejects.toThrow('Não foi possível concluir o PDF');
      expect(Date.now() - started).toBeGreaterThanOrEqual(290);
      /* `terminate()` já terminou quando a promessa rejeitou. */
      expect(pdfThreadsInUse()).toBe(0);
    });

    it('o sinal do job aborta a renderização e encerra a thread', async () => {
      setPdfThreadEntryForTest(TRAVA);
      const controller = new AbortController();
      const reason = new Error('job abortado');
      const render = withPdfBudget(
        { timeoutMs: 60_000, signal: controller.signal, concurrency: 1 },
        () => renderPdfInThread('quote', {}),
      );
      setTimeout(() => controller.abort(reason), 100);
      await expect(render).rejects.toBe(reason);
      expect(pdfThreadsInUse()).toBe(0);
    });

    it('a thread que passa de 256 MB é encerrada e a vaga volta', async () => {
      setPdfThreadEntryForTest(MEMORIA);
      await expect(
        withPdfBudget({ timeoutMs: 30_000, concurrency: 1 }, () =>
          renderPdfInThread('quote', {}),
        ),
      ).rejects.toThrow('Não foi possível concluir o PDF');
      expect(pdfThreadsInUse()).toBe(0);
    }, 40_000);

    it('sem vaga, espera a anterior terminar em vez de recusar', async () => {
      setPdfThreadEntryForTest(RAPIDO);
      const budget = { timeoutMs: 5_000, concurrency: 1 };
      let peak = 0;
      const watch = setInterval(() => {
        peak = Math.max(peak, pdfThreadsInUse());
      }, 5);
      const results = await Promise.all([
        withPdfBudget(budget, () => renderPdfInThread<string>('quote', {})),
        withPdfBudget(budget, () => renderPdfInThread<string>('quote', {})),
      ]);
      clearInterval(watch);
      expect(results).toEqual(['ok', 'ok']);
      expect(peak).toBe(1);
      expect(pdfThreadsInUse()).toBe(0);
    });
  });

  describe('na api (rotas síncronas)', () => {
    beforeEach(() => {
      process.env.ORBIT_PROCESS_ROLE = 'api';
    });

    it('a terceira renderização simultânea recebe 503 na hora', async () => {
      setPdfThreadEntryForTest(RAPIDO);
      const results = await Promise.allSettled([
        renderPdfInThread('quote', {}),
        renderPdfInThread('quote', {}),
        renderPdfInThread('quote', {}),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        'fulfilled',
        'fulfilled',
        'rejected',
      ]);
      expect(pdfThreadsInUse()).toBe(0);
    });
  });
});
