import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { AuthenticatedIdentity } from '../identity/domain/identity.types';

/**
 * O que aconteceu e o que vem aí — as duas listas do Dashboard.
 *
 * ## Por que não o log de auditoria
 *
 * O log registra tudo, em vocabulário de sistema ("FINANCIAL_ENTRY_CREATED"),
 * e transformar isso em frase útil seria manter um dicionário de dezenas de
 * ações. Quem gerencia uma operação de climatização quer saber de poucas
 * coisas: atendimento aberto, iniciado e concluído; chamado novo de cliente;
 * orçamento aprovado ou recusado; manutenção de PMOC e visita de RVT
 * concluídas. Essas datas já existem nas próprias tabelas.
 *
 * ## Quem vê o quê
 *
 * O painel exige `dashboard.read`; cada fonte entra só com a leitura do seu
 * módulo (`operations.read`, `pmoc.read`…). A RLS da transação limita à
 * organização e às unidades da pessoa, como em qualquer listagem.
 */

export type FeedKind =
  'OPERATION' | 'SERVICE_REQUEST' | 'QUOTE' | 'PMOC' | 'RVT';

export type FeedEvent =
  | 'CREATED'
  | 'STARTED'
  | 'COMPLETED'
  | 'OPENED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SCHEDULED'
  | 'DUE';

export interface DashboardFeedItemReadModel {
  /** Chave estável: tipo, registro e evento. */
  id: string;
  kind: FeedKind;
  event: FeedEvent;
  /** O registro para abrir — `operation`, `quote`, `pmoc-plan`… */
  entityType: string;
  entityId: string;
  code: string | null;
  title: string;
  customerName: string | null;
  /** Quem fez (atividade) ou quem vai fazer (próximos). */
  personName: string | null;
  at: string;
  /** Data sem hora — vencimento de PMOC é dia, não instante. */
  allDay: boolean;
}

export interface DashboardFeedReadModel {
  generatedAt: string;
  items: DashboardFeedItemReadModel[];
}

interface FeedRow {
  kind: FeedKind;
  event: FeedEvent;
  entity_type: string;
  entity_id: string;
  code: string | null;
  title: string;
  customer_name: string | null;
  person_name: string | null;
  at: Date;
  all_day: boolean;
}

const TERMINAL = Prisma.sql`('COMPLETED', 'CANCELLED', 'CANCELED', 'DONE', 'CLOSED', 'FINALIZED')`;

@Injectable()
export class DashboardFeedService {
  constructor(private readonly rls: RlsTransaction) {}

