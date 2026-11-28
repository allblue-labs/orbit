import { Injectable } from '@nestjs/common';
import type {
  CustomerServiceRequestDetailsReadModel,
  CustomerServiceRequestListItemReadModel,
  CustomerServiceRequestPageReadModel,
  CustomerServiceRequestTimelineItemReadModel,
  CustomerServiceRequestStatusReadModel,
} from './customer-service-request.read-models';
import { CustomerServiceRequestPolicy } from './customer-service-request.policy';
import type {
  CustomerServiceRequestCategory,
  CustomerServiceRequestEquipmentCondition,
  CustomerServiceRequestStatus,
  CustomerServiceRequestUrgency,
} from './customer-service-request.types';

const statusLabels: Record<CustomerServiceRequestStatus, string> = {
  OPEN: 'Aberto',
  IN_TRIAGE: 'Em triagem',
  IN_PROGRESS: 'Em atendimento',
  WAITING_CUSTOMER: 'Aguardando cliente',
  RESOLVED: 'Resolvido',
  REJECTED: 'Recusado',
  CANCELLED: 'Cancelado',
};

const urgencyLabels: Record<CustomerServiceRequestUrgency, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

const conditionLabels: Record<
  CustomerServiceRequestEquipmentCondition,
  string
> = {
  STOPPED: 'Parado',
  MALFUNCTIONING: 'Funcionando com problema',
  WORKING: 'Funcionando normalmente',
};

const texto = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const categoryLabels: Record<CustomerServiceRequestCategory, string> = {
  MAINTENANCE: 'Manutenção',
  EQUIPMENT_PROBLEM: 'Problema em equipamento',
  SERVICE_REQUEST: 'Solicitação de serviço',
  DOCUMENT_REQUEST: 'Solicitação de documento',
  QUESTION: 'Dúvida',
  OTHER: 'Outro',
};

interface RequestRecord {
  id: string;
  code: string;
  category: string;
  subject: string;
  description?: string;
  status: string;
  urgency?: string;
  details?: unknown;
  version: number;
  submittedAt: Date;
  updatedAt: Date;
  closedAt?: Date | null;
  cancelledAt?: Date | null;
  convertedOperationId?: string | null;
  asset: { id: string; name: string; identifier: string | null } | null;
  customer?: { id: string; legalName: string; tradeName: string | null };
  createdByPortalIdentity?: { displayName: string } | null;
  businessUnit?: {
    id: string;
    legalName: string;
    tradeName: string | null;
  } | null;
  assignedTo?: { id: string; displayName: string } | null;
  convertedOperation?: { id: string; code: string; status: string } | null;
  events?: Array<{
    id: string;
    type: string;
    visibility: string;
    actorType: string;
    actorDisplayName: string;
    message: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    createdAt: Date;
  }>;
}

@Injectable()
export class CustomerServiceRequestMapper {
  constructor(private readonly policy: CustomerServiceRequestPolicy) {}

  page(
    result: {
      data: RequestRecord[];
      total: number;
      page: number;
      limit: number;
    },
    audience: 'PORTAL' | 'INTERNAL',
  ): CustomerServiceRequestPageReadModel {
    return {
      data: result.data.map((item) => this.listItem(item, audience)),
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
  }

  details(
    record: RequestRecord,
    audience: 'PORTAL' | 'INTERNAL',
  ): CustomerServiceRequestDetailsReadModel {
    const base = this.listItem(record, audience);
    return {
      ...base,
      description: record.description ?? '',
      details: this.detailsOf(record.details),
      requester: record.createdByPortalIdentity?.displayName ?? null,
      customer: {
        id: record.customer?.id ?? '',
        name: record.customer?.tradeName ?? record.customer?.legalName ?? '',
      },
      businessUnit: record.businessUnit
        ? {
            id: record.businessUnit.id,
            name:
              record.businessUnit.tradeName ?? record.businessUnit.legalName,
          }
        : null,
      convertedOperation: record.convertedOperation ?? null,
      timeline: (record.events ?? [])
        .filter(
          (event) => audience === 'INTERNAL' || event.visibility === 'PORTAL',
        )
        .map((event) => this.timeline(event)),
      closedAt: record.closedAt?.toISOString() ?? null,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
    };
  }

  private listItem(
    record: RequestRecord,
    audience: 'PORTAL' | 'INTERNAL',
  ): CustomerServiceRequestListItemReadModel {
    const status = record.status as CustomerServiceRequestStatus;
    const category = record.category as CustomerServiceRequestCategory;
    const urgency = (record.urgency ??
      'NORMAL') as CustomerServiceRequestUrgency;
    return {
      id: record.id,
      code: record.code,
      category: { code: category, label: categoryLabels[category] },
      subject: record.subject,
      status: { code: status, label: statusLabels[status] },
      urgency: { code: urgency, label: urgencyLabels[urgency] },
      asset: record.asset,
      customerName: record.customer
        ? (record.customer.tradeName ?? record.customer.legalName)
        : null,
      assignedTo: record.assignedTo ?? null,
      submittedAt: record.submittedAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      version: record.version,
      allowedActions:
        audience === 'PORTAL'
          ? this.policy.portalActions(
              status,
              Boolean(record.convertedOperationId),
            )
          : this.policy.internalActions(
              status,
              Boolean(record.convertedOperationId),
            ),
    };
  }

  private detailsOf(value: unknown) {
    const map =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const condicao = map.equipmentCondition as
      CustomerServiceRequestEquipmentCondition | undefined;
    return {
      equipmentCondition:
        condicao && condicao in conditionLabels
          ? { code: condicao, label: conditionLabels[condicao] }
          : null,
      siteLocation: texto(map.siteLocation),
      availability: texto(map.availability),
      contactName: texto(map.contactName),
      contactPhone: texto(map.contactPhone),
    };
  }

  private timeline(
    event: NonNullable<RequestRecord['events']>[number],
  ): CustomerServiceRequestTimelineItemReadModel {
    const from =
      event.fromStatus as CustomerServiceRequestStatusReadModel | null;
    const to = event.toStatus as CustomerServiceRequestStatusReadModel | null;
    return {
      id: event.id,
      type: event.type,
      visibility: event.visibility as 'PORTAL' | 'INTERNAL',
      actor: { type: event.actorType, displayName: event.actorDisplayName },
      message: event.message,
      statusChange: from || to ? { from, to } : null,
      createdAt: event.createdAt.toISOString(),
    };
  }
}
