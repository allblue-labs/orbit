import { Injectable, Logger } from '@nestjs/common';
import {
  EntityNotFoundException,
  ValidationException,
} from '../../../../exceptions';
import type { EquipmentQrRenderQueryDto } from './equipment-qr.dto';
import type {
  EquipmentFieldAction,
  EquipmentFieldDetailsReadModel,
  EquipmentPmocContextReadModel,
  EquipmentQrSummaryReadModel,
  EquipmentServiceOrderPreparationReadModel,
} from './equipment-qr.read-models';
import { EquipmentQrRenderer } from './equipment-qr.renderer';
import { EquipmentQrRepository } from './equipment-qr.repository';
import { PmocService } from '../../../pmoc/pmoc.service';

export interface EquipmentQrActor {
  organizationId: string;
  actorId: string;
  businessUnitIds: readonly string[];
  permissions: readonly string[];
}

@Injectable()
export class EquipmentQrService {
  private readonly logger = new Logger(EquipmentQrService.name);
  constructor(
    private readonly repository: EquipmentQrRepository,
    private readonly renderer: EquipmentQrRenderer,
    private readonly pmoc: PmocService,
  ) {}

  async summary(
    equipmentId: string,
    actor: EquipmentQrActor,
  ): Promise<EquipmentQrSummaryReadModel> {
    const identity = await this.repository.identityForEquipment(
      equipmentId,
      actor.organizationId,
    );
    if (!identity) throw new EntityNotFoundException('Equipment QR identity');
    this.assertUnit(actor, identity.businessUnitId);
    return {
      qrAvailable: true,
      status: identity.status,
      createdAt: identity.createdAt,
      lastRotatedAt: identity.rotatedAt,
    };
  }

  async ensure(equipmentId: string, actor: EquipmentQrActor) {
    const identity = await this.repository.ensure(
      equipmentId,
      actor.organizationId,
    );
    if (!identity) throw new EntityNotFoundException('Equipment', equipmentId);
    this.assertUnit(actor, identity.businessUnitId);
    return this.summary(equipmentId, actor);
  }

  async rotate(equipmentId: string, actor: EquipmentQrActor) {
    const identity = await this.repository.rotate(
      equipmentId,
      actor.organizationId,
      actor.actorId,
    );
    if (!identity) throw new EntityNotFoundException('Equipment', equipmentId);
    this.assertUnit(actor, identity.businessUnitId);
    this.logger.log(
      JSON.stringify({
        metric: 'equipment_qr_rotate_total',
      }),
    );
    return this.summary(equipmentId, actor);
  }

  async revoke(equipmentId: string, actor: EquipmentQrActor) {
    // A physical label is revoked by replacing its identity atomically. This
    // preserves the global invariant that every Equipment keeps one active QR.
    const replacement = await this.repository.rotate(
      equipmentId,
      actor.organizationId,
      actor.actorId,
    );
    if (!replacement)
      throw new EntityNotFoundException('Equipment', equipmentId);
    this.assertUnit(actor, replacement.businessUnitId);
    return {
      revoked: true,
      replacementCreated: true,
      qr: await this.summary(equipmentId, actor),
    };
  }