  /** O que aconteceu nos últimos 30 dias, do mais recente para trás. */
  async activity(
    identity: AuthenticatedIdentity,
    options: { businessUnitId?: string; limit?: number },
  ): Promise<DashboardFeedReadModel> {
    const can = this.permissions(identity);
    const org = identity.organizationId!;
    const unit = (column: Prisma.Sql) =>
      options.businessUnitId
        ? Prisma.sql`AND ${column} = ${options.businessUnitId}::uuid`
        : Prisma.empty;
    const since = Prisma.sql`now() - interval '30 days'`;
    const customer = (alias: Prisma.Sql) =>
      Prisma.sql`(SELECT COALESCE(feed_customer.trade_name, feed_customer.legal_name) FROM customers feed_customer WHERE feed_customer.id = ${alias})`;
    const person = (column: Prisma.Sql) =>
      Prisma.sql`(SELECT feed_user.display_name FROM users feed_user WHERE feed_user.id = ${column})`;

    const parts: Prisma.Sql[] = [];
    if (can('operations.read')) {
      const base = (event: string, column: Prisma.Sql, actor: Prisma.Sql) =>
        Prisma.sql`
        SELECT 'OPERATION' AS kind, ${event} AS event, 'operation' AS entity_type,
               o.id AS entity_id, o.code, o.title,
               ${customer(Prisma.sql`o.customer_id`)} AS customer_name,
               ${person(actor)} AS person_name, ${column} AS at, false AS all_day
          FROM operations o
         WHERE o.organization_id = ${org}::uuid AND o.deleted_at IS NULL
           AND ${column} >= ${since} ${unit(Prisma.sql`o.business_unit_id`)}`;
      parts.push(
        base('CREATED', Prisma.sql`o.created_at`, Prisma.sql`o.created_by_id`),
        base(
          'STARTED',
          Prisma.sql`o.started_at`,
          Prisma.sql`COALESCE(o.started_by_user_id, o.responsible_field_technician_id)`,
        ),
        base(
          'COMPLETED',
          Prisma.sql`o.completed_at`,
          Prisma.sql`COALESCE(o.completed_by_user_id, o.responsible_field_technician_id)`,
        ),
      );
    }
    if (can('customer_service_requests.read'))
      parts.push(Prisma.sql`
        SELECT 'SERVICE_REQUEST', 'OPENED', 'customer-service-request',
               r.id, r.code, r.subject,
               ${customer(Prisma.sql`r.customer_id`)}, NULL, r.submitted_at, false
          FROM customer_service_requests r
         WHERE r.organization_id = ${org}::uuid AND r.submitted_at >= ${since}
           ${options.businessUnitId ? Prisma.sql`AND (r.business_unit_id IS NULL OR r.business_unit_id = ${options.businessUnitId}::uuid)` : Prisma.empty}`);
    if (can('quotes.read'))
      parts.push(Prisma.sql`
        SELECT 'QUOTE', q.status, 'quote', q.id, q.code, q.title,
               ${customer(Prisma.sql`q.customer_id`)}, ${person(Prisma.sql`q.decided_by_id`)},
               q.decided_at, false
          FROM quotes q
         WHERE q.organization_id = ${org}::uuid AND q.deleted_at IS NULL
           AND q.status IN ('APPROVED', 'REJECTED') AND q.decided_at >= ${since}
           ${unit(Prisma.sql`q.business_unit_id`)}`);
    if (can('pmoc.read'))
      parts.push(Prisma.sql`
        SELECT 'PMOC', 'COMPLETED', 'pmoc-plan', p.id, p.code,
               p.name || ' — ' || a.name,
               ${customer(Prisma.sql`p.customer_id`)},
               ${person(Prisma.sql`COALESCE(e.completed_by_id, e.responsible_field_technician_id)`)},
               e.completed_at, false
          FROM pmoc_equipment_executions e
          JOIN pmoc_plans p ON p.id = e.plan_id AND p.organization_id = e.organization_id
          JOIN assets a ON a.id = e.asset_id AND a.organization_id = e.organization_id
         WHERE e.organization_id = ${org}::uuid AND e.completed_at >= ${since}
           AND p.deleted_at IS NULL ${unit(Prisma.sql`e.business_unit_id`)}`);
    if (can('rvt.read'))
      parts.push(Prisma.sql`
        SELECT 'RVT', 'COMPLETED', 'rvt-configuration', c.id, c.code, c.name,
               ${customer(Prisma.sql`c.customer_id`)},
               ${person(Prisma.sql`COALESCE(x.completed_by_id, x.responsible_field_technician_id)`)},
               x.completed_at, false
          FROM rvt_executions x
          JOIN rvt_occurrences o ON o.id = x.occurrence_id AND o.organization_id = x.organization_id
          JOIN rvt_configurations c ON c.id = o.configuration_id AND c.organization_id = o.organization_id
         WHERE x.organization_id = ${org}::uuid AND x.completed_at >= ${since}
           AND c.deleted_at IS NULL ${unit(Prisma.sql`x.business_unit_id`)}`);

    return this.read(
      parts,
      'DESC',
      Math.min(Math.max(options.limit ?? 12, 1), 50),
    );
  }

