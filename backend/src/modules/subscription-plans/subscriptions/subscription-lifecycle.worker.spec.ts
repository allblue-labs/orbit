/**
 * O worker que faz o tempo passar nas assinaturas.
 *
 * `reconcile()` existia e ninguém o chamava: nenhum job, nenhum worker, nenhum
 * cron. O rebaixamento de plano ficava pendente para sempre na linha da
 * assinatura, e toda tela que a lê seguia mostrando o plano superior depois de
 * ele ter acabado.
 */
import { SubscriptionLifecycleWorker } from './subscription-lifecycle.worker';

const VAZIO = {
  examined: 0,
  updated: 0,
  expired: 0,
  suspended: 0,
  canceled: 0,
  renewed: 0,
  planChangesApplied: 0,
};

describe('worker do ciclo de vida da assinatura', () => {
  afterEach(() => {
    delete process.env.SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED;
    delete process.env.JOBS_WORKER_ENABLED;
  });

  it('reconcilia ao subir, sem esperar o primeiro intervalo', () => {
    /* Uma instância que sobe depois de um fim de semana parado não deve
       esperar para pôr o dia em dia. */
    const reconciliation = { reconcile: jest.fn().mockResolvedValue(VAZIO) };
    const worker = new SubscriptionLifecycleWorker(reconciliation as never);

    worker.onModuleInit();

    expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
    void worker.onModuleDestroy();
  });

  it('uma varredura por vez', async () => {
    /*
     * Duas em paralelo disputariam as mesmas linhas. A segunda chamada sai sem
     * fazer nada enquanto a primeira não termina.
     */
    let liberar: (() => void) | undefined;
    const reconciliation = {
      reconcile: jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            liberar = () => resolve(VAZIO);
          }),
      ),
    };
    const worker = new SubscriptionLifecycleWorker(reconciliation as never);

    const primeira = worker.tick();
    await worker.tick();

    expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
    liberar?.();
    await primeira;
  });

  it('falha não derruba o worker', async () => {
    /* Uma varredura que estoura não pode matar o timer: a seguinte precisa
       acontecer, ou as assinaturas param no tempo em silêncio. */
    const reconciliation = {
      reconcile: jest.fn().mockRejectedValue(new Error('banco fora')),
    };
    const worker = new SubscriptionLifecycleWorker(reconciliation as never);

    await expect(worker.tick()).resolves.toBeUndefined();

    await worker.tick();
    expect(reconciliation.reconcile).toHaveBeenCalledTimes(2);
  });

  it('desligado por configuração não reconcilia', () => {
    process.env.SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED = 'false';
    const reconciliation = { reconcile: jest.fn().mockResolvedValue(VAZIO) };
    const worker = new SubscriptionLifecycleWorker(reconciliation as never);

    worker.onModuleInit();

    expect(reconciliation.reconcile).not.toHaveBeenCalled();
  });
});
