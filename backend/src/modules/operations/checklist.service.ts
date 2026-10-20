import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import type {
  ChecklistItemDto,
  ChecklistTemplateQueryDto,
  CreateChecklistTemplateDto,
  SaveChecklistAnswersDto,
  StartChecklistExecutionDto,
  UpdateChecklistTemplateDto,
  ChecklistExecutionQueryDto,
} from './checklist.dto';
import { ChecklistExecutionStatus, ChecklistItemType } from './checklist.dto';
import { ChecklistRepository } from './checklist.repository';
import { OperationRepository } from './operation.repository';

@Injectable()
export class ChecklistService {
  constructor(
    private readonly repository: ChecklistRepository,
    private readonly operations: OperationRepository,
  ) {}

  listTemplates(organizationId: string, query: ChecklistTemplateQueryDto) {
    return this.repository.listTemplates(organizationId, query);
  }

  async getTemplate(id: string, organizationId: string) {
    const template = await this.repository.findTemplate(id, organizationId);
    if (!template) throw new EntityNotFoundException('Checklist template', id);
    return template;
  }

  createTemplate(organizationId: string, input: CreateChecklistTemplateDto) {
    const items = this.validateItems(input.items);
    return this.repository.createTemplate(organizationId, {
      key: input.key.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim(),
      operationKind: input.operationKind,
      items: items as unknown as Prisma.InputJsonValue,
      isActive: input.isActive ?? true,
    });
  }

  async updateTemplate(
    id: string,
    organizationId: string,
    input: UpdateChecklistTemplateDto,
  ) {
    const current = await this.getTemplate(id, organizationId);
    if (input.items || (input.key && input.key !== current.key)) {
      const currentItems = current.items as unknown as ChecklistItemDto[];
      return this.repository.createTemplate(organizationId, {
        key: (input.key ?? current.key).trim().toUpperCase(),
        name: input.name?.trim() ?? current.name,
        description: input.description?.trim() ?? current.description,
        /// A nova versão herda o vínculo, salvo quando o pedido o troca.
        operationKind: input.operationKind ?? current.operationKind,
        items: this.validateItems(
          input.items ?? currentItems,
        ) as unknown as Prisma.InputJsonValue,
        isActive: input.isActive ?? current.isActive,
      });
    }
    return this.repository.updateTemplate(id, {
      name: input.name?.trim(),
      description: input.description?.trim(),
      operationKind: input.operationKind,
      isActive: input.isActive,
    });
  }

  async removeTemplate(id: string, organizationId: string) {
    await this.getTemplate(id, organizationId);
    await this.repository.deleteTemplate(id);
  }

  listExecutions(organizationId: string, query: ChecklistExecutionQueryDto) {
    return this.repository.listExecutions(organizationId, query);
  }

  async getExecution(id: string, organizationId: string) {
    const execution = await this.repository.findExecution(id, organizationId);
    if (!execution)
      throw new EntityNotFoundException('Checklist execution', id);
    return execution;
  }

  async start(
    operationId: string,
    organizationId: string,
    actorId: string,
    input: StartChecklistExecutionDto,
  ) {
    const [operation, template] = await Promise.all([
      this.operations.find(operationId, organizationId),
      this.repository.findTemplate(input.templateId, organizationId),
    ]);
    if (!operation) throw new EntityNotFoundException('Operation', operationId);
    if (!template || !template.isActive) {
      throw new ValidationException('Active checklist template is required');
    }
    return this.repository.createExecution(
      {
        organizationId,
        businessUnitId: operation.businessUnitId,
        templateId: template.id,
        operationId,
        createdById: actorId,
        templateVersion: template.version,
        /**
         * O snapshot é o que a execução responde — e o que o documento cita.
         *
         * Os itens extras entram aqui, ao lado dos herdados, e o modelo do
         * dono da organização segue intacto: um atendimento que pediu uma
         * verificação a mais não reescreve o padrão dos próximos.
         */
        templateSnapshot: {
          key: template.key,
          name: template.name,
          version: template.version,
          items: [
            ...(template.items as Prisma.InputJsonValue[]),
            ...((input.additionalItems ??
              []) as unknown as Prisma.InputJsonValue[]),
          ],
        },
        notes: input.notes?.trim(),
      },
      actorId,
    );
  }

