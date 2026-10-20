import { HttpException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import type { MobileFieldActor } from './mobile-field.service';
import { MobileFieldService } from './mobile-field.service';
import { MobileFieldOperationService } from './mobile-field-operation.service';
import { MobileSignatureService } from './mobile-signature.service';
import type { CustomerAcknowledgementInputDto } from './mobile-signature.dto';
import type {
  FieldOperationChecklistUpdateDto,
  FieldOperationMaterialDto,
  FieldOperationNoteDto,
} from './mobile-field-operation.dto';
import type { OfflineCommandEnvelopeDto } from './mobile-offline-sync.dto';
import type {
  FieldPackageReadModel,
  MobileSyncPullResponseReadModel,
  MobileSyncPushResponseReadModel,
  OfflineConflictCode,
  OfflineCommandResultReadModel,
} from './mobile-offline-sync.read-models';
import { MobileOfflineSyncRepository } from './mobile-offline-sync.repository';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES } from '../jobs/background-job.types';
import { replayCutoff } from './mobile-sync-retention';

@Injectable()
export class MobileOfflineSyncService {
  private readonly logger = new Logger(MobileOfflineSyncService.name);
  constructor(
    private readonly repository: MobileOfflineSyncRepository,
    private readonly field: MobileFieldService,
    private readonly operations: MobileFieldOperationService,
    private readonly signatures: MobileSignatureService,
    private readonly jobs: BackgroundJobQueue,
  ) {}

  async package(
    actor: MobileFieldActor,
    workItemId: string,
  ): Promise<FieldPackageReadModel> {
    const context = await this.field.fieldContext(actor, workItemId);
    const item = context.workItem;
    const operation =
      item.kind === 'SERVICE_OPERATION'
        ? await this.operations.preparation(actor, item.sourceId)
        : null;
    const pmocSource =
      item.kind === 'PMOC'
        ? await this.repository.pmocPackage(
            actor.organizationId,
            item.sourceId,
            item.navigationContext.equipmentId,
          )
        : null;
    const rvtSource =
      item.kind === 'RVT'
        ? await this.repository.rvtPackage(actor.organizationId, item.sourceId)
        : null;
    const bounds = await this.repository.journalBounds(
      actor.organizationId,
      actor.businessUnitIds,
    );
    const generatedAt = new Date();
    return {
      packageId: this.hash({
        actorId: actor.id,
        workItemId,
        version: item.updatedAt,
        generatedAt: generatedAt.toISOString(),
      }),
      generatedAt: generatedAt.toISOString(),
      expiresAt: null,
      serverCheckpoint: this.cursor(bounds.latest?.sequence ?? 0n),
      kind: item.kind === 'SERVICE_OPERATION' ? 'OPERATION' : item.kind,
      workItem: item,
      context,
      operation,
      pmoc: pmocSource
        ? {
            cycle: {
              id: pmocSource.id,
              status: pmocSource.status,
              dueOn: pmocSource.dueOn.toISOString().slice(0, 10),
              version: pmocSource.updatedAt.toISOString(),
            },
            equipmentExecution: pmocSource.equipmentExecutions[0]
              ? {
                  id: pmocSource.equipmentExecutions[0].id,
                  status: pmocSource.equipmentExecutions[0].status,
                  procedureSnapshot:
                    pmocSource.equipmentExecutions[0].procedureSnapshot,
                  responsible: {
                    id: pmocSource.equipmentExecutions[0]
                      .responsibleFieldTechnician.id,
                    name: pmocSource.equipmentExecutions[0]
                      .responsibleFieldTechnician.displayName,
                  },
                }
              : null,
            procedure: pmocSource.plan.procedure,
            technicalResponsible: {
              required: Boolean(pmocSource.plan.technicalResponsibleUserId),
              userId: pmocSource.plan.technicalResponsibleUserId,
            },
            evidencePolicy: {
              acceptedKinds: ['PHOTO', 'VIDEO', 'DOCUMENT'] as const,
              blobsIncluded: false as const,
            },
          }
        : null,
      rvt: rvtSource
        ? {
            occurrence: {
              id: rvtSource.id,
              status: rvtSource.status,
              scheduledFor: rvtSource.scheduledFor?.toISOString() ?? null,
              version: rvtSource.updatedAt.toISOString(),
            },
            execution: rvtSource.execution
              ? {
                  id: rvtSource.execution.id,
                  status: rvtSource.execution.status,
                  procedureSnapshot: rvtSource.execution.procedureSnapshot,
                  responsible: {
                    id: rvtSource.execution.responsibleFieldTechnicianId,
                    name:
                      item.responsibleFieldTechnician?.name ??
                      'Técnico em campo',
                  },
                }
              : null,
            procedure: rvtSource.configuration.procedure,
            technicalResponsible: {
              required: rvtSource.configuration.requiresTechnicalResponsible,
              userId: rvtSource.configuration.technicalResponsibleUserId,
            },
            customerAcknowledgementPolicy: {
              allowed: true as const,
              signatureOptional: true as const,
            },
            evidencePolicy: {
              acceptedKinds: ['PHOTO', 'VIDEO', 'DOCUMENT'] as const,
              blobsIncluded: false as const,
            },
          }
        : null,
      allowedActionsAtGeneration:
        operation?.allowedActions ?? item.allowedActions,
      versionTokens: {
        workItem: item.updatedAt,
        ...(operation ? { operation: operation.version } : {}),
        ...(item.navigationContext.executionId
          ? { execution: item.updatedAt }
          : {}),
      },
      cachePolicy: {
        sensitive: true,
        purgeOnLogout: true,
        authoritative: false,
      },
      mediaPolicy: {
        blobsIncluded: false,
        localMediaReferencesAccepted: false,
      },
    };
  }

