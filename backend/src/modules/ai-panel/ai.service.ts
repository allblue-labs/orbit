import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ICryptoProvider, JSONObject } from '../../contracts';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { CRYPTO_PROVIDER } from '../../providers';
import { documentHash } from '../document-engine/canonical-document';
import { NotificationService } from '../notifications/notification.service';
import type {
  AiAgentQueryDto,
  AiExecutionQueryDto,
  CreateAiAgentDto,
  ExecuteAiAgentDto,
  UpdateAiAgentDto,
} from './ai.dto';
import { AiContextTool } from './ai.dto';
import {
  EntitlementService,
  PlanCapability,
  UsageResource,
} from '../subscription-plans/entitlements';
import { AiProviderRegistry } from './ai-provider';
import { AiRepository } from './ai.repository';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly repository: AiRepository,
    private readonly providers: AiProviderRegistry,
    private readonly notifications: NotificationService,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
    private readonly entitlements: EntitlementService,
  ) {}

  listAgents(organizationId: string, query: AiAgentQueryDto) {
    return this.repository.listAgents(organizationId, query);
  }

  async getAgent(id: string, organizationId: string) {
    const agent = await this.repository.findAgent(id, organizationId);
    if (!agent) throw new EntityNotFoundException('AI agent', id);
    return agent;
  }

  async createAgent(organizationId: string, input: CreateAiAgentDto) {
    await this.requireIntegration(
      input.integrationId,
      organizationId,
      input.provider,
    );
    try {
      return await this.repository.createAgent(organizationId, {
        key: input.key.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim(),
        provider: input.provider,
        model: input.model.trim(),
        integrationId: input.integrationId,
        systemPrompt: input.systemPrompt.trim(),
        tools: [...new Set(input.tools ?? [])],
        configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
        status: input.status ?? 'ACTIVE',
      });
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async updateAgent(
    id: string,
    organizationId: string,
    input: UpdateAiAgentDto,
  ) {
    const current = await this.getAgent(id, organizationId);
    if (input.integrationId)
      await this.requireIntegration(
        input.integrationId,
        organizationId,
        input.provider ?? current.provider,
      );
    const versioned = [
      'key',
      'provider',
      'model',
      'integrationId',
      'systemPrompt',
      'tools',
      'configuration',
    ].some((field) => input[field as keyof UpdateAiAgentDto] !== undefined);
    if (versioned) {
      return this.createAgent(organizationId, {
        key: input.key ?? current.key,
        name: input.name ?? current.name,
        description: input.description ?? current.description ?? undefined,
        provider: input.provider ?? current.provider,
        model: input.model ?? current.model,
        integrationId: input.integrationId ?? current.integrationId!,
        systemPrompt: input.systemPrompt ?? current.systemPrompt,
        tools: input.tools ?? (current.tools as string[]),
        configuration:
          input.configuration ??
          (current.configuration as Record<string, unknown>),
        status: input.status ?? current.status,
      });
    }
    return this.repository.updateAgent(id, {
      name: input.name?.trim(),
      description: input.description?.trim(),
      status: input.status,
    });
  }

  async removeAgent(id: string, organizationId: string) {
    await this.getAgent(id, organizationId);
    await this.repository.deleteAgent(id);
  }

  listExecutions(organizationId: string, query: AiExecutionQueryDto) {
    return this.repository.listExecutions(organizationId, query);
  }

  async getExecution(id: string, organizationId: string) {
    const execution = await this.repository.findExecution(id, organizationId);
    if (!execution) throw new EntityNotFoundException('AI execution', id);
    return execution;
  }

  async execute(
    agentId: string,
    organizationId: string,
    userId: string,
    input: ExecuteAiAgentDto,
  ) {
    /**
     * O portão da camada de inteligência.
     *
     * É aqui, e só aqui, que o plano decide sobre IA: este é o caminho de IA
     * **vendida ao cliente**. Processamento interno da plataforma não passa
     * por este serviço e não é barrado por plano nenhum (§90) — confundir os
     * dois desligaria funcionalidade que o cliente já pagou por outro nome.
     *
     * Cobrar e liberar são coisas diferentes: o portão é a capacidade; a
     * medição acontece depois, e vale também para quem tem a capacidade.
     */
    await this.entitlements.assertCapability(
      organizationId,
      PlanCapability.ORBIT_INTELLIGENCE,
    );

    const agent = await this.repository.findAgentInternal(
      agentId,
      organizationId,
    );
    if (!agent || agent.status !== 'ACTIVE')
      throw new ValidationException('Active AI agent is required');
    if (!agent.integration || agent.integration.status !== 'ACTIVE')
      throw new ValidationException('Active AI integration is required');
    if (
      agent.integration.provider !== agent.provider ||
      agent.integration.category !== 'AI'
    )
      throw new ValidationException('AI integration no longer matches agent');

    const tools = new Set(agent.tools as string[]);
    this.assertAllowedContext(tools, input);
    const rawContext = await this.repository.context(organizationId, input);
    this.assertContextFound(input, rawContext);
    this.assertContextConsistency(rawContext);
    const context = this.authorizedContext(tools, rawContext);
    const executionInput = {
      prompt: input.prompt.trim(),
      input: input.input ?? {},
      references: {
        customerId: input.customerId,
        operationId: input.operationId,
        reportId: input.reportId,
      },
    };
    const inputHash = documentHash(executionInput);
    if (input.idempotencyKey) {
      const existing = await this.repository.findByIdempotency(
        organizationId,
        userId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.inputHash !== inputHash)
          throw new ConflictException(
            'Idempotency key was already used with different input',
          );
        return existing;
      }
    }
    const snapshot = {
      agentId: agent.id,
      key: agent.key,
      version: agent.version,
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools,
      configuration: agent.configuration,
    };
    let execution;
    try {
      execution = await this.repository.createExecution({
        organizationId,
        agentId: agent.id,
        userId,
        customerId: input.customerId,
        operationId: input.operationId,
        reportId: input.reportId,
        idempotencyKey: input.idempotencyKey,
        purpose: agent.key,
        input: executionInput as Prisma.InputJsonValue,
        inputHash,
        agentSnapshot: snapshot,
        contextSnapshot: context as Prisma.InputJsonValue,
      });
    } catch (error) {
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.repository.findByIdempotency(
          organizationId,
          userId,
          input.idempotencyKey,
        );
        if (existing?.inputHash === inputHash) return existing;
      }
      throw error;
    }

    const started = await this.repository.startExecution(execution.id);
    if (!started)
      throw new ConflictException('AI execution could not be started');
    const startedAt = Date.now();
    try {
      const adapter = this.providers.get(agent.provider);
      const result = await adapter.execute({
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        userPrompt: input.prompt.trim(),
        context: {
          ...context,
          input: (input.input ?? {}) as JSONObject,
        },
        configuration: this.object(agent.configuration),
        integrationConfiguration: this.object(agent.integration.configuration),
        secrets: this.decrypt(agent.integration.encryptedSecrets),
      });
      const outputHash = documentHash(result.output);
      const completed = await this.repository.finishExecution(execution.id, {
        status: 'SUCCEEDED',
        output: result.output as Prisma.InputJsonValue,
        outputHash,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCost: this.cost(
          result.inputTokens,
          result.outputTokens,
          this.object(agent.configuration),
        ),
        providerRequestId: result.providerRequestId,
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      });
      await this.meter(organizationId, completed.id);
      if (input.notifyOnCompletion)
        await this.notify(organizationId, userId, completed.id, true);
      return completed;
    } catch (error) {
      const failed = await this.repository.finishExecution(execution.id, {
        status: 'FAILED',
        error: {
          code: 'PROVIDER_EXECUTION_FAILED',
          message: 'The provider could not complete this execution.',
        },
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      });
      if (input.notifyOnCompletion)
        await this.notify(organizationId, userId, failed.id, false);
      throw error;
    }
  }

  /**
   * Registra a execução de IA consumida, sem barrar ninguém.
   *
   * A unidade comercial de IA ainda não foi escolhida — chamada, token ou
   * custo —, e inventar um teto agora congelaria a escolha errada (§33). O
   * que existe hoje é a medição: uma execução, um evento no razão. O detalhe
   * caro (modelo, tokens, custo estimado em decimal, tempo) já mora em
   * `ai_executions`, então nada precisa ser duplicado aqui.
   *
   * Medir nunca pode derrubar a resposta que o cliente já recebeu: falha de
   * medição vira registro, e não exceção.
   */
  private async meter(
    organizationId: string,
    executionId: string,
  ): Promise<void> {
    try {
      await this.entitlements.consume(
        organizationId,
        UsageResource.AI_COMPUTE,
        { type: 'AI_EXECUTION', id: executionId },
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          stage: 'ai-metering-failed',
          executionId,
          errorClass: error instanceof Error ? error.constructor.name : 'Error',
        }),
      );
    }
  }

  async cancel(id: string, organizationId: string) {
    await this.getExecution(id, organizationId);
    const cancelled = await this.repository.cancelExecution(id);
    if (cancelled.count !== 1)
      throw new ConflictException(
        'Only a pending AI execution can be cancelled',
      );
    return this.getExecution(id, organizationId);
  }

  private async requireIntegration(
    id: string,
    organizationId: string,
    provider: string,
  ) {
    const integration = await this.repository.findIntegration(
      id,
      organizationId,
    );
    if (!integration)
      throw new ValidationException('Active tenant integration is required');
    if (integration.provider !== provider || integration.category !== 'AI')
      throw new ValidationException(
        'Agent provider must match an AI integration',
      );
  }

  private assertAllowedContext(tools: Set<string>, input: ExecuteAiAgentDto) {
    const checks = [
      [input.customerId, AiContextTool.CUSTOMER_READ],
      [input.operationId, AiContextTool.OPERATION_READ],
      [input.reportId, AiContextTool.REPORT_READ],
    ] as const;
    for (const [reference, tool] of checks) {
      if (reference && !tools.has(tool))
        throw new ValidationException(`Agent is not allowed to use ${tool}`);
    }
  }

  private assertContextFound(
    input: ExecuteAiAgentDto,
    context: Awaited<ReturnType<AiRepository['context']>>,
  ) {
    if (input.customerId && !context.customer)
      throw new EntityNotFoundException('Customer', input.customerId);
    if (input.operationId && !context.operation)
      throw new EntityNotFoundException('Operation', input.operationId);
    if (input.reportId && !context.report)
      throw new EntityNotFoundException('Report', input.reportId);
  }

  private assertContextConsistency(
    context: Awaited<ReturnType<AiRepository['context']>>,
  ) {
    if (
      context.customer &&
      context.operation?.customerId &&
      context.operation.customerId !== context.customer.id
    )
      throw new ValidationException('Operation does not belong to customer');
    if (
      context.operation &&
      context.report?.operationId &&
      context.report.operationId !== context.operation.id
    )
      throw new ValidationException('Report does not belong to operation');
  }

  private authorizedContext(
    tools: Set<string>,
    context: Awaited<ReturnType<AiRepository['context']>>,
  ): JSONObject {
    return {
      customer: tools.has(AiContextTool.CUSTOMER_READ)
        ? (context.customer as unknown as JSONObject | null)
        : null,
      operation: tools.has(AiContextTool.OPERATION_READ)
        ? (context.operation as unknown as JSONObject | null)
        : null,
      report: tools.has(AiContextTool.REPORT_READ)
        ? (context.report as unknown as JSONObject | null)
        : null,
    };
  }

  private decrypt(encrypted: Uint8Array<ArrayBuffer> | null): JSONObject {
    if (!encrypted)
      throw new ValidationException('AI integration has no credentials');
    const parsed: unknown = JSON.parse(
      this.crypto.decrypt(new TextDecoder().decode(encrypted)),
    );
    return this.object(parsed);
  }

  private object(value: unknown): JSONObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as JSONObject;
  }

  private cost(
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    configuration: JSONObject,
  ) {
    const inputRate =
      typeof configuration.inputCostPerMillion === 'number'
        ? configuration.inputCostPerMillion
        : 0;
    const outputRate =
      typeof configuration.outputCostPerMillion === 'number'
        ? configuration.outputCostPerMillion
        : 0;
    return new Prisma.Decimal(
      (
        ((inputTokens ?? 0) * inputRate + (outputTokens ?? 0) * outputRate) /
        1_000_000
      ).toFixed(8),
    );
  }

  private async notify(
    organizationId: string,
    userId: string,
    executionId: string,
    succeeded: boolean,
  ) {
    try {
      await this.notifications.create(organizationId, {
        recipientUserId: userId,
        type: 'SYSTEM',
        channels: ['IN_APP', 'REALTIME'],
        title: succeeded ? 'Execução de IA concluída' : 'Execução de IA falhou',
        body: succeeded
          ? 'O resultado da execução está disponível.'
          : 'Não foi possível concluir a execução de IA.',
        payload: { executionId, status: succeeded ? 'SUCCEEDED' : 'FAILED' },
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          stage: 'ai-notification-failed',
          executionId,
          errorClass: error instanceof Error ? error.constructor.name : 'Error',
        }),
      );
    }
  }

  private mapConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new ConflictException('AI agent version already exists');
    throw error;
  }
}
