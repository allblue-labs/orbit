/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import { RlsTransaction } from '../../database';
import { DomainEventEmitter } from '../automations/domain-event.emitter';
import { OperationStateMachine } from '../operations/operation-state-machine';

export interface FieldTransitionInput {
  operationId: string;
  organizationId: string;
  actorId: string;
  expectedVersion: string;
  idempotencyKey: string;
  payloadHash: string;
  target: 'IN_PROGRESS' | 'COMPLETED';
}

@Injectable()
export class MobileFieldOperationRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly events: DomainEventEmitter,
  ) {}

  preparation(operationId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id: operationId, organizationId, deletedAt: null },
        include: {
          businessUnit: {
            select: {
              id: true,
              legalName: true,
              tradeName: true,
              timezone: true,
            },
          },
          customer: {
            select: {
              id: true,
              legalName: true,
              tradeName: true,
              address: true,
              contacts: {
                where: { deletedAt: null },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                take: 1,
                select: { name: true, phone: true, email: true },
              },
            },
          },
          /** Os equipamentos do atendimento, na ordem em que foram vinculados. */
          assets: {
            orderBy: { createdAt: 'asc' },
            select: {
              asset: {
                select: {
                  id: true,
                  identifier: true,
                  name: true,
                  category: true,
                  manufacturer: true,
                  model: true,
                  location: true,
                  status: true,
                  qrIdentities: {
                    where: { status: 'ACTIVE', revokedAt: null },
                    take: 1,
                    select: { id: true },
                  },
                },
              },
            },
          },
          customerAddress: {
            select: {
              id: true,
              label: true,
              street: true,
              number: true,
              complement: true,
              district: true,
              city: true,
              stateCode: true,
              postalCode: true,
              notes: true,
            },
          },
          responsibleFieldTechnician: {
            select: { id: true, displayName: true },
          },
          auxiliaryTechnicians: {
            where: { removedAt: null },
            orderBy: { assignedAt: 'asc' },
            select: { user: { select: { id: true, displayName: true } } },
          },
          startedBy: { select: { id: true, displayName: true } },
          completedBy: { select: { id: true, displayName: true } },
          checklistExecutions: {
            orderBy: { createdAt: 'asc' },
            include: { template: { select: { name: true } } },
          },
          artifactExecutions: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 10,
            select: {
              id: true,
              status: true,
              renderStatus: true,
              snapshot: { select: { artifactType: true } },
            },
          },
        },
      }),
    );
  }

  isFieldActor(
    organizationId: string,
    businessUnitId: string,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      const profile = await tx.professionalProfile.findFirst({
        where: {
          organizationId,
          userId: actorId,
          active: true,
          fieldTechnicianEnabled: true,
        },
        select: { id: true },
      });
      const membership = await tx.businessUnitMembership.findFirst({
        where: {
          organizationId,
          businessUnitId,
          userId: actorId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      return Boolean(profile && membership);
    });
  }

  async transition(input: FieldTransitionInput) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-operation:${input.operationId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-command:${input.organizationId}:${input.actorId}:${input.target}:${input.idempotencyKey}`}))`;
      const operation = await tx.operation.findFirst({
        where: {
          id: input.operationId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
        include: {
          responsibleFieldTechnician: {
            select: { id: true, displayName: true },
          },
          auxiliaryTechnicians: {
            where: { removedAt: null },
            select: { userId: true },
          },
          startedBy: { select: { id: true, displayName: true } },
          completedBy: { select: { id: true, displayName: true } },
          checklistExecutions: { select: { id: true, status: true } },
        },
      });
      if (!operation)
        throw new EntityNotFoundException('Operation', input.operationId);
      await this.assertFieldActor(
        tx,
        input.organizationId,
        operation.businessUnitId,
        input.actorId,
        operation,
      );
      const action =
        input.target === 'IN_PROGRESS'
          ? 'FIELD_OPERATION_STARTED'
          : 'FIELD_OPERATION_COMPLETED';
      const receipt = await this.receipt(
        tx,
        input.organizationId,
        input.operationId,
        input.actorId,
        action,
        input.idempotencyKey,
      );
      if (receipt) {
        if (receipt.payloadHash !== input.payloadHash)
          throw new ConflictException(
            'Idempotency key reused with a different payload',
          );
        return { operation, idempotentReplay: true };
      }
      if (operation.updatedAt.toISOString() !== input.expectedVersion)
        throw new ConflictException(
          'Versão desatualizada; recarregue o atendimento',
        );
      if (
        input.target === 'COMPLETED' &&
        operation.checklistExecutions.some(
          (item) => item.status === 'IN_PROGRESS',
        )
      ) {
        throw new ValidationException(
          'Conclua os checklists obrigatórios antes do atendimento',
        );
      }
      if (operation.status === input.target)
        return { operation, idempotentReplay: true };
      if (!OperationStateMachine.allows(operation.status, input.target))
        throw new ConflictException(
          `Transição de ${operation.status} para ${input.target} não permitida`,
        );
      const now = new Date();
      const changed = await tx.operation.updateMany({
        where: {
          id: operation.id,
          status: operation.status,
          updatedAt: operation.updatedAt,
          deletedAt: null,
        },
        data:
          input.target === 'IN_PROGRESS'
            ? {
                status: input.target,
                startedAt: operation.startedAt ?? now,
                startedByUserId: operation.startedByUserId ?? input.actorId,
              }
            : {
                status: input.target,
                completedAt: now,
                completedByUserId: input.actorId,
              },
      });
      if (changed.count !== 1)
        throw new ConflictException('Atendimento alterado concorrentemente');
      await tx.operationHistory.create({
        data: {
          operationId: operation.id,
          userId: input.actorId,
          action,
          fromStatus: operation.status,
          toStatus: input.target,
          details: {
            idempotencyKey: input.idempotencyKey,
            payloadHash: input.payloadHash,
          },
        },
      });
      const updated = await tx.operation.findUniqueOrThrow({
        where: { id: operation.id },
        include: {
          /** O evento de domínio publica os equipamentos tocados. */
          assets: { select: { assetId: true } },
          responsibleFieldTechnician: {
            select: { id: true, displayName: true },
          },
          auxiliaryTechnicians: {
            where: { removedAt: null },
            select: { userId: true },
          },
          startedBy: { select: { id: true, displayName: true } },
          completedBy: { select: { id: true, displayName: true } },
          checklistExecutions: { select: { id: true, status: true } },
        },
      });
      const base = {
        organizationId: updated.organizationId,
        businessUnitId: updated.businessUnitId,
        actorId: input.actorId,
        entityType: 'OPERATION' as const,
        entityId: updated.id,
      };
      const payload = {
        kind: updated.kind,
        status: updated.status,
        fromStatus: operation.status,
        priority: updated.priority,
        businessUnitId: updated.businessUnitId,
        customerId: updated.customerId,
        assetIds: updated.assets.map((link) => link.assetId),
        createdById: updated.createdById,
      };
      await this.events.emit(tx, {
        ...base,
        type: 'operation.status.changed',
        payload,
      });
      if (input.target === 'COMPLETED')
        await this.events.emit(tx, {
          ...base,
          type: 'operation.completed',
          payload,
        });
      return { operation: updated, idempotentReplay: false };
    });
  }

  addNote(input: {
    operationId: string;
    organizationId: string;
    actorId: string;
    expectedVersion: string;
    idempotencyKey: string;
    payloadHash: string;
    note: string;
    visibility: string;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-operation:${input.operationId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-command:${input.organizationId}:${input.actorId}:NOTE:${input.idempotencyKey}`}))`;
      const operation = await tx.operation.findFirst({
        where: {
          id: input.operationId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
        include: {
          auxiliaryTechnicians: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      });
      if (!operation)
        throw new EntityNotFoundException('Operation', input.operationId);
      await this.assertFieldActor(
        tx,
        input.organizationId,
        operation.businessUnitId,
        input.actorId,
        operation,
      );
      const receipt = await this.receipt(
        tx,
        input.organizationId,
        operation.id,
        input.actorId,
        'FIELD_NOTE_ADDED',
        input.idempotencyKey,
      );
      if (receipt) {
        if (receipt.payloadHash !== input.payloadHash)
          throw new ConflictException(
            'Idempotency key reused with a different payload',
          );
        return {
          version: operation.updatedAt.toISOString(),
          idempotentReplay: true,
        };
      }
      if (operation.updatedAt.toISOString() !== input.expectedVersion)
        throw new ConflictException(
          'Versão desatualizada; recarregue o atendimento',
        );
      if (operation.status !== 'IN_PROGRESS')
        throw new ConflictException(
          'Observações só podem ser adicionadas durante o atendimento',
        );
      const changed = await tx.operation.update({
        where: { id: operation.id },
        data: { updatedAt: new Date() },
        select: { updatedAt: true },
      });
      await tx.operationHistory.create({
        data: {
          operationId: operation.id,
          userId: input.actorId,
          action: 'FIELD_NOTE_ADDED',
          details: {
            idempotencyKey: input.idempotencyKey,
            payloadHash: input.payloadHash,
            note: input.note,
            visibility: input.visibility,
          },
        },
      });
      return {
        version: changed.updatedAt.toISOString(),
        idempotentReplay: false,
      };
    });
  }

  updateChecklist(input: {
    operationId: string;
    checklistId: string;
    organizationId: string;
    actorId: string;
    expectedVersion: string;
    idempotencyKey: string;
    payloadHash: string;
    answers: Record<string, unknown>;
    notes?: string;
    complete: boolean;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-checklist:${input.checklistId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`field-command:${input.organizationId}:${input.actorId}:CHECKLIST:${input.idempotencyKey}`}))`;
      const execution = await tx.checklistExecution.findFirst({
        where: {
          id: input.checklistId,
          organizationId: input.organizationId,
          operationId: input.operationId,
        },
        include: {
          operation: {
            include: {
              auxiliaryTechnicians: {
                where: { removedAt: null },
                select: { userId: true },
              },
            },
          },
        },
      });
      if (!execution?.operation)
        throw new EntityNotFoundException(
          'ChecklistExecution',
          input.checklistId,
        );
      await this.assertFieldActor(
        tx,
        input.organizationId,
        execution.businessUnitId,
        input.actorId,
        execution.operation,
      );
      const receipt = await this.receipt(
        tx,
        input.organizationId,
        input.operationId,
        input.actorId,
        'FIELD_CHECKLIST_UPDATED',
        input.idempotencyKey,
      );
      if (receipt) {
        if (receipt.payloadHash !== input.payloadHash)
          throw new ConflictException(
            'Idempotency key reused with a different payload',
          );
        return { execution, idempotentReplay: true };
      }
      if (execution.updatedAt.toISOString() !== input.expectedVersion)
        throw new ConflictException('Versão desatualizada do checklist');
      if (execution.status !== 'IN_PROGRESS')
        throw new ConflictException('Checklist não está em andamento');
      const snapshot = execution.templateSnapshot as any;
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      const allowed = new Set(items.map((item: any) => item.key));
      for (const key of Object.keys(input.answers))
        if (!allowed.has(key))
          throw new ValidationException(
            `Item de checklist desconhecido: ${key}`,
          );
      if (input.complete)
        for (const item of items)
          if (item.required && this.empty(input.answers[item.key]))
            throw new ValidationException(
              `Item obrigatório não respondido: ${item.key}`,
            );
      const answered = items.filter(
        (item: any) => !this.empty(input.answers[item.key]),
      ).length;
      const progress = items.length
        ? Math.round((answered / items.length) * 100)
        : 100;
      const updated = await tx.checklistExecution.update({
        where: { id: execution.id },
        data: {
          answers: input.answers as Prisma.InputJsonValue,
          notes: input.notes?.trim(),
          progress: input.complete ? 100 : progress,
          status: input.complete ? 'COMPLETED' : undefined,
          completedAt: input.complete ? new Date() : undefined,
        },
      });
      await tx.operationHistory.create({
        data: {
          operationId: input.operationId,
          userId: input.actorId,
          action: 'FIELD_CHECKLIST_UPDATED',
          details: {
            idempotencyKey: input.idempotencyKey,
            payloadHash: input.payloadHash,
            checklistExecutionId: execution.id,
            progress: updated.progress,
            completed: input.complete,
          },
        },
      });
      return { execution: updated, idempotentReplay: false };
    });
  }

  timeline(
    operationId: string,
    organizationId: string,
    limit: number,
    cursor?: { at: Date; id: string },
  ) {
    return this.rls.run((tx) =>
      tx.operationHistory.findMany({
        where: {
          operationId,
          operation: { organizationId, deletedAt: null },
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.at } },
                  { createdAt: cursor.at, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
  }

  materialByCommand(organizationId: string, commandId: string) {
    return this.rls.run((tx) =>
      tx.inventoryMovement.findFirst({
        where: {
          organizationId,
          source: 'OPERATION',
          sourceEntityId: commandId,
        },
        select: {
          id: true,
          operationId: true,
          catalogItemId: true,
          quantity: true,
          balanceAfter: true,
          reason: true,
          notes: true,
          createdById: true,
        },
      }),
    );
  }

  private async receipt(
    tx: any,
    organizationId: string,
    operationId: string,
    actorId: string,
    action: string,
    key: string,
  ): Promise<{ payloadHash: string } | null> {
    const value = await tx.operationHistory.findFirst({
      where: {
        operation: { organizationId },
        userId: actorId,
        action,
        details: { path: ['idempotencyKey'], equals: key },
      },
      orderBy: { createdAt: 'desc' },
      select: { operationId: true, details: true },
    });
    if (!value) return null;
    const details = value.details as {
      idempotencyKey?: unknown;
      payloadHash?: unknown;
    } | null;
    if (value.operationId !== operationId)
      throw new ConflictException(
        'Idempotency key already used by another operation',
      );
    if (
      details?.idempotencyKey === key &&
      typeof details.payloadHash === 'string'
    ) {
      return { payloadHash: details.payloadHash };
    }
    return null;
  }

  private async assertFieldActor(
    tx: any,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    operation: any,
  ): Promise<void> {
    const assigned =
      operation.responsibleFieldTechnicianId === actorId ||
      operation.auxiliaryTechnicians.some(
        (item: any) => item.userId === actorId,
      );
    if (!assigned)
      throw new ForbiddenException('Atendimento exige atribuição ativa');
    const profile = await tx.professionalProfile.findFirst({
      where: {
        organizationId,
        userId: actorId,
        active: true,
        fieldTechnicianEnabled: true,
      },
      select: { id: true },
    });
    const membership = await tx.businessUnitMembership.findFirst({
      where: {
        organizationId,
        businessUnitId,
        userId: actorId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!profile || !membership)
      throw new ForbiddenException(
        'Perfil de Técnico em Campo ativo é obrigatório',
      );
  }

  private empty(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }
}