  async save(
    id: string,
    organizationId: string,
    actorId: string,
    input: SaveChecklistAnswersDto,
  ) {
    const execution = await this.getExecution(id, organizationId);
    if (execution.status !== ChecklistExecutionStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Only an in-progress checklist can be edited',
      );
    }
    const items = this.snapshotItems(execution.templateSnapshot);
    this.validateAnswers(items, input.answers, false);
    const progress = this.progress(items, input.answers);
    return this.repository.updateExecution(
      id,
      {
        answers: input.answers as Prisma.InputJsonValue,
        notes: input.notes?.trim(),
        progress,
      },
      actorId,
      'CHECKLIST_UPDATED',
      execution.operationId,
    );
  }

  async complete(id: string, organizationId: string, actorId: string) {
    const execution = await this.getExecution(id, organizationId);
    if (execution.status !== ChecklistExecutionStatus.IN_PROGRESS) {
      throw new ConflictException('Checklist is no longer in progress');
    }
    const items = this.snapshotItems(execution.templateSnapshot);
    const answers = execution.answers as Record<string, unknown>;
    this.validateAnswers(items, answers, true);
    return this.repository.updateExecution(
      id,
      {
        status: ChecklistExecutionStatus.COMPLETED,
        progress: 100,
        completedAt: new Date(),
      },
      actorId,
      'CHECKLIST_COMPLETED',
      execution.operationId,
    );
  }

  async cancel(id: string, organizationId: string, actorId: string) {
    const execution = await this.getExecution(id, organizationId);
    if (execution.status !== ChecklistExecutionStatus.IN_PROGRESS) {
      throw new ConflictException('Checklist is no longer in progress');
    }
    return this.repository.updateExecution(
      id,
      { status: ChecklistExecutionStatus.CANCELLED },
      actorId,
      'CHECKLIST_CANCELLED',
      execution.operationId,
    );
  }

  private validateItems(items: ChecklistItemDto[]): ChecklistItemDto[] {
    const keys = new Set<string>();
    return items.map((item) => {
      const key = item.key.trim().toLowerCase();
      if (keys.has(key))
        throw new ValidationException(`Duplicate item key: ${key}`);
      keys.add(key);
      if (item.type === ChecklistItemType.SELECT && !item.options?.length) {
        throw new ValidationException(`Select item ${key} requires options`);
      }
      return {
        ...item,
        key,
        label: item.label.trim(),
        required: item.required ?? false,
      };
    });
  }

  private snapshotItems(snapshot: unknown): ChecklistItemDto[] {
    const value = snapshot as { items?: ChecklistItemDto[] };
    if (!Array.isArray(value?.items)) {
      throw new ValidationException('Invalid checklist snapshot');
    }
    return value.items;
  }

  private validateAnswers(
    items: ChecklistItemDto[],
    answers: Record<string, unknown>,
    requireAll: boolean,
  ) {
    const allowed = new Set(items.map((item) => item.key));
    for (const key of Object.keys(answers)) {
      if (!allowed.has(key))
        throw new ValidationException(`Unknown answer key: ${key}`);
    }
    for (const item of items) {
      const answer = answers[item.key];
      if (requireAll && item.required && this.empty(answer)) {
        throw new ValidationException(
          `Required checklist item is unanswered: ${item.key}`,
        );
      }
      if (this.empty(answer)) continue;
      if (
        item.type === ChecklistItemType.BOOLEAN &&
        typeof answer !== 'boolean'
      )
        throw new ValidationException(`${item.key} must be boolean`);
      if (item.type === ChecklistItemType.NUMBER && typeof answer !== 'number')
        throw new ValidationException(`${item.key} must be a number`);
      if (
        item.type === ChecklistItemType.SELECT &&
        (typeof answer !== 'string' || !item.options?.includes(answer))
      )
        throw new ValidationException(`${item.key} has an invalid option`);
      if (
        (item.type === ChecklistItemType.TEXT ||
          item.type === ChecklistItemType.PHOTO ||
          item.type === ChecklistItemType.SIGNATURE) &&
        typeof answer !== 'string'
      )
        throw new ValidationException(`${item.key} must be text`);
    }
  }

  private progress(
    items: ChecklistItemDto[],
    answers: Record<string, unknown>,
  ) {
    if (!items.length) return 0;
    const answered = items.filter(
      (item) => !this.empty(answers[item.key]),
    ).length;
    return Math.round((answered / items.length) * 100);
  }

  private empty(value: unknown) {
    return value === undefined || value === null || value === '';
  }
}