  async packages(actor: MobileFieldActor, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    return {
      packages: await Promise.all(unique.map((id) => this.package(actor, id))),
    };
  }

  async push(
    actor: MobileFieldActor,
    commands: readonly OfflineCommandEnvelopeDto[],
  ): Promise<MobileSyncPushResponseReadModel> {
    await this.ensureCleanup(actor);
    const results: OfflineCommandResultReadModel[] = [];
    const blocked = new Set<string>();
    const replayActor: MobileFieldActor = {
      ...actor,
      permissions: await this.repository.currentPermissions(
        actor.organizationId,
        actor.id,
        actor.businessUnitIds,
      ),
    };
    const scopes = new Map(
      (
        await this.repository.operationScopes(
          actor.organizationId,
          actor.id,
          actor.businessUnitIds,
          commands.map((command) => command.aggregateId),
        )
      ).map((scope) => [scope.id, scope.businessUnitId]),
    );
    for (const command of commands) {
      const result = await this.process(
        replayActor,
        command,
        blocked.has(`${command.aggregateType}:${command.aggregateId}`),
        scopes.get(command.aggregateId),
      );
      results.push(result);
      if (result.status === 'CONFLICT' || result.status === 'REJECTED')
        blocked.add(`${command.aggregateType}:${command.aggregateId}`);
    }
    return {
      results,
      serverTime: new Date().toISOString(),
      nextRecommendedAction: 'PULL',
    };
  }

