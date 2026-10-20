/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import { ArtifactRenderService } from '../artifact-rendering/artifact-render.service';
import { WorkforceService } from '../workforce/workforce.service';
import type {
  CreateAdHocRvtDto,
  CreateRvtConfigurationDto,
  RvtConfigurationQueryDto,
  RvtOccurrenceQueryDto,
  RvtTimelineQueryDto,
  StartRvtExecutionDto,
  UpdateRvtConfigurationDto,
  UpdateRvtExecutionDto,
  CreateRvtMaintenanceTypeDto,
  UpdateRvtMaintenanceTypeDto,
} from './rvt.dto';
import { generateRvtOccurrences } from './rvt.domain';
import {
  civilDateKey,
  instantFromCivilDate,
} from '../scheduling/scheduling-time';
import { RvtMapper } from './rvt.mapper';
import { RvtRepository } from './rvt.repository';

export interface RvtActor {
  organizationId: string;
  actorId: string;
  businessUnitIds: readonly string[];
  permissions: readonly string[];
}

@Injectable()
export class RvtService {
  constructor(
    private readonly repository: RvtRepository,
    private readonly mapper: RvtMapper,
    private readonly workforce: WorkforceService,
    private readonly rendering: ArtifactRenderService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Tipos de manutenção                                               */
  /* ---------------------------------------------------------------- */

  async listMaintenanceTypes(actor: RvtActor, onlyActive = true) {
    const tipos = await this.repository.listMaintenanceTypes(
      actor.organizationId,
      onlyActive,
    );
    return tipos.map((tipo) => this.mapper.maintenanceType(tipo));
  }

  async createMaintenanceType(
    actor: RvtActor,
    input: CreateRvtMaintenanceTypeDto,
  ) {
    this.assertCadence(input.intervalDays, input.intervalMonths);
    await this.requireChecklistTemplate(
      actor.organizationId,
      input.checklistTemplateId,
    );
    const tipo = await this.repository.createMaintenanceType({
      organizationId: actor.organizationId,
      key: input.key.toUpperCase(),
      label: input.label,
      intervalDays: input.intervalDays,
      intervalMonths: input.intervalMonths,
      checklistTemplateId: input.checklistTemplateId,
      sortOrder: input.sortOrder,
    });
    return this.mapper.maintenanceType(tipo);
  }

  async updateMaintenanceType(
    actor: RvtActor,
    id: string,
    input: UpdateRvtMaintenanceTypeDto,
  ) {
    const atual = await this.repository.findMaintenanceType(
      id,
      actor.organizationId,
    );
    if (!atual) throw new EntityNotFoundException('RvtMaintenanceType', id);

    /**
     * Mexeu na cadência? Então ela é substituída inteira.
     *
     * Mesclar campo a campo com o que está gravado faria o tipo trimestral que
     * recebe `intervalDays: 90` ficar com mês **e** dia preenchidos — recusado
     * por `assertCadence`, e por um motivo que o usuário não teria como
     * adivinhar. Quando o cliente toca em qualquer um dos dois, o par inteiro
     * passa a ser o que ele mandou, e o que ele não mandou vira nulo.
     */
    const mexeuNaCadencia =
      input.intervalDays !== undefined || input.intervalMonths !== undefined;
    const dias = mexeuNaCadencia
      ? (input.intervalDays ?? null)
      : atual.intervalDays;
    const meses = mexeuNaCadencia
      ? (input.intervalMonths ?? null)
      : atual.intervalMonths;
    this.assertCadence(dias ?? undefined, meses ?? undefined);
    await this.requireChecklistTemplate(
      actor.organizationId,
      input.checklistTemplateId ?? undefined,
    );

    const tipo = await this.repository.updateMaintenanceType(id, {
      label: input.label,
      ...(mexeuNaCadencia ? { intervalDays: dias, intervalMonths: meses } : {}),
      checklistTemplateId: input.checklistTemplateId,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    });
    return this.mapper.maintenanceType(tipo);
  }

  async removeMaintenanceType(actor: RvtActor, id: string) {
    const atual = await this.repository.findMaintenanceType(
      id,
      actor.organizationId,
    );
    if (!atual) throw new EntityNotFoundException('RvtMaintenanceType', id);

    /**
     * Um tipo em uso não sai.
     *
     * Contratos ativos apontam para ele e é dele que sai a cadência das
     * próximas visitas; removê-lo deixaria o contrato sem ritmo e a próxima
     * atualização de cobertura sem como recalcular as ocorrências.
     */
    const emUso = await this.repository.countConfigurationsByMaintenanceType(
      id,
      actor.organizationId,
    );
    if (emUso > 0) {
      throw new ValidationException(
        `This maintenance type is used by ${emUso} RVT contract(s)`,
      );
    }
    await this.repository.softDeleteMaintenanceType(id);
  }

  /** Dias **ou** meses, nunca os dois nem nenhum. */
  private assertCadence(intervalDays?: number, intervalMonths?: number) {
    const dias = intervalDays ?? 0;
    const meses = intervalMonths ?? 0;
    if (dias > 0 === meses > 0) {
      throw new ValidationException(
        'A maintenance type must define either a day or a month interval',
      );
    }
  }

  /**
   * O roteiro informado existe nesta organização?
   *
   * A FK não conhece inquilino: um id de outra conta seria aceito pelo banco e
   * o técnico receberia em campo o roteiro de outra empresa.
   */
  private async requireChecklistTemplate(
    organizationId: string,
    checklistTemplateId?: string,
  ) {
    if (!checklistTemplateId) return;
    const roteiro = await this.repository.findChecklistTemplate(
      checklistTemplateId,
      organizationId,
    );
    if (!roteiro) {
      throw new EntityNotFoundException(
        'ChecklistTemplate',
        checklistTemplateId,
      );
    }
  }

  async create(actor: RvtActor, input: CreateRvtConfigurationDto) {
    this.assertUnit(actor, input.businessUnitId);
    const tipo = await this.requireMaintenanceType(
      actor.organizationId,
      input.maintenanceTypeId,
    );
    const occurrences = generateRvtOccurrences({
      ...input,
      cadence: tipo,
    });
    try {
      const id = await this.repository.createConfiguration(
        { ...input, organizationId: actor.organizationId },
        occurrences,
        actor.actorId,
      );
      return this.get(id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async list(actor: RvtActor, query: RvtConfigurationQueryDto) {
    if (query.businessUnitId) this.assertUnit(actor, query.businessUnitId);
    const values = await this.repository.listConfigurations(
      actor.organizationId,
      query,
    );
    return {
      data: values.filter(Boolean).map((x) => this.mapper.configuration(x)),
      nextCursor: null,
      hasNextPage: false,
    };
  }
  /**
   * O tipo de manutenção, conferido nesta organização.
   *
   * A FK não conhece inquilino: um id de outro tenant seria aceito pelo banco e
   * a visita passaria a seguir a cadência — e o roteiro — de outra empresa.
   *
   * A cadência volta junto porque é ela que gera as ocorrências, e buscá-la
   * de novo depois abriria janela para o tipo mudar no meio da criação.
   */
  private async requireMaintenanceType(
    organizationId: string,
    maintenanceTypeId: string | undefined,
  ) {
    if (!maintenanceTypeId) {
      throw new ValidationException('A maintenance type is required');
    }
    const tipo = await this.repository.findMaintenanceType(
      maintenanceTypeId,
      organizationId,
    );
    if (!tipo) throw new ValidationException('Invalid maintenance type');
    return tipo;
  }

  async update(id: string, actor: RvtActor, input: UpdateRvtConfigurationDto) {
    const current = await this.get(id, actor);
    const tipo = await this.requireMaintenanceType(
      actor.organizationId,
      input.maintenanceTypeId ?? current.maintenanceType?.id,
    );
    const effective = {
      scheduleMode: current.scheduleMode as 'RECURRING' | 'ONE_TIME',
      cadence: tipo,
      coverageStart: input.coverageStart ?? current.coverage.start,
      coverageEnd: input.coverageEnd ?? current.coverage.end ?? undefined,
      timezone: input.timezone ?? current.timezone,
    };
    const candidates = generateRvtOccurrences(effective);
    try {
      const reconciliation = await this.repository.updateConfiguration(
        id,
        actor.organizationId,
        actor.actorId,
        input,
        candidates,
      );
      return { configuration: await this.get(id, actor), reconciliation };
    } catch (error) {
      this.mapError(error);
    }
  }
  async get(id: string, actor: RvtActor) {
    const value = await this.repository.configuration(id, actor.organizationId);
    if (!value) throw new EntityNotFoundException('RvtConfiguration', id);
    this.assertUnit(actor, value.businessUnitId);
    return this.mapper.configuration(value);
  }
  async occurrences(actor: RvtActor, query: RvtOccurrenceQueryDto) {
    if (query.businessUnitId) this.assertUnit(actor, query.businessUnitId);
    const rows = await this.repository.listOccurrences(
      actor.organizationId,
      query,
    );
    return {
      data: rows.map((x) =>
        this.mapper.occurrence(x, x.configuration.timezone),
      ),
      nextCursor: null,
      hasNextPage: false,
    };
  }
  async timeline(id: string, actor: RvtActor, query: RvtTimelineQueryDto) {
    await this.get(id, actor);
    const result = await this.repository.timeline(
      id,
      actor.organizationId,
      query,
    );
    const equipment = new Map(
      result.equipment.map((item) => [item.id, item.name]),
    );
    const messages: Record<string, string> = {
      RVT_CONFIGURATION_CREATED: 'Configuração RVT criada',
      RVT_OCCURRENCES_RECONCILED: 'Agenda de visitas futuras reconciliada',
      RVT_EXECUTION_STARTED: 'Visita técnica iniciada',
      RVT_EXECUTION_UPDATED: 'Dados da visita atualizados',
      RVT_EQUIPMENT_ADDED: 'Equipamento adicionado à visita',
      RVT_CONTEXTUAL_EQUIPMENT_REGISTERED:
        'Novo equipamento cadastrado durante a visita',
      RVT_CONTEXTUAL_CUSTOMER_REGISTERED:
        'Novo cliente cadastrado no atendimento',
      RVT_CUSTOMER_ACKNOWLEDGED: 'Cliente registrou ciência da visita',
      RVT_EXECUTION_COMPLETED: 'Visita técnica concluída',
      RVT_ARTIFACT_CREATED: 'Documento RVT gerado',
      RVT_AD_HOC_CREATED: 'RVT avulso criado e iniciado',
    };
    return {
      data: result.data.map((item) => ({
        id: item.id,
        type: item.action,
        message: messages[item.action] ?? 'Evento da visita técnica',
        occurredAt: item.createdAt.toISOString(),
        actor: item.user
          ? { id: item.user.id, name: item.user.displayName }
          : null,
        equipment:
          item.entityId && equipment.has(item.entityId)
            ? { id: item.entityId, name: equipment.get(item.entityId)! }
            : null,
        data: (item.after ?? {}) as Record<string, unknown>,
      })),
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  }
  async preparation(id: string, actor: RvtActor) {
    const occurrence = await this.repository.occurrence(
      id,
      actor.organizationId,
    );
    if (!occurrence) throw new EntityNotFoundException('RvtOccurrence', id);
    this.assertUnit(actor, occurrence.businessUnitId);
    const configuration = await this.get(occurrence.configurationId, actor);
    const execution = occurrence.execution
      ? this.mapper.execution(
          await this.repository.execution(
            occurrence.execution.id,
            actor.organizationId,
          ),
        )
      : null;
    const responsibleId =
      occurrence.configuration.defaultResponsibleFieldTechnicianId ??
      actor.actorId;
    const eligibility = await this.workforce.professionalEligibility(
      actor.organizationId,
      responsibleId,
      {
        documentType: 'RVT',
        signedAs: 'FIELD_TECHNICIAN',
        businessUnitId: occurrence.businessUnitId,
      },
    );
    const auxiliaries = await this.workforce.listProfessionals(
      actor.organizationId,
      'FIELD_TECHNICIAN',
      occurrence.businessUnitId,
    );
    const blockers: string[] = [];
    if (occurrence.status === 'CANCELLED')
      blockers.push('OCCURRENCE_CANCELLED');
    if (occurrence.execution) blockers.push('OCCURRENCE_ALREADY_EXECUTED');
    if (!eligibility.eligible)
      blockers.push(
        eligibility.blockedReason ?? 'FIELD_TECHNICIAN_NOT_ELIGIBLE',
      );
    return {
      configuration,
      occurrence: this.mapper.occurrence(
        occurrence,
        occurrence.configuration.timezone,
      ),
      execution,
      availableAuxiliaryTechnicians: auxiliaries.map((x) => ({
        id: x.id,
        name: x.name,
      })),
      executionEligibility: { eligible: !blockers.length, blockers },
      policies: {
        customerSignatureRequired: false,
        fieldTechnicianSignatureRequired: true,
        technicalResponsibleSignatureRequired:
          occurrence.configuration.requiresTechnicalResponsible,
        evidence: {
          optional: true,
          maximumFiles: 20,
          acceptedKinds: ['PHOTO', 'VIDEO', 'DOCUMENT'],
        },
        artifactFromExecutionOnly: true,
      },
      allowedActions: blockers.length ? ['VIEW'] : ['VIEW', 'START'],
    };
  }
  async start(id: string, actor: RvtActor, input: StartRvtExecutionDto) {
    const occurrence = await this.repository.occurrence(
      id,
      actor.organizationId,
    );
    if (!occurrence) throw new EntityNotFoundException('RvtOccurrence', id);
    this.assertUnit(actor, occurrence.businessUnitId);
    const responsibleId =
      input.responsibleFieldTechnicianId ??
      occurrence.configuration.defaultResponsibleFieldTechnicianId ??
      actor.actorId;
    if (
      responsibleId !== actor.actorId &&
      !actor.permissions.includes('rvt.manage')
    )
      throw new ForbiddenException(
        'Only an RVT manager may assign another field technician',
      );
    try {
      const result = await this.repository.startExecution({
        organizationId: actor.organizationId,
        occurrenceId: id,
        actorId: actor.actorId,
        responsibleId,
        auxiliaries: [...new Set(input.auxiliaryTechnicianIds ?? [])],
      });
      return this.execution(result.id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async execution(id: string, actor: RvtActor) {
    const value = await this.repository.execution(id, actor.organizationId);
    if (!value) throw new EntityNotFoundException('RvtExecution', id);
    this.assertUnit(actor, value.businessUnitId);
    return this.mapper.execution(value);
  }
  async updateExecution(
    id: string,
    actor: RvtActor,
    input: UpdateRvtExecutionDto,
  ) {
    await this.ensureExecution(id, actor);
    try {
      await this.repository.updateExecution(
        id,
        actor.organizationId,
        actor.actorId,
        input,
      );
      return this.execution(id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async addExistingEquipment(id: string, actor: RvtActor, assetId: string) {
    await this.ensureExecution(id, actor);
    try {
      await this.repository.addEquipment(
        id,
        actor.organizationId,
        actor.actorId,
        assetId,
      );
      return this.execution(id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async registerEquipment(id: string, actor: RvtActor, input: any) {
    await this.ensureExecution(id, actor);
    try {
      await this.repository.registerEquipment(
        id,
        actor.organizationId,
        actor.actorId,
        input,
      );
      return this.execution(id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async addEvidence(id: string, actor: RvtActor, input: any) {
    await this.ensureExecution(id, actor);
    try {
      await this.repository.addEvidence(
        id,
        actor.organizationId,
        actor.actorId,
        input,
      );
      return this.execution(id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async acknowledge(id: string, actor: RvtActor, input: any) {
    await this.ensureExecution(id, actor);
    try {
      await this.repository.acknowledge(
        id,
        actor.organizationId,
        actor.actorId,
        input,
      );
      return this.execution(id, actor);
    } catch (e) {
      this.mapError(e);
    }
  }
  async complete(id: string, actor: RvtActor, performedAt = new Date()) {
    await this.ensureExecution(id, actor);
    try {
      await this.repository.complete(
        id,
        actor.organizationId,
        actor.actorId,
        performedAt,
      );
      const artifact = await this.repository.generateArtifact(
        id,
        actor.organizationId,
        actor.actorId,
      );
      return {
        execution: await this.execution(id, actor),
        artifactExecutionId: artifact.artifactExecutionId,
      };
    } catch (e) {
      this.mapError(e);
    }
  }
  async generateArtifact(id: string, actor: RvtActor) {
    await this.ensureExecution(id, actor);
    try {
      return await this.repository.generateArtifact(
        id,
        actor.organizationId,
        actor.actorId,
      );
    } catch (e) {
      this.mapError(e);
    }
  }
  async render(
    id: string,
    actor: RvtActor,
    renderer: 'html.default' | 'pdf.default' = 'pdf.default',
  ) {
    const generated = await this.generateArtifact(id, actor);
    return this.rendering.request(
      generated.artifactExecutionId,
      { organizationId: actor.organizationId, actorId: actor.actorId },
      { renderer, metadata: { source: 'RVT' } },
    );
  }
  async adHoc(
    actor: RvtActor,
    idempotencyKey: string | undefined,
    input: CreateAdHocRvtDto,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey))
      throw new ValidationException(
        'Idempotency-Key must contain 8 to 160 safe characters',
      );
    this.assertUnit(actor, input.businessUnitId);
    if (Boolean(input.customerId) === Boolean(input.customer))
      throw new ValidationException(
        'Provide exactly one of customerId or contextual customer',
      );
    if (
      input.responsibleFieldTechnicianId &&
      input.responsibleFieldTechnicianId !== actor.actorId &&
      !actor.permissions.includes('rvt.manage')
    )
      throw new ForbiddenException(
        'Only an RVT manager may assign another field technician',
      );
    const today = civilDateKey(new Date(), input.timezone);
    const canonical = this.canonicalJson(input);
    const payloadHash = createHash('sha256').update(canonical).digest('hex');
    try {
      const result = await this.repository.createAdHoc(
        {
          ...input,
          organizationId: actor.organizationId,
          actorId: actor.actorId,
          coverageStart: today,
          scheduledFor: instantFromCivilDate(today, input.timezone, 9),
        },
        idempotencyKey,
        payloadHash,
      );
      return {
        execution: await this.execution(result.executionId, actor),
        idempotency: { key: idempotencyKey, replayed: !result.created },
      };
    } catch (error) {
      this.mapError(error);
    }
  }
  private async ensureExecution(id: string, actor: RvtActor) {
    const value = await this.repository.execution(id, actor.organizationId);
    if (!value) throw new EntityNotFoundException('RvtExecution', id);
    this.assertUnit(actor, value.businessUnitId);
    return value;
  }
  private assertUnit(actor: RvtActor, id: string) {
    if (!actor.businessUnitIds.includes(id))
      throw new ForbiddenException('Business unit scope invalid');
  }
  private mapError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        throw new ConflictException(
          'RVT already exists for this occurrence or identity',
        );
      if (error.code === 'P2025')
        throw new ValidationException(
          'Related resource is missing or outside scope',
        );
    }
    if (error instanceof Error) {
      const known = [
        'BUSINESS_UNIT_SCOPE_INVALID',
        'RVT_OCCURRENCE_NOT_STARTABLE',
        'FIELD_TECHNICIAN_NOT_ELIGIBLE',
        'FIELD_TECHNICIAN_SIGNATURE_MISSING',
        'TECHNICAL_RESPONSIBLE_NOT_ELIGIBLE',
        'TECHNICAL_RESPONSIBLE_SIGNATURE_MISSING',
        'RVT_EXECUTION_NOT_COMPLETABLE',
        'RVT_EXECUTION_NOT_COMPLETED',
        'RVT_ARTIFACT_TEMPLATE_NOT_FOUND',
        'RVT_EVIDENCE_TOO_LARGE',
        'RVT_SCHEDULE_MODE_IMMUTABLE',
        'RVT_AD_HOC_CUSTOMER_CHOICE_INVALID',
      ];
      if (error.message === 'RVT_IDEMPOTENCY_PAYLOAD_MISMATCH')
        throw new ConflictException(error.message);
      if (known.includes(error.message))
        throw new ValidationException(error.message);
    }
    throw error;
  }

  private canonicalJson(value: unknown): string {
    const normalize = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(normalize);
      if (item && typeof item === 'object')
        return Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, normalize(child)]),
        );
      return item;
    };
    return JSON.stringify(normalize(value));
  }
}