  /** Atendimentos, visitas de RVT e vencimentos de PMOC dos próximos dias. */
  async upcoming(
    identity: AuthenticatedIdentity,
    options: { businessUnitId?: string; days?: number; limit?: number },
  ): Promise<DashboardFeedReadModel> {
    const can = this.permissions(identity);
    const org = identity.organizationId!;
    const days = Math.min(Math.max(options.days ?? 14, 1), 60);
    const unit = (column: Prisma.Sql) =>
      options.businessUnitId
        ? Prisma.sql`AND ${column} = ${options.businessUnitId}::uuid`
        : Prisma.empty;
    const until = Prisma.sql`now() + make_interval(days => ${days})`;
    const customer = (alias: Prisma.Sql) =>
      Prisma.sql`(SELECT COALESCE(feed_customer.trade_name, feed_customer.legal_name) FROM customers feed_customer WHERE feed_customer.id = ${alias})`;
    const person = (column: Prisma.Sql) =>
      Prisma.sql`(SELECT feed_user.display_name FROM users feed_user WHERE feed_user.id = ${column})`;

    const parts: Prisma.Sql[] = [];
    if (can('operations.read'))
      parts.push(Prisma.sql`
        SELECT 'OPERATION' AS kind, 'SCHEDULED' AS event, 'operation' AS entity_type,
               o.id AS entity_id, o.code, o.title,
               ${customer(Prisma.sql`o.customer_id`)} AS customer_name,
               ${person(Prisma.sql`o.responsible_field_technician_id`)} AS person_name,
               o.scheduled_start AS at, false AS all_day
          FROM operations o
         WHERE o.organization_id = ${org}::uuid AND o.deleted_at IS NULL
           AND o.status NOT IN ${TERMINAL}
           AND o.scheduled_start >= now() AND o.scheduled_start <= ${until}
           ${unit(Prisma.sql`o.business_unit_id`)}`);
    if (can('rvt.read'))
      parts.push(Prisma.sql`
        SELECT 'RVT', 'SCHEDULED', 'rvt-configuration', c.id, c.code, c.name,
               ${customer(Prisma.sql`c.customer_id`)},
               ${person(Prisma.sql`COALESCE(o.responsible_field_technician_id, c.default_responsible_field_technician_id)`)},
               COALESCE(o.scheduled_for, o.local_scheduled_date::timestamptz),
               o.scheduled_for IS NULL
          FROM rvt_occurrences o
          JOIN rvt_configurations c ON c.id = o.configuration_id AND c.organization_id = o.organization_id
         WHERE o.organization_id = ${org}::uuid AND o.deleted_at IS NULL AND c.deleted_at IS NULL
           AND o.status NOT IN ${TERMINAL}
           AND COALESCE(o.scheduled_for, o.local_scheduled_date::timestamptz) >= date_trunc('day', now())
           AND COALESCE(o.scheduled_for, o.local_scheduled_date::timestamptz) <= ${until}
           ${unit(Prisma.sql`o.business_unit_id`)}`);
    if (can('pmoc.read'))
      parts.push(Prisma.sql`
        SELECT 'PMOC', 'DUE', 'pmoc-plan', p.id, p.code, p.name,
               ${customer(Prisma.sql`p.customer_id`)},
               ${person(Prisma.sql`p.technician_user_id`)},
               e.due_on::timestamptz, true
          FROM pmoc_executions e
          JOIN pmoc_plans p ON p.id = e.plan_id AND p.organization_id = e.organization_id
         WHERE e.organization_id = ${org}::uuid AND p.deleted_at IS NULL
           AND e.status NOT IN ${TERMINAL}
           AND e.due_on >= current_date AND e.due_on <= (${until})::date
           ${unit(Prisma.sql`p.business_unit_id`)}`);

    return this.read(
      parts,
      'ASC',
      Math.min(Math.max(options.limit ?? 12, 1), 50),
    );
  }

  private permissions(identity: AuthenticatedIdentity) {
    const granted = new Set(identity.permissions);
    return (permission: string) =>
      identity.isOrganizationOwner ||
      granted.has('*') ||
      granted.has(permission);
  }

  private async read(
    parts: Prisma.Sql[],
    order: 'ASC' | 'DESC',
    limit: number,
  ): Promise<DashboardFeedReadModel> {
    const generatedAt = new Date().toISOString();
    if (parts.length === 0) return { generatedAt, items: [] };
    const rows = await this.rls.run(
      (tx) =>
        tx.$queryRaw<FeedRow[]>`
        SELECT * FROM (${Prisma.join(parts, ' UNION ALL ')}) AS feed
         WHERE at IS NOT NULL
         ORDER BY at ${order === 'ASC' ? Prisma.sql`ASC` : Prisma.sql`DESC`}
         LIMIT ${limit}`,
    );
    return {
      generatedAt,
      items: rows.map((row) => ({
        id: `${row.kind}:${row.entity_id}:${row.event}:${row.at.toISOString()}`,
        kind: row.kind,
        event: row.event,
        entityType: row.entity_type,
        entityId: row.entity_id,
        code: row.code,
        title: row.title,
        customerName: row.customer_name,
        personName: row.person_name,
        at: row.at.toISOString(),
        allDay: row.all_day,
      })),
    };
  }
}