  async pull(
    actor: MobileFieldActor,
    encodedCursor?: string,
    knownIds: readonly string[] = [],
  ): Promise<MobileSyncPullResponseReadModel> {
    const items = await this.field.offlineItems(actor);
    const visible = new Map(items.map((item) => [item.id, item]));
    const tombstones = [...new Set(knownIds)]
      .filter((id) => !visible.has(id))
      .map((resourceId) => ({ resourceId, reason: 'OUT_OF_SCOPE' as const }));
    const bounds = await this.repository.journalBounds(
      actor.organizationId,
      actor.businessUnitIds,
    );
    const parsedCursor = encodedCursor
      ? this.parseCursor(encodedCursor)
      : {
          kind: 'INITIAL' as const,
          afterId: null,
          baseline: bounds.latest?.sequence ?? 0n,
        };
    if (parsedCursor.kind === 'INITIAL') {
      const start = parsedCursor.afterId
        ? items.findIndex((item) => item.id === parsedCursor.afterId) + 1
        : 0;
      if (parsedCursor.afterId && start === 0) {
        return {
          status: 'FULL_RESYNC_REQUIRED',
          changes: [],
          tombstones: [],
          nextCursor: null,
          hasMore: false,
          purgeRequired: false,
        };
      }
      const page = items.slice(start, start + 501);
      const visiblePage = page.slice(0, 500);
      const hasMore = page.length > 500;
      const last = visiblePage.at(-1);
      return {
        status: 'DELTA',
        changes: visiblePage.map((item, index) => ({
          sequence: `initial:${start + index}`,
          resourceType: 'WORK_ITEM',
          resourceId: item.id,
          changeType: 'UPSERTED' as const,
          version: item.updatedAt,
          snapshot: item,
        })),
        tombstones,
        nextCursor:
          hasMore && last
            ? this.initialCursor(last.id, parsedCursor.baseline)
            : this.cursor(parsedCursor.baseline),
        hasMore,
        purgeRequired: false,
      };
    }
    const after = parsedCursor.sequence;
    if (bounds.oldest && after > 0n && after + 1n < bounds.oldest.sequence) {
      return {
        status: 'FULL_RESYNC_REQUIRED',
        changes: [],
        tombstones: [],
        nextCursor: null,
        hasMore: false,
        purgeRequired: false,
      };
    }
    const rows = await this.repository.journal(
      actor.organizationId,
      actor.businessUnitIds,
      after,
      100,
    );
    const hasMore = rows.length > 100;
    const page = rows.slice(0, 100);
    const known = new Set(knownIds);
    const changes = page.flatMap((row) => {
      const snapshot = visible.get(row.resourceId) ?? null;
      // An invisible journal row cannot disclose a resource id that this
      // actor never cached. Known ids may safely receive an OUT_OF_SCOPE hint.
      if (!snapshot && !known.has(row.resourceId)) return [];
      return [
        {
          sequence: row.sequence.toString(),
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          changeType: snapshot
            ? ('UPSERTED' as const)
            : ('OUT_OF_SCOPE' as const),
          version: snapshot?.updatedAt ?? row.resourceVersion,
          snapshot,
        },
      ];
    });
    const last = page.at(-1)?.sequence ?? after;
    return {
      status: 'DELTA',
      changes,
      tombstones,
      nextCursor: this.cursor(last),
      hasMore,
      purgeRequired: false,
    };
  }

