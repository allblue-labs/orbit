/**
 * Faz o tempo passar nas assinaturas.
 *
 * ## O que estava faltando
 *
 * `SubscriptionReconciliationService.reconcile()` existia, era um provider e
 * era exportado — e **ninguém o chamava**. Nenhum job, nenhum worker, nenhum
 * cron.
 *
 * O efeito mais visível era o rebaixamento de plano. Ele é programado para o
 * fim do período (`pendingEffectiveAt`), e a linha da assinatura ficava com a
 * mudança pendente para sempre: o plano gravado continuava sendo o antigo, e
 * toda tela que lê a assinatura — a de plano, a de limites, a cobrança —
 * seguia mostrando o plano superior depois de ele ter acabado.
 *
 * A resolução de direitos já olhava `pendingEffectiveAt` em tempo de leitura,
 * então os **tetos** mudavam na hora certa. Era o registro que não mudava, e
 * um produto que cobra por plano não pode ter o plano certo só no cálculo
 * interno e o errado em tudo que a pessoa vê.
 *
 * ## Por que um worker, e não um job por assinatura
 *
 * Porque o gatilho é o relógio, não um evento. Nada acontece quando um período
 * vence — é justamente a ausência de acontecimento que precisa ser notada.
 * Enfileirar um job por assinatura exigiria agendá-lo no futuro e reagendá-lo a
 * cada renovação; varrer o que venceu é mais simples e se recupera sozinho de
 * qualquer janela perdida.
 *
 * ## O intervalo é largo de propósito
 *
 * Cinco minutos. O que este worker corrige muda de dia, não de segundo, e uma
 * varredura por minuto só adicionaria carga para encontrar nada na maioria das
 * vezes. Uma janela de cinco minutos entre o vencimento e o registro é
 * invisível para quem usa, e os direitos já estavam corretos nesse intervalo.
 */
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SubscriptionReconciliationService } from './subscription-reconciliation.service';

const INTERVALO_PADRAO_MS = 5 * 60 * 1000;

@Injectable()
export class SubscriptionLifecycleWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubscriptionLifecycleWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly reconciliation: SubscriptionReconciliationService,
  ) {}

  onModuleInit(): void {
    const globalmente =
      (process.env.JOBS_WORKER_ENABLED ?? 'true').trim() !== 'false';
    const proprio =
      (process.env.SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED ?? 'true').trim() !==
      'false';
    if (!globalmente || !proprio) {
      this.logger.log('[subscription-lifecycle] worker disabled');
      return;
    }

    const configurado = Number(
      process.env.SUBSCRIPTION_LIFECYCLE_INTERVAL_MS ?? INTERVALO_PADRAO_MS,
    );
    const intervalo = Number.isFinite(configurado)
      ? Math.max(30_000, configurado)
      : INTERVALO_PADRAO_MS;

    this.timer = setInterval(() => void this.tick(), intervalo);
    this.timer.unref?.();
    /* Uma passada no boot: uma instância que sobe depois de um fim de semana
       parado não deve esperar o primeiro intervalo para pôr o dia em dia. */
    void this.tick();
    this.logger.log(`[subscription-lifecycle] worker active (${intervalo}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active;
  }

  async tick(): Promise<void> {
    /* Uma varredura por vez: a anterior pode ainda estar correndo numa base
       grande, e duas em paralelo disputariam as mesmas linhas. */
    if (this.stopping || this.active) return;

    const trabalho = this.reconciliation
      .reconcile()
      .then((resumo) => {
        if (resumo.updated > 0) {
          this.logger.log(
            JSON.stringify({
              metric: 'subscription_lifecycle_reconciled_total',
              ...resumo,
            }),
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          JSON.stringify({
            stage: 'subscription-lifecycle-failed',
            errorCategory:
              error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN',
          }),
        );
      });

    this.active = trabalho;
    try {
      await trabalho;
    } finally {
      if (this.active === trabalho) this.active = null;
    }
  }
}