  async resolve(
    token: string,
    actor: EquipmentQrActor,
  ): Promise<EquipmentFieldDetailsReadModel> {
    const normalized = this.normalizeToken(token);
    const tokenHash = this.repository.hash(normalized);
    const identity = await this.repository.identityByTokenHash(
      tokenHash,
      actor.organizationId,
    );
    if (!identity || !actor.businessUnitIds.includes(identity.businessUnitId)) {
      this.logger.warn(
        JSON.stringify({
          metric: 'equipment_qr_resolve_denied_total',
        }),
      );
      throw new EntityNotFoundException('Equipment');
    }
    const equipment = identity.equipment;
    const context = await this.repository.fieldContext(
      equipment.id,
      actor.organizationId,
    );
    const permissions = new Set(actor.permissions);
    const pmocContexts: EquipmentPmocContextReadModel[] = [];
    for (const coverage of context.coverages) {
      const cycle = coverage.plan.executions[0] ?? null;
      let ready = false;
      let blockedReasons: readonly string[] = [];
      if (cycle) {
        try {
          const preparation = await this.pmoc.equipmentExecutionPreparation(
            coverage.plan.id,
            cycle.id,
            equipment.id,
            /* A etiqueta só **lê** a elegibilidade para escrever uma frase. A
               exceção do dono não muda leitura, e propagá-la aqui exigiria
               carregá-la por um caminho que não decide nada. */
            { ...actor, isOrganizationOwner: false },
          );
          ready = preparation.eligibility.ready;
          blockedReasons = preparation.eligibility.blockedReasons;
        } catch {
          blockedReasons = ['CONTEXT_UNAVAILABLE'];
        }
      } else blockedReasons = ['CYCLE_NOT_PENDING'];
      const authorized =
        this.hasPermission(permissions, 'pmoc.manage') &&
        this.hasPermission(permissions, 'operations.create');
      pmocContexts.push({
        planId: coverage.plan.id,
        planName: coverage.plan.name,
        cycleId: cycle?.id ?? null,
        dueOn: cycle?.dueOn ?? coverage.plan.nextDueOn,
        eligible: ready && authorized,
        blockedReason: ready
          ? authorized
            ? null
            : 'Usuário sem permissão para executar PMOC.'
          : this.pmocBlockedReason(blockedReasons),
      });
    }
    const rvtExecutionIds = context.rvtExecutions
      .filter(
        (execution) =>
          execution.businessUnitId === equipment.businessUnitId &&
          execution.occurrence.configuration.customerId ===
            equipment.customerId,
      )
      .map((execution) => execution.id);
    const actions: EquipmentFieldAction[] = ['VIEW_DETAILS'];
    if (this.hasPermission(permissions, 'operations.history.read'))
      actions.push('VIEW_HISTORY');
    if (
      equipment.status === 'ACTIVE' &&
      this.hasPermission(permissions, 'operations.create')
    )
      actions.push('START_SERVICE_ORDER');
    if (pmocContexts.some((item) => item.eligible))
      actions.push('EXECUTE_PMOC');
    if (
      rvtExecutionIds.length &&
      this.hasPermission(permissions, 'rvt.execute')
    )
      actions.push('ADD_TO_RVT');
    const contact = equipment.customer?.contacts[0] ?? null;
    const specifications = this.record(equipment.specifications);
    this.logger.log(
      JSON.stringify({
        metric: 'equipment_qr_resolve_total',
      }),
    );
    return {
      id: equipment.id,
      code: this.code(equipment.identifier, equipment.id),
      name: equipment.name,
      type: equipment.category,
      brand: equipment.manufacturer,
      model: equipment.model,
      serialNumber: equipment.serialNumber,
      status: equipment.status,
      customer: equipment.customer
        ? {
            id: equipment.customer.id,
            name: equipment.customer.tradeName ?? equipment.customer.legalName,
            contact: contact
              ? { name: contact.name, phone: contact.phone }
              : null,
          }
        : null,
      serviceLocation: equipment.location,
      sector:
        typeof specifications.sector === 'string'
          ? specifications.sector
          : null,
      lastService: context.lastService
        ? {
            date:
              context.lastService.completedAt ?? context.lastService.createdAt,
            type: context.lastService.kind,
            status: context.lastService.status,
          }
        : null,
      nextMaintenance:
        pmocContexts
          .map((item) => item.dueOn)
          .filter((date): date is Date => Boolean(date))
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      pmocExecutableContexts:
        this.hasPermission(permissions, 'pmoc.read') ||
        this.hasPermission(permissions, 'pmoc.manage')
          ? pmocContexts
          : [],
      allowedActions: actions,
      availability: { active: equipment.status === 'ACTIVE', rvtExecutionIds },
    };
  }

  async serviceOrderPreparation(
    equipmentId: string,
    actor: EquipmentQrActor,
  ): Promise<EquipmentServiceOrderPreparationReadModel> {
    const identity = await this.repository.identityForEquipment(
      equipmentId,
      actor.organizationId,
    );
    if (!identity) throw new EntityNotFoundException('Equipment', equipmentId);
    this.assertUnit(actor, identity.businessUnitId);
    const equipment = identity.equipment;
    const contact = equipment.customer?.contacts[0] ?? null;
    return {
      equipment: {
        id: equipment.id,
        code: this.code(equipment.identifier, equipment.id),
        name: equipment.name,
        type: equipment.category,
      },
      customer: equipment.customer
        ? {
            id: equipment.customer.id,
            name: equipment.customer.tradeName ?? equipment.customer.legalName,
          }
        : null,
      businessUnitId: equipment.businessUnitId,
      address: equipment.customer?.address ?? {
        street: equipment.businessUnit.street,
        number: equipment.businessUnit.number,
        district: equipment.businessUnit.district,
        city: equipment.businessUnit.city,
        stateCode: equipment.businessUnit.stateCode,
      },
      serviceLocation: equipment.location,
      contact: contact
        ? { name: contact.name, phone: contact.phone, email: contact.email }
        : null,
      operationCreated: false,
    };
  }