  private async process(
    actor: MobileFieldActor,
    command: OfflineCommandEnvelopeDto,
    blocked: boolean,
    businessUnitId?: string,
  ): Promise<OfflineCommandResultReadModel> {
    const payloadHash = this.hash({
      commandType: command.commandType,
      aggregateType: command.aggregateType,
      aggregateId: command.aggregateId,
      expectedVersion: command.expectedVersion,
      occurredAt: command.occurredAt.toISOString(),
      payload: command.payload,
    });
    const existing = await this.repository.findReceipt(
      actor.organizationId,
      actor.id,
      command.commandId,
      command.idempotencyKey,
    );
    if (existing) {
      if (
        existing.payloadHash !== payloadHash ||
        existing.commandType !== command.commandType ||
        existing.aggregateId !== command.aggregateId
      )
        return this.conflict(
          command,
          'IDEMPOTENCY_MISMATCH',
          'A chave de idempotência já foi usada com outro conteúdo.',
        );
      return {
        ...(existing.result as unknown as OfflineCommandResultReadModel),
        status: 'ALREADY_APPLIED',
      };
    }
    if (command.occurredAt < replayCutoff()) {
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        status: 'REJECTED',
        serverVersion: null,
        authoritativeResourceRef: null,
        conflict: null,
        error: {
          code: 'OFFLINE_REPLAY_WINDOW_EXPIRED',
          message:
            'O comando excedeu a janela offline suportada. Atualize os dados antes de tentar novamente.',
          retryable: false,
        },
      };
    }
    if (blocked)
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        status: 'BLOCKED',
        serverVersion: null,
        authoritativeResourceRef: null,
        conflict: null,
        error: {
          code: 'DEPENDENCY_BLOCKED',
          message: 'Comando anterior do mesmo atendimento não foi aplicado.',
          retryable: false,
        },
      };
    try {
      if (!businessUnitId)
        throw new EntityNotFoundException('Operation', command.aggregateId);
      const value = await this.dispatch(actor, command);
      const serverVersion = this.serverVersion(value);
      const result: OfflineCommandResultReadModel = {
        commandId: command.commandId,
        commandType: command.commandType,
        status: 'APPLIED',
        serverVersion,
        authoritativeResourceRef: `SERVICE_OPERATION:${command.aggregateId}`,
        conflict: null,
        error: null,
      };
      const persisted = await this.repository.persistApplied({
        organizationId: actor.organizationId,
        businessUnitId,
        actorId: actor.id,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandType: command.commandType,
        aggregateType: command.aggregateType,
        aggregateId: command.aggregateId,
        deviceInstanceId: command.deviceInstanceId,
        payloadHash,
        result: result as unknown as Record<string, unknown>,
        serverVersion: serverVersion ?? undefined,
        occurredAt: command.occurredAt,
        resourceId: `SERVICE_OPERATION:${command.aggregateId}`,
      });
      this.logger.log(
        JSON.stringify({
          metric: 'mobile_sync_commands_applied_total',
          commandType: command.commandType,
          result: persisted.alreadyApplied ? 'ALREADY_APPLIED' : 'APPLIED',
        }),
      );
      return persisted.alreadyApplied
        ? { ...result, status: 'ALREADY_APPLIED' }
        : result;
    } catch (error) {
      return this.failure(command, error);
    }
  }

  private dispatch(
    actor: MobileFieldActor,
    command: OfflineCommandEnvelopeDto,
  ): Promise<unknown> {
    const base = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      expectedVersion: command.expectedVersion,
      occurredAt: command.occurredAt,
    };
    switch (command.commandType) {
      case 'OPERATION_START':
        this.assertKeys(command.payload, []);
        return this.operations.start(actor, command.aggregateId, base);
      case 'OPERATION_COMPLETE':
        this.assertKeys(command.payload, []);
        return this.operations.complete(actor, command.aggregateId, base);
      case 'OPERATION_ADD_NOTE':
        this.assertString(command.payload, 'note');
        return this.operations.addNote(actor, command.aggregateId, {
          ...base,
          note: command.payload.note,
          visibility: command.payload.visibility,
        } as FieldOperationNoteDto);
      case 'OPERATION_CHECKLIST_UPDATE':
        this.assertString(command.payload, 'checklistId');
        if (
          !command.payload.answers ||
          typeof command.payload.answers !== 'object' ||
          Array.isArray(command.payload.answers)
        )
          throw new ValidationException(
            'Respostas do checklist são obrigatórias',
          );
        return this.operations.updateChecklist(
          actor,
          command.aggregateId,
          command.payload.checklistId as string,
          {
            ...base,
            answers: command.payload.answers,
            notes: command.payload.notes,
            complete: command.payload.complete,
          } as FieldOperationChecklistUpdateDto,
        );
      case 'OPERATION_ADD_MATERIAL':
        this.assertString(command.payload, 'catalogItemId');
        if (
          typeof command.payload.quantity !== 'number' ||
          command.payload.quantity <= 0
        )
          throw new ValidationException('Quantidade de material inválida');
        return this.operations.registerMaterial(actor, command.aggregateId, {
          ...base,
          catalogItemId: command.payload.catalogItemId,
          quantity: command.payload.quantity,
          reason: command.payload.reason,
          notes: command.payload.notes,
        } as FieldOperationMaterialDto);
      case 'CUSTOMER_ACKNOWLEDGEMENT':
        this.assertString(command.payload, 'signerName');
        this.assertString(command.payload, 'contentHash');
        return this.signatures.acknowledge(actor, command.aggregateId, {
          signerName: command.payload.signerName,
          signatureStorageFileId: command.payload.signatureStorageFileId,
          contactId: command.payload.contactId,
          expectedVersion: command.expectedVersion,
          contentHash: command.payload.contentHash,
          commandId: command.commandId,
          occurredAt: command.occurredAt,
        } as CustomerAcknowledgementInputDto);
      default:
        throw new ValidationException('Tipo de comando offline não suportado');
    }
  }

  private failure(
    command: OfflineCommandEnvelopeDto,
    error: unknown,
  ): OfflineCommandResultReadModel {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message =
      error instanceof Error ? error.message : 'Falha ao processar o comando';
    if (status === 409) {
      const code: OfflineConflictCode =
        command.commandType === 'CUSTOMER_ACKNOWLEDGEMENT'
          ? 'ACKNOWLEDGEMENT_STALE'
          : command.commandType === 'OPERATION_CHECKLIST_UPDATE'
            ? 'CHECKLIST_CHANGED'
            : message.toLowerCase().includes('estoque')
              ? 'MATERIAL_STOCK_CONFLICT'
              : message.toLowerCase().includes('versão')
                ? 'VERSION_CONFLICT'
                : 'STATE_CONFLICT';
      return this.conflict(command, code, message);
    }
    const rejected = status >= 400 && status < 500;
    return {
      commandId: command.commandId,
      commandType: command.commandType,
      status: rejected ? 'REJECTED' : 'RETRYABLE_ERROR',
      serverVersion: null,
      authoritativeResourceRef: null,
      conflict: null,
      error: {
        code:
          status === 404
            ? 'RESOURCE_REMOVED'
            : status === 403
              ? 'AUTHORIZATION_CHANGED'
              : status === 400
                ? 'INVALID_COMMAND'
                : 'PROCESSING_ERROR',
        message: rejected
          ? message
          : 'Falha temporária ao processar o comando.',
        retryable: !rejected,
      },
    };
  }

  private conflict(
    command: OfflineCommandEnvelopeDto,
    code: OfflineConflictCode,
    message: string,
  ): OfflineCommandResultReadModel {
    return {
      commandId: command.commandId,
      commandType: command.commandType,
      status: 'CONFLICT',
      serverVersion: null,
      authoritativeResourceRef: null,
      conflict: { code, message, refreshRequired: true },
      error: null,
    };
  }
  private serverVersion(value: unknown): string | null {
    return value &&
      typeof value === 'object' &&
      'version' in value &&
      typeof value.version === 'string'
      ? value.version
      : null;
  }
  private assertString(
    payload: Record<string, unknown>,
    key: string,
  ): asserts payload is Record<string, unknown> & Record<typeof key, string> {
    if (typeof payload[key] !== 'string' || !payload[key])
      throw new ValidationException(`Campo ${key} é obrigatório`);
  }
  private assertKeys(
    payload: Record<string, unknown>,
    allowed: readonly string[],
  ) {
    if (Object.keys(payload).some((key) => !allowed.includes(key)))
      throw new ValidationException('Payload não permitido para este comando');
  }
  private hash(value: unknown): string {
    return createHash('sha256').update(this.canonical(value)).digest('hex');
  }
  private canonical(value: unknown): string {
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${this.canonical(item)}`)
      .join(',')}}`;
  }
  private cursor(sequence: bigint): string {
    return Buffer.from(
      JSON.stringify({ v: 1, sequence: sequence.toString() }),
    ).toString('base64url');
  }
  private initialCursor(afterId: string, baseline: bigint): string {
    return Buffer.from(
      JSON.stringify({ v: 2, afterId, baseline: baseline.toString() }),
    ).toString('base64url');
  }
  private parseCursor(
    value: string,
  ):
    | { kind: 'JOURNAL'; sequence: bigint }
    | { kind: 'INITIAL'; afterId: string; baseline: bigint } {
    try {
      const decoded = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as {
        v?: unknown;
        sequence?: unknown;
        afterId?: unknown;
        baseline?: unknown;
      };
      if (
        decoded.v === 1 &&
        typeof decoded.sequence === 'string' &&
        /^\d+$/.test(decoded.sequence)
      ) {
        return { kind: 'JOURNAL', sequence: BigInt(decoded.sequence) };
      }
      if (
        decoded.v === 2 &&
        typeof decoded.afterId === 'string' &&
        decoded.afterId.length <= 160 &&
        typeof decoded.baseline === 'string' &&
        /^\d+$/.test(decoded.baseline)
      ) {
        return {
          kind: 'INITIAL',
          afterId: decoded.afterId,
          baseline: BigInt(decoded.baseline),
        };
      }
      throw new Error();
    } catch {
      throw new ConflictException('Cursor de sincronização inválido');
    }
  }

  private async ensureCleanup(actor: MobileFieldActor): Promise<void> {
    if (!actor.businessUnitIds.length) return;
    const day = new Date().toISOString().slice(0, 10);
    await this.jobs.enqueue({
      queue: JOB_QUEUES.mobileSyncCleanup,
      jobKey: `mobile-sync-cleanup:${actor.id}:${day}`,
      organizationId: actor.organizationId,
      scope: 'ORGANIZATION',
      businessUnitIds: actor.businessUnitIds,
      payload: {},
      correlationId: `mobile-sync-cleanup:${day}`,
      actorUserId: actor.id,
      maxAttempts: 3,
    });
  }
}
