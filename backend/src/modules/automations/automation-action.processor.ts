/**
 * Executa **uma** ação de automação.
 *
 * ## A ação acontece no máximo uma vez
 *
 * O processador reivindica a linha de execução antes de fazer qualquer coisa.
 * `claim` só devolve linha se a ação ainda não foi bem-sucedida — retry da
 * fila, job devolvido por tempo limite e reprocessamento manual convergem para
 * um efeito. Um lembrete de seis meses nunca vira dois.
 *
 * ## A ação nunca sai do tenant
 *
 * Tudo o que a ação escreve passa pela RLS reaberta pelo worker: o lembrete
 * pelo `WITH CHECK` de `scheduling_events`, a notificação pelo de
 * `notifications`. Uma regra com unidade de outra organização não escreveria
 * nada — o banco recusa antes de o serviço perceber.
 *
 * ## Falha vai para retry, e o efeito não duplica
 *
 * Erro fecha a execução como `FAILED` e **relança**: a fila cuida do backoff e
 * do dead-letter. Como a linha não está `SUCCEEDED`, a retomada é permitida —
 * e como a ação verifica antes de agir, retomar não repete o que já deu certo.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import {
  JOB_QUEUES,
  PermanentJobError,
  inheritScope,
  type BackgroundJobRecord,
  type JobProcessor,
  type JobQueue,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import { ALLOWED_JOB_QUEUES, type RuleAction } from './automation.catalog';
import { AutomationRepository } from './automation.repository';
import {
  EntitlementService,
  PlanUsageLimitReachedException,
  UsageResource,
} from '../subscription-plans/entitlements';

/**
 * Lê uma chave de configuração como texto.
 *
 * `config` é `Record<string, unknown>` por desenho — cada ação valida o que
 * aceita. Converter com `String()` direto transformaria um objeto em
 * `"[object Object]"` e a validação passaria; aqui, valor não escalar vira
 * string vazia e cai na recusa por campo obrigatório.
 */
