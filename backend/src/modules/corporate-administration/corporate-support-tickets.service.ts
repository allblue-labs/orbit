import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { ConflictException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import type { CorporateCall } from './corporate-access.guard';
import { CorporateSupportAccess } from './corporate-support-access.service';
import type {
  CreateSupportTicketDto,
  Priority,
  SupportNoteDto,
  SupportTicketsQuery,
  TicketInteractionsQuery,
  TicketStatus,
  TicketSort,
  UpdateSupportTicketDto,
} from './corporate-support.dto';

import { RECEIPTS_READ } from './technical-credential.service';

const ticketOrder: Record<TicketSort, Prisma.Sql> = {
  CREATED_DESC: Prisma.sql`"createdAt" DESC, id DESC`,
  CREATED_ASC: Prisma.sql`"createdAt", id`,
  UPDATED_DESC: Prisma.sql`"updatedAt" DESC, id DESC`,
  UPDATED_ASC: Prisma.sql`"updatedAt", id`,
  PRIORITY_DESC: Prisma.sql`CASE priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 2 ELSE 1 END DESC,
    "createdAt" DESC, id DESC`,
};

type Ticket = {
  id: string;
  organizationId: string;
  organizationName: string;
  origin: 'ADMINISTRATIVE' | 'BILLING';
  title: string;
  category: string;
  priority: Priority;
  status: TicketStatus;
  assigneeId: string | null;
  version: number;
  commercial: {
    subscriptionId: string;
    targetPlanCode: string | null;
    targetInterval: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

type Interaction = {
  id: string;
  kind: 'CREATED' | 'UPDATED' | 'INTERNAL_NOTE' | 'RESOLVED';
  visibility: 'INTERNAL';
  body: string | null;
  changes: Prisma.JsonValue | null;
  administratorId: string;
  createdAt: Date;
};

const tickets = Prisma.sql`
  SELECT t.id, t.organization_id AS "organizationId", o.display_name AS "organizationName",
    'ADMINISTRATIVE'::text AS origin, t.title, t.category, t.priority, t.status, t.assignee_id AS "assigneeId",
    t.version, NULL::jsonb AS commercial, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
    t.resolved_at AS "resolvedAt"
  FROM public.corporate_support_tickets t
  JOIN public.organizations o ON o.id = t.organization_id AND o.deleted_at IS NULL
  UNION ALL
  SELECT t.id, t.organization_id, o.display_name, 'BILLING',
    CASE t.kind WHEN 'PLAN_CHANGE' THEN 'Análise de alteração de plano'
      WHEN 'CANCELLATION' THEN 'Solicitação de cancelamento'
      ELSE 'Análise de reembolso' END,
    t.kind, t.support_priority, t.status, t.support_assignee_id, t.support_version,
    jsonb_build_object('subscriptionId', t.subscription_id, 'targetPlanCode', t.target_plan_code, 'targetInterval', t.target_interval),
    t.created_at, coalesce(t.support_updated_at, t.resolved_at, t.created_at), t.resolved_at
  FROM public.billing_support_tickets t
  JOIN public.organizations o ON o.id = t.organization_id AND o.deleted_at IS NULL
`;

@Injectable()
export class CorporateSupportTicketsService {
  constructor(private readonly access: CorporateSupportAccess) {}

  list(call: CorporateCall, reference: unknown, query: SupportTicketsQuery) {
    return this.access.read(
      call,
      reference,
      'SUPPORT_READ',
      null,
      async (tx) => {
        const search = query.search?.trim();
        const { page, pageSize } = query;
        const order = ticketOrder[query.sort ?? 'CREATED_DESC'];
        const [result] = await tx.$queryRaw<
          [
            {
              items: Ticket[];
              total: number;
              statusTotals?: Record<TicketStatus, number>;
            },
          ]
        >`
        WITH applicable AS MATERIALIZED (
          SELECT t.* FROM (${tickets}) t WHERE TRUE
          ${query.organizationId ? Prisma.sql`AND t."organizationId" = ${query.organizationId}::uuid` : Prisma.empty}
          ${query.assigneeId ? Prisma.sql`AND t."assigneeId" = ${query.assigneeId}::uuid` : Prisma.empty}
          ${query.origin ? Prisma.sql`AND t.origin = ${query.origin}` : Prisma.empty}
          ${query.category ? Prisma.sql`AND t.category = ${query.category}` : Prisma.empty}
          ${query.priority ? Prisma.sql`AND t.priority = ${query.priority}` : Prisma.empty}
          ${
            search
              ? Prisma.sql`AND (strpos(lower(t.title), lower(${search})) > 0
            OR strpos(lower(t."organizationName"), lower(${search})) > 0
            OR t.id::text = lower(${search}))`
              : Prisma.empty
          }
        ), matching AS MATERIALIZED (
          SELECT * FROM applicable ${query.status ? Prisma.sql`WHERE status = ${query.status}` : Prisma.empty}
        ), page AS (
          SELECT * FROM matching
          ORDER BY ${order} OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
        )
        SELECT (SELECT count(*)::int FROM matching) AS total,
          coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${order}) FROM page p), '[]'::jsonb) AS items
          ${
            query.includeDetails
              ? Prisma.sql`, (SELECT jsonb_build_object(
            'OPEN', count(*) FILTER (WHERE status = 'OPEN'),
            'RESOLVED', count(*) FILTER (WHERE status = 'RESOLVED')) FROM applicable) AS "statusTotals"`
              : Prisma.empty
          }
      `;
        return {
          ...result,
          page,
          pageSize,
          items: await this.withOrigins(
            tx,
            call,
            result.items,
            !!query.includeDetails,
          ),
        };
      },
    );
  }

  detail(
    call: CorporateCall,
    reference: unknown,
    id: string,
    query: TicketInteractionsQuery,
  ) {
    return this.access.read(call, reference, 'SUPPORT_READ', id, async (tx) => {
      const ticket = await this.find(tx, id);
      if (!ticket) return null;
      const ticketColumn =
        ticket.origin === 'BILLING'
          ? Prisma.sql`billing_ticket_id`
          : Prisma.sql`administrative_ticket_id`;
      const rows = await tx.$queryRaw<Interaction[]>`
        SELECT id, kind, 'INTERNAL'::text AS visibility, body, changes, nexus_administrator_id AS "administratorId", created_at AS "createdAt"
        FROM public.corporate_support_interactions
        WHERE organization_id = ${ticket.organizationId}::uuid
          AND ${ticketColumn} = ${id}::uuid
          ${query.before ? Prisma.sql`AND id < ${query.before}::uuid` : Prisma.empty}
        ORDER BY id DESC LIMIT 51
      `;
      const interactions = rows.slice(0, 50);
      const [item] = await this.withOrigins(
        tx,
        call,
        [ticket],
        !!query.includeDetails,
      );
      return {
        ticket: item,
        interactions,
        nextBefore: rows.length > 50 ? interactions.at(-1)!.id : null,
      };
    });
  }

  create(
    call: CorporateCall,
    reference: unknown,
    key: unknown,
    dto: CreateSupportTicketDto,
  ) {
    const input = {
      organizationId: dto.organizationId.toLowerCase(),
      title: dto.title.trim(),
      category: dto.category,
      priority: dto.priority ?? 'NORMAL',
      initialNote: dto.initialNote?.trim() ?? null,
    };
    return this.access.write(
      call,
      reference,
      'SUPPORT_CREATE',
      input.organizationId,
      key,
      input,
      async (tx, administratorId) => {
        const organization = await tx.organization.findFirst({
          where: {
            id: input.organizationId,
            deletedAt: null,
            dataPurgedAt: null,
          },
          select: { id: true },
        });
        if (!organization) throw new NotFoundException();
        const id = generateUuidV7();
        await tx.$executeRaw`
        INSERT INTO public.corporate_support_tickets (id, organization_id, title, category, priority)
        VALUES (${id}::uuid, ${input.organizationId}::uuid, ${input.title}, ${input.category}, ${input.priority})
      `;
        const interactionId = await this.interaction(
          tx,
          {
            id,
            origin: 'ADMINISTRATIVE',
            organizationId: input.organizationId,
          },
          administratorId,
          'CREATED',
          input.initialNote,
          null,
        );
        return { id, version: 1, status: 'OPEN' as const, interactionId };
      },
    );
  }

  update(
    call: CorporateCall,
    reference: unknown,
    id: string,
    key: unknown,
    dto: UpdateSupportTicketDto,
  ) {
    const input = {
      expectedVersion: dto.expectedVersion,
      priority: dto.priority,
      assigneeId: dto.assigneeId?.toLowerCase() ?? dto.assigneeId,
      status: dto.status,
      resolution: dto.resolution?.trim(),
    };
    return this.access.write(
      call,
      reference,
      'SUPPORT_UPDATE',
      id,
      key,
      input,
      async (tx, administratorId) => {
        if (
          (!input.priority &&
            input.assigneeId === undefined &&
            !input.status) ||
          Boolean(input.status) !== Boolean(input.resolution)
        )
          throw new BadRequestException(
            'Informe a alteração e inclua a resolução ao encerrar.',
          );
        const ticket = await this.lock(tx, id, input.expectedVersion);
        if (ticket.status === 'RESOLVED')
          throw new ConflictException(
            'O chamado já está encerrado.',
            'TICKET_ALREADY_RESOLVED',
          );
        const status = input.status ?? ticket.status;
        const priority = input.priority ?? ticket.priority;
        const assigneeId =
          input.assigneeId === undefined ? ticket.assigneeId : input.assigneeId;
        const changes = {
          before: {
            status: ticket.status,
            priority: ticket.priority,
            assigneeId: ticket.assigneeId,
          },
          after: { status, priority, assigneeId },
        };
        const changesStatus = status !== ticket.status;
        const interactionId = await this.interaction(
          tx,
          ticket,
          administratorId,
          changesStatus ? 'RESOLVED' : 'UPDATED',
          input.resolution ?? null,
          changes,
        );
        const version = await this.updateRow(tx, ticket, {
          status,
          priority,
          assigneeId,
        });
        return { id, version, status, interactionId };
      },
    );
  }

  note(
    call: CorporateCall,
    reference: unknown,
    id: string,
    key: unknown,
    dto: SupportNoteDto,
  ) {
    const input = {
      kind: 'INTERNAL_NOTE',
      expectedVersion: dto.expectedVersion,
      body: dto.body.trim(),
    };
    return this.access.write(
      call,
      reference,
      'SUPPORT_UPDATE',
      id,
      key,
      input,
      async (tx, administratorId) => {
        const ticket = await this.lock(tx, id, input.expectedVersion);
        const interactionId = await this.interaction(
          tx,
          ticket,
          administratorId,
          'INTERNAL_NOTE',
          input.body,
          null,
        );
        const version = await this.updateRow(tx, ticket, ticket);
        return { id, version, status: ticket.status, interactionId };
      },
    );
  }

  private async withOrigins(
    tx: PrismaTransactionClient,
    call: CorporateCall,
    tickets: Ticket[],
    includeDetails: boolean,
  ) {
    if (!includeDetails) return tickets;
    const ids = tickets
      .filter((ticket) => ticket.origin === 'BILLING')
      .map((ticket) => ticket.id);
    const rows =
      ids.length && call.principal.capabilities.includes(RECEIPTS_READ)
        ? await tx.$queryRaw<{ id: string; ticketId: string }[]>`
          SELECT c.id, t.id AS "ticketId" FROM public.corporate_commercial_commands c
          JOIN public.billing_support_tickets t ON t.id = c.origin_ticket_id
            AND t.organization_id = c.organization_id AND t.subscription_id::text = c.result->>'subscriptionId'
          WHERE c.technical_principal_id = ${call.principal.id}::uuid
            AND t.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        `
        : [];
    const origins = new Map(rows.map((row) => [row.ticketId, row.id]));
    return tickets.map((ticket) => ({
      ...ticket,
      commercial: ticket.commercial && {
        ...ticket.commercial,
        originReceiptId: origins.get(ticket.id) ?? null,
      },
    }));
  }

  private async find(tx: PrismaTransactionClient, id: string) {
    const [ticket] = await tx.$queryRaw<
      Ticket[]
    >`SELECT * FROM (${tickets}) t WHERE t.id = ${id}::uuid`;
    return ticket;
  }

  private async lock(
    tx: PrismaTransactionClient,
    id: string,
    expected: number,
  ) {
    const visible = await this.find(tx, id);
    if (!visible) throw new NotFoundException();
    const source =
      visible.origin === 'BILLING'
        ? Prisma.sql`public.billing_support_tickets`
        : Prisma.sql`public.corporate_support_tickets`;
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ${source} WHERE id = ${id}::uuid AND organization_id = ${visible.organizationId}::uuid FOR UPDATE`;
    const current = locked ? await this.find(tx, id) : null;
    if (!current) throw new NotFoundException();
    if (current.version !== expected)
      throw new ConflictException('O chamado foi atualizado.', 'STALE_VERSION');
    return current;
  }

  private async updateRow(
    tx: PrismaTransactionClient,
    ticket: Ticket,
    next: Pick<Ticket, 'status' | 'priority' | 'assigneeId'>,
  ) {
    const { id, organizationId } = ticket;
    const resolvedAt =
      next.status === 'RESOLVED' ? (ticket.resolvedAt ?? new Date()) : null;
    const [result] =
      ticket.origin === 'BILLING'
        ? await tx.$queryRaw<{ version: number }[]>`
        UPDATE public.billing_support_tickets SET status = ${next.status}, support_priority = ${next.priority},
          support_assignee_id = ${next.assigneeId}::uuid, resolved_at = ${resolvedAt},
          resolution = CASE WHEN status <> 'RESOLVED' AND ${next.status} = 'RESOLVED'
            THEN 'Encerrado pelo suporte corporativo.' ELSE resolution END,
          support_version = support_version + 1
        WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid RETURNING support_version AS version`
        : await tx.$queryRaw<{ version: number }[]>`
        UPDATE public.corporate_support_tickets SET status = ${next.status}, priority = ${next.priority}, assignee_id = ${next.assigneeId}::uuid,
          version = version + 1, updated_at = clock_timestamp(), resolved_at = ${resolvedAt}
        WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid RETURNING version`;
    if (!result) throw new NotFoundException();
    return result.version;
  }

  private async interaction(
    tx: PrismaTransactionClient,
    ticket: Pick<Ticket, 'id' | 'organizationId' | 'origin'>,
    administratorId: string,
    kind: Interaction['kind'],
    body: string | null,
    changes: Prisma.InputJsonObject | null,
  ) {
    const id = generateUuidV7();
    const billing = ticket.origin === 'BILLING';
    await tx.$executeRaw`
      INSERT INTO public.corporate_support_interactions
        (id, organization_id, administrative_ticket_id, billing_ticket_id, kind, body, changes, nexus_administrator_id)
      VALUES (${id}::uuid, ${ticket.organizationId}::uuid, ${billing ? null : ticket.id}::uuid,
        ${billing ? ticket.id : null}::uuid, ${kind}, ${body}, ${changes ? JSON.stringify(changes) : null}::jsonb, ${administratorId}::uuid)
    `;
    return id;
  }
}