  async render(
    equipmentId: string,
    actor: EquipmentQrActor,
    query: EquipmentQrRenderQueryDto,
  ) {
    const identity = await this.repository.identityForEquipment(
      equipmentId,
      actor.organizationId,
    );
    if (!identity) throw new EntityNotFoundException('Equipment QR identity');
    this.assertUnit(actor, identity.businessUnitId);
    const equipment = identity.equipment;
    const brandingName =
      query.branding === 'BUSINESS_UNIT'
        ? (equipment.businessUnit.tradeName ?? equipment.businessUnit.legalName)
        : query.branding === 'ORGANIZATION'
          ? identity.organization.displayName
          : undefined;
    /*
     * Aqui a marca é escolha de quem pede, não precedência: o parâmetro diz de
     * quem é o selo. A unidade ainda cai para a marca da empresa quando não tem
     * a sua — um QR sem selo nenhum seria pior que um com o selo da empresa.
     *
     * Antes disso, `ORGANIZATION` lia `settings.logoUrl`: não havia coluna, e a
     * marca da empresa morava no JSON livre, que o servidor não valida. Agora
     * há campo, e a migração trouxe o que estava lá.
     */
    const logoUrl =
      query.branding === 'BUSINESS_UNIT'
        ? (equipment.businessUnit.logoUrl ?? identity.organization.logoUrl)
        : query.branding === 'ORGANIZATION'
          ? identity.organization.logoUrl
          : null;
    const rendered = await this.renderer.render(
      {
        url: this.publicUrl(identity.token),
        code: this.code(equipment.identifier, equipment.id),
        name: equipment.name,
        preset: query.preset,
        brandingName,
        logoUrl,
      },
      query.format,
    );
    return {
      ...rendered,
      fileName: `equipment-${this.code(equipment.identifier, equipment.id)}-qr.${rendered.extension}`,
    };
  }

  private normalizeToken(token: string) {
    const normalized = token.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(normalized))
      throw new EntityNotFoundException('Equipment');
    return normalized;
  }

  private publicUrl(token: string) {
    const configured =
      process.env.EQUIPMENT_QR_PUBLIC_BASE_URL ??
      process.env.FRONTEND_ORIGIN?.split(',')[0] ??
      'http://localhost:3000';
    try {
      return new URL(`/q/${token}`, configured).toString();
    } catch {
      throw new ValidationException('EQUIPMENT_QR_PUBLIC_BASE_URL inválida');
    }
  }

  private code(identifier: string | null, id: string) {
    return (
      identifier?.trim() ||
      `EQ-${id.replaceAll('-', '').slice(-8).toUpperCase()}`
    );
  }

  private assertUnit(actor: EquipmentQrActor, businessUnitId: string) {
    if (!actor.businessUnitIds.includes(businessUnitId))
      throw new EntityNotFoundException('Equipment');
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private hasPermission(permissions: ReadonlySet<string>, permission: string) {
    return permissions.has('*') || permissions.has(permission);
  }

  private pmocBlockedReason(reasons: readonly string[]) {
    const labels: Record<string, string> = {
      PLAN_NOT_ACTIVE: 'Plano PMOC não está ativo.',
      CYCLE_NOT_PENDING: 'Nenhum ciclo PMOC pendente.',
      EQUIPMENT_INACTIVE: 'Equipamento inativo.',
      TECHNICAL_RESPONSIBLE_MISSING: 'Responsável técnico não configurado.',
      SIGNATURE_MISSING: 'Assinatura do responsável técnico pendente.',
      CONTEXT_UNAVAILABLE: 'Contexto PMOC indisponível para este usuário.',
    };
    return (
      labels[reasons[0] ?? ''] ??
      'Execução PMOC indisponível no contexto atual.'
    );
  }
}