function text(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/** Duração padrão de um lembrete na agenda. */
const DEFAULT_REMINDER_MINUTES = 60;

interface ExecutionOutcome {
  resultType: string;
  resultId: string | null;
  detail?: string;
}

@Injectable()
export class AutomationActionProcessor implements JobProcessor, OnModuleInit {
  readonly queue: JobQueue = JOB_QUEUES.automationAction;

  private readonly logger = new Logger(AutomationActionProcessor.name);

  constructor(
    private readonly repository: AutomationRepository,
    private readonly jobs: BackgroundJobQueue,
    private readonly registry: JobProcessorRegistry,
    private readonly entitlements: EntitlementService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord): Promise<void> {
    const { eventId, ruleId, actionId } = job.payload as {
      eventId?: string;
      ruleId?: string;
      actionId?: string;
    };

    if (!eventId || !ruleId || !actionId) {
      throw new PermanentJobError('automation action job without identity');
    }

    const claimed = await this.repository.claim(eventId, ruleId, actionId);
    /** Já executada com sucesso: reentrega, não trabalho. */
    if (!claimed) {
      this.logger.log(
        JSON.stringify({
          stage: 'action-already-done',
          eventId,
          ruleId,
          actionId,
          correlationId: job.correlationId,
        }),
      );
      return;
    }

    /**
     * A execução reivindicada é a unidade comercial de automação.
     *
     * Cobrada aqui, depois de a reivindicação decidir que há trabalho a fazer
     * e antes de a ação acontecer (§81). Retry técnico volta a reivindicar a
     * mesma linha, e o razão recusa a segunda contagem — uma automação, uma
     * unidade, quantas tentativas forem precisas.
     *
     * Sem cota a execução é descartada, e não falha: uma fila que repete para
     * sempre uma ação que o plano não permite não ajuda ninguém. O motivo fica
     * registrado em linguagem de negócio, onde quem configurou a regra o lê.
     */
    try {
      await this.entitlements.consume(
        job.organizationId,
        UsageResource.AUTOMATION_RUNS,
        { type: 'AUTOMATION_EXECUTION', id: claimed.id },
      );
    } catch (error) {
      if (!(error instanceof PlanUsageLimitReachedException)) throw error;
      await this.repository.finish({
        id: claimed.id,
        status: 'SKIPPED',
        detail: 'Limite mensal de automações do plano atingido.',
      });
      return;
    }

    const event = await this.repository.findEvent(eventId, job.organizationId);
    const rule = await this.repository.find(ruleId, job.organizationId);

    if (!event || !rule) {
      await this.repository.finish({
        id: claimed.id,
        status: 'SKIPPED',
        detail: 'Evento ou regra não existem mais.',
      });
      return;
    }

    const jobUnits =
      job.scope === 'BUSINESS_UNIT' && job.businessUnitId
        ? [job.businessUnitId]
        : job.businessUnitIds;
    const escapedScope =
      (event.businessUnitId !== null &&
        !rule.scopeBusinessUnitIds.includes(event.businessUnitId)) ||
      jobUnits.some((id) => !rule.scopeBusinessUnitIds.includes(id));
    if (escapedScope) {
      await this.repository.finish({
        id: claimed.id,
        status: 'SKIPPED',
        detail: 'Evento ou job fora do escopo configurado da regra.',
      });
      return;
    }

    /**
     * A regra pode ter sido desligada **depois** do agendamento.
     *
     * É o caso do lembrete de seis meses: entre o agendamento e a execução, a
     * organização pode ter decidido que aquela automação não vale mais.
     * Executar assim mesmo criaria um lembrete que ninguém quer — e que
     * ninguém entenderia de onde veio.
     */
    if (!rule.enabled) {
      await this.repository.finish({
        id: claimed.id,
        status: 'SKIPPED',
        detail: 'A regra foi desativada antes de a ação acontecer.',
      });
      return;
    }

    const action = ((rule.actions ?? []) as unknown as RuleAction[]).find(
      (candidate) => candidate.id === actionId,
    );
    if (!action) {
      await this.repository.finish({
        id: claimed.id,
        status: 'SKIPPED',
        detail: 'A ação foi removida da regra antes de acontecer.',
      });
      return;
    }

    const started = Date.now();
    try {
      const outcome = await this.execute(job, event, action);
      await this.repository.finish({
        id: claimed.id,
        status: 'SUCCEEDED',
        resultType: outcome.resultType,
        resultId: outcome.resultId,
        detail: outcome.detail ?? null,
      });

      this.logger.log(
        JSON.stringify({
          stage: 'action-executed',
          eventId,
          ruleId,
          actionId,
          actionType: action.type,
          correlationId: job.correlationId,
          attempt: claimed.attempts,
          resultId: outcome.resultId,
          durationMs: Date.now() - started,
        }),
      );
    } catch (error) {
      // PermanentJobError is produced by this bounded processor for stable
      // domain conditions (for example, a notification without a recipient).
      // Preserve that actionable reason in the domain execution only. Provider
      // and unexpected exceptions remain opaque, and logs receive only a code.
      const reason =
        error instanceof PermanentJobError
          ? error.message
          : 'ACTION_EXECUTION_FAILED';

      await this.repository.finish({
        id: claimed.id,
        status: 'FAILED',
        detail: reason.slice(0, 500),
      });

      this.logger.warn(
        JSON.stringify({
          stage: 'action-failed',
          eventId,
          ruleId,
          actionId,
          actionType: action.type,
          correlationId: job.correlationId,
          attempt: claimed.attempts,
          failureCode:
            error instanceof PermanentJobError
              ? 'PERMANENT_ACTION_ERROR'
              : 'ACTION_EXECUTION_FAILED',
        }),
      );

      /** Relança: a fila decide entre repetir e enterrar. */
      throw error;
    }
  }

  /* ---------------------------------------------------------------- */
  /* As ações                                                          */
  /* ---------------------------------------------------------------- */

  private execute(
    job: BackgroundJobRecord,
    event: {
      id: string;
      businessUnitId: string | null;
      actorId: string | null;
      entityType: string;
      entityId: string;
      payload: Prisma.JsonValue;
      correlationId: string;
    },
    action: RuleAction,
  ): Promise<ExecutionOutcome> {
    switch (action.type) {
      case 'CREATE_REMINDER':
        return this.createReminder(job, event, action);
      case 'SEND_NOTIFICATION':
        return this.sendNotification(job, event, action);
      case 'TRIGGER_JOB':
        return this.triggerJob(job, event, action);
      default:
        throw new PermanentJobError(
          `automation action type not executable: ${action.type}`,
        );
    }
  }

  /**
   * Lembrete na agenda.
   *
   * O bloco começa **quando a ação executa** — o atraso já aconteceu na fila.
   * Marcar o lembrete para daqui a seis meses e executar agora seria calcular o
   * prazo duas vezes; o job pendente já é o prazo.
   *
   * `sourceModule`/`sourceEntity` apontam para o fato que o gerou: quem abrir a
   * agenda vê de onde o lembrete veio.
   */
  private async createReminder(
    job: BackgroundJobRecord,
    event: {
      businessUnitId: string | null;
      entityType: string;
      entityId: string;
      correlationId: string;
    },
    action: RuleAction,
  ): Promise<ExecutionOutcome> {
    const calendar = await this.repository.defaultCalendar(
      job.organizationId,
      event.businessUnitId,
    );
    if (!calendar) {
      throw new PermanentJobError(
        'a organização não tem calendário ativo para receber o lembrete',
      );
    }

    const title = text(action.config, 'title') || 'Lembrete automático';
    const minutes = Number(
      action.config.durationMinutes ?? DEFAULT_REMINDER_MINUTES,
    );
    const startsAt = new Date();
    const endsAt = new Date(
      startsAt.getTime() +
        (Number.isFinite(minutes) && minutes > 0
          ? minutes
          : DEFAULT_REMINDER_MINUTES) *
          60_000,
    );

    const reminder = await this.repository.createReminder({
      id: generateUuidV7(),
      organizationId: job.organizationId,
      businessUnitId: event.businessUnitId,
      calendarId: calendar.id,
      createdById: job.actorUserId ?? (await this.fallbackActor(job)),
      title: title.slice(0, 220),
      description:
        typeof action.config.description === 'string'
          ? action.config.description
          : null,
      type: 'REMINDER',
      status: 'CONFIRMED',
      startsAt,
      endsAt,
      timezone: calendar.timezone,
      sourceModule: 'automations',
      sourceEntityType: event.entityType,
      sourceEntityId: event.entityId,
      metadata: {
        automation: true,
        correlationId: event.correlationId,
      },
    });

    return { resultType: 'SCHEDULING_EVENT', resultId: reminder.id };
  }

  /**
   * Notificação.
   *
   * O destinatário é sempre um usuário **da organização**, resolvido agora:
   * `OWNER` e `ACTOR` saem do evento, `USER` da configuração da regra — e é
   * conferido contra as associações do tenant. Não há e-mail livre nem
   * destino externo.
   */
  private async sendNotification(
    job: BackgroundJobRecord,
    event: {
      actorId: string | null;
      entityType: string;
      entityId: string;
      payload: Prisma.JsonValue;
      correlationId: string;
      businessUnitId: string | null;
    },
    action: RuleAction,
  ): Promise<ExecutionOutcome> {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const target = text(action.config, 'target') || 'ACTOR';

    const candidate =
      target === 'USER'
        ? text(action.config, 'userId') || ''
        : target === 'OWNER'
          ? text(payload, 'ownerUserId') || text(payload, 'createdById')
          : (event.actorId ?? '');

    if (!candidate) {
      /**
       * Sem destinatário resolvível não é falha do motor — é o evento não
       * carregar quem receberia. Repetir não mudaria isso.
       */
      throw new PermanentJobError(
        `não há destinatário para a notificação (alvo ${target})`,
      );
    }

    const member = await this.repository.findUser(
      candidate,
      job.organizationId,
    );
    if (!member) {
      throw new PermanentJobError(
        'o destinatário não é membro ativo desta organização',
      );
    }

    const notification = await this.repository.createNotification({
      id: generateUuidV7(),
      organizationId: job.organizationId,
      businessUnitId: event.businessUnitId,
      recipientUserId: member.userId,
      type: 'AUTOMATION',
      title: (text(action.config, 'title') || 'Automação').slice(0, 180),
      body: text(action.config, 'body') || '',
      payload: {
        automation: true,
        entityType: event.entityType,
        entityId: event.entityId,
        correlationId: event.correlationId,
      },
    });

    return { resultType: 'NOTIFICATION', resultId: notification.id };
  }

  /**
   * Trabalho interno.
   *
   * A fila é conferida contra uma lista fechada. Sem isso, uma regra poderia
   * enfileirar em `automation.action` e criar um laço — que é justamente o que
   * esta PR não implementa.
   */
  private async triggerJob(
    job: BackgroundJobRecord,
    event: { id: string; correlationId: string; businessUnitId: string | null },
    action: RuleAction,
  ): Promise<ExecutionOutcome> {
    const queue = text(action.config, 'queue') || '';
    if (!ALLOWED_JOB_QUEUES.includes(queue)) {
      throw new PermanentJobError(
        `fila não permitida para automação: ${queue || '(vazio)'}`,
      );
    }

    const payload =
      typeof action.config.payload === 'object' &&
      action.config.payload !== null
        ? (action.config.payload as Record<string, unknown>)
        : {};

    const enqueued = await this.jobs.enqueue({
      queue: queue as JobQueue,
      /** A identidade da ação vira a do trabalho: retry não enfileira dois. */
      jobKey: `automation:${event.id}:${action.id}`,
      organizationId: job.organizationId,
      /** O trabalho gerado herda o escopo da ação, não o inventa. */
      ...inheritScope(job),
      payload,
      correlationId: event.correlationId,
      actorUserId: job.actorUserId,
    });

    return { resultType: 'BACKGROUND_JOB', resultId: enqueued.id };
  }

  /**
   * Quem "criou" um registro feito por automação.
   *
   * O evento costuma ter ator; quando não tem — expiração, por exemplo — usa-se
   * quem criou a regra. Não há usuário de sistema no Orbit, e inventar um
   * criaria uma identidade sem dono no `AuditLog`.
   */
  private async fallbackActor(job: BackgroundJobRecord): Promise<string> {
    const rule = await this.repository.find(
      text(job.payload, 'ruleId'),
      job.organizationId,
    );
    if (!rule) {
      throw new PermanentJobError(
        'sem ator para registrar o lembrete: evento sem autor e regra ausente',
      );
    }
    return rule.createdBy.id;
  }
}
