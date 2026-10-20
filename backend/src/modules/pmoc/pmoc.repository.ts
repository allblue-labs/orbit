/**
 * Persistência do domínio PMOC.
 *
 * ## O calendário é do Postgres
 *
 * `make_interval(months => 6)` a partir de 31 de agosto dá 28 de fevereiro —
 * `setMonth` em JavaScript daria 3 de março. Num plano semestral que roda por
 * anos, essa diferença acumula e a manutenção "semestral" escorrega de mês. A
 * rolagem da periodicidade acontece **em SQL**, sempre.
 *
 * ## Hoje é o dia do servidor
 *
 * `current_date` no banco. A conformidade não pode depender do relógio de quem
 * consulta: o mesmo plano precisa estar vencido para o técnico em campo e para
 * o gestor no escritório.
 *
 * ## Um ciclo por vencimento
 *
 * `INSERT … ON CONFLICT DO NOTHING` sobre `(plan_id, due_on)`: rolagem
 * disparada duas vezes — por retry da fila ou por dois cliques — produz um
 * ciclo, não dois. E como a ordem de serviço pendura no ciclo, não há como
 * nascerem duas ordens para a mesma manutenção.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RequestContextService } from '../../context';
import { ConflictException } from '../../exceptions';
import {
  PaginationHelper,
  PrismaService,
  RlsTransaction,
} from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { DomainEventEmitter } from '../automations/domain-event.emitter';
import {
  buildSuggestedCode,
  plannedExecutionCount,
  toDateOnly,
} from './pmoc.domain';
import type { FrequencyUnit } from './pmoc.domain';
import type {
  PmocAnalyticsQueryDto,
  PmocPlanQueryDto,
  PmocUpcomingQueryDto,
} from './pmoc.dto';

const planView = {
  id: true,
  code: true,
  name: true,
  status: true,
  notes: true,
  startsOn: true,
  endsOn: true,
  frequencyAmount: true,
  frequencyUnit: true,
  dueSoonDays: true,
  technicalResponsibleUserId: true,
  serviceLocation: true,
  scope: true,
  serviceTypes: true,
  procedure: true,
  schedulingPaused: true,
  reviewRequired: true,
  lastExecutedAt: true,
  nextDueOn: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  businessUnit: { select: { id: true, legalName: true, tradeName: true } },
  customer: { select: { id: true, legalName: true, tradeName: true } },
  technician: { select: { id: true, displayName: true } },
  technicalResponsible: { select: { id: true, displayName: true } },
  createdBy: { select: { id: true, displayName: true } },
  _count: {
    select: { coverages: { where: { deletedAt: null } } },
  },
} satisfies Prisma.PmocPlanSelect;

/**
 * O roteiro vem junto da unidade em toda leitura.
 *
 * Não é conveniência: é o que diz se a unidade tem algo a descrever no
 * relatório. `create` e `update` usam o mesmo include porque uma resposta de
 * escrita com forma diferente da leitura obrigaria o cliente a recarregar para
 * saber o que acabou de gravar.
 */
const unitView = {
  checklistTemplate: { select: { id: true, name: true, items: true } },
} satisfies Prisma.PmocUnitInclude;

const coverageView = {
  id: true,
  startsOn: true,
  endsOn: true,
  notes: true,
  asset: {
    select: {
      id: true,
      name: true,
      category: true,
      identifier: true,
      serialNumber: true,
      status: true,
    },
  },
} satisfies Prisma.PmocEquipmentCoverageSelect;

const executionView = {
  id: true,
  sequenceNumber: true,
  dueOn: true,
  status: true,
  performedAt: true,
  notes: true,
  schedulingEventId: true,
  createdAt: true,
  completedBy: { select: { id: true, displayName: true } },
  operation: { select: { id: true, code: true, status: true } },
  artifactExecution: { select: { id: true, code: true, status: true } },
} satisfies Prisma.PmocExecutionSelect;

const equipmentExecutionView = {
  id: true,
  status: true,
  /* A posição desta execução na história **deste** equipamento no plano. */
  sequenceNumber: true,
  performedAt: true,
  startedAt: true,
  completedAt: true,
  notes: true,
  procedureSnapshot: true,
  technicalResponsibleSnapshot: true,
  asset: {
    select: {
      id: true,
      name: true,
      identifier: true,
      serialNumber: true,
      category: true,
    },
  },
  responsibleFieldTechnician: { select: { id: true, displayName: true } },
  operation: {
    select: {
      id: true,
      code: true,
      status: true,
      auxiliaryTechnicians: {
        where: { removedAt: null },
        select: { user: { select: { id: true, displayName: true } } },
      },
    },
  },
  artifactExecution: { select: { id: true, code: true, status: true } },
  evidence: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      kind: true,
      caption: true,
      createdAt: true,
      storageFile: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.PmocEquipmentExecutionSelect;

export type PlanRecord = Prisma.PmocPlanGetPayload<{ select: typeof planView }>;

/** Uma unidade como o plano a declarou, com o roteiro dela. */
export type PlanUnitRecord = Prisma.PmocUnitGetPayload<{
  include: typeof unitView;
}>;
export type CoverageRecord = Prisma.PmocEquipmentCoverageGetPayload<{
  select: typeof coverageView;
}>;
export type ExecutionRecord = Prisma.PmocExecutionGetPayload<{
  select: typeof executionView;
}>;
export type EquipmentExecutionRecord = Prisma.PmocEquipmentExecutionGetPayload<{
  select: typeof equipmentExecutionView;
}>;

export interface CreatePlanData {
  organizationId: string;
  businessUnitId: string;
  customerId: string;
  /** `null` quando o produto deve gerar — a alocação é atômica com o insert. */
  code: string | null;
  /** Só para montar o código gerado; identidade continua sendo o UUID. */
  customerName: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
  frequencyAmount: number;
  frequencyUnit: FrequencyUnit;
  dueSoonDays: number;
  technicianUserId: string | null;
  technicalResponsibleUserId: string | null;
  serviceLocation?: Prisma.InputJsonValue;
  scope?: Prisma.InputJsonValue;
  serviceTypes: Prisma.InputJsonValue;
  procedure: Prisma.InputJsonValue;
  schedulingPaused: boolean;
  reviewRequired: boolean;
  notes: string | null;
  createdById: string;
  /** Equipamentos que participam do plano desde a criação. */
  assetIds?: readonly string[];
  /// As unidades que o plano declara — o que o relatório final lista.
  unitIds?: readonly string[];
}

@Injectable()
export class PmocRepository {
  private readonly logger = new Logger(PmocRepository.name);

  constructor(
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextService,
    /**
     * Os eventos saem **de dentro da transação do domínio**.
     *
     * É o padrão outbox já usado por operações, orçamentos e estoque: ou o fato
     * e o evento acontecem juntos, ou nenhum dos dois. Emitir depois do commit
     * abriria a janela em que a manutenção foi registrada e a automação nunca
     * soube.
     */
    private readonly events: DomainEventEmitter,
    /**
     * Conexão sem contexto de inquilino, para o acesso por token.
     *
     * Quem abre o link de assinatura não tem sessão: não há organização no contexto,
     * e a política de `pmoc_plan_signature_links` não teria como ser satisfeita. As
     * duas funções `SECURITY DEFINER` da PR-58 são o caminho estreito disso, e elas
     * são chamadas por aqui — fora da transação de RLS, porque não há inquilino a
     * declarar. A credencial é o token, e a validação dele é dentro da função.
     */
    private readonly prisma: PrismaService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Link de assinatura do contrato                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Cria o link e revoga o anterior, na mesma transação.
   *
   * A revogação vem antes por necessidade, não por estilo: o índice parcial
   * `pmoc_signature_links_pending_unique` recusa um segundo link pendente do mesmo
   * plano, e é ele que garante a regra quando duas telas pedem link ao mesmo tempo.
   * Revogar depois de inserir seria tentar inserir contra o índice.
   *
   * Links já assinados não são tocados: eles são a prova de uma assinatura coletada,
   * e gerar um link novo não apaga o que o contratante assinou.
   */
  createSignatureLink(data: {
    organizationId: string;
    planId: string;
    tokenHash: string;
    expiresAt: Date;
    createdById: string;
  }) {
    return this.rls.run(async (tx) => {
      await tx.pmocPlanSignatureLink.updateMany({
        where: {
          planId: data.planId,
          organizationId: data.organizationId,
          revokedAt: null,
          signedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      return tx.pmocPlanSignatureLink.create({
        data: {
          organizationId: data.organizationId,
          planId: data.planId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          createdById: data.createdById,
        },
        select: { id: true, expiresAt: true, createdAt: true },
      });
    });
  }

  /** A assinatura coletada mais recente do plano — a que vai no contrato. */
  latestSignature(planId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocPlanSignatureLink.findFirst({
        where: { planId, organizationId, signedAt: { not: null } },
        orderBy: { signedAt: 'desc' },
        select: {
          signerName: true,
          signerDocument: true,
          signedAt: true,
          signatureFile: {
            select: { bucket: true, objectKey: true, mimeType: true },
          },
        },
      }),
    );
  }

  /**
   * O contrato que o token abre — pela função estreita, sem inquilino no contexto.
   *
   * Linha ausente significa token que não existe. A função distingue isso de token
   * malformado, que ela recusa com erro: um `LIKE` acidental não varre a tabela.
   */
  async signatureLinkByToken(tokenHash: string) {
    const rows = await this.prisma.$queryRaw<
      {
        state: string;
        plan_code: string;
        plan_name: string;
        starts_on: Date;
        ends_on: Date | null;
        frequency_amount: number;
        frequency_unit: string;
        customer_name: string;
        emitter_name: string;
        covered_equipment: number;
        technical_responsible: string | null;
        signer_name: string | null;
        signed_at: Date | null;
        expires_at: Date;
      }[]
    >`SELECT * FROM app_pmoc_signature_link_read(${tokenHash})`;
    return rows[0] ?? null;
  }

  /** Registra a assinatura do contratante — arquivo e marca, na mesma transação. */
  async signByToken(input: {
    tokenHash: string;
    signerName: string;
    signerDocument?: string;
    signerEmail?: string;
    ip?: string;
    userAgent?: string;
    bucket: string;
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<{ state: string; signed: boolean }> {
    const rows = await this.prisma.$queryRaw<
      { state: string; signed: boolean }[]
    >`SELECT * FROM app_pmoc_signature_link_sign(
        ${input.tokenHash},
        ${input.signerName},
        ${input.signerDocument ?? null},
        ${input.signerEmail ?? null},
        ${input.ip ?? null},
        ${input.userAgent ?? null},
        ${input.bucket},
        ${input.objectKey},
        ${input.mimeType},
        ${input.sizeBytes}::bigint,
        ${input.sha256}
      )`;
    return rows[0] ?? { state: 'INEXISTENTE', signed: false };
  }

  /* ---------------------------------------------------------------- */
  /* Planos                                                            */
  /* ---------------------------------------------------------------- */

  create(data: CreatePlanData, actorId: string) {
    return this.rls.run(async (tx) => {
      /**
       * O código nasce **aqui dentro**, quando não veio um customizado.
       *
       * Pedir a sugestão e depois criar com ela é uma corrida perdida: quatro
       * telas abertas leem `002` e três falham ao salvar. A sugestão é só uma
       * previsão; quem consome o número é esta transação, e o incremento
       * acontece na mesma que insere o plano.
       */
      const code = data.code ?? (await this.nextCode(tx, data));

      const plan = await tx.pmocPlan.create({
        data: {
          organizationId: data.organizationId,
          businessUnitId: data.businessUnitId,
          customerId: data.customerId,
          code,
          name: data.name,
          startsOn: new Date(`${data.startsOn}T00:00:00.000Z`),
          endsOn: data.endsOn ? new Date(`${data.endsOn}T00:00:00.000Z`) : null,
          frequencyAmount: data.frequencyAmount,
          frequencyUnit: data.frequencyUnit,
          dueSoonDays: data.dueSoonDays,
          technicianUserId: data.technicianUserId,
          technicalResponsibleUserId: data.technicalResponsibleUserId,
          serviceLocation: data.serviceLocation,
          scope: data.scope,
          serviceTypes: data.serviceTypes,
          procedure: data.procedure,
          schedulingPaused: data.schedulingPaused,
          reviewRequired: data.reviewRequired,
          notes: data.notes,
          createdById: data.createdById,
        },
        select: planView,
      });

      /**
       * As coberturas nascem **dentro da mesma transação**.
       *
       * Antes o plano era criado num comando e os equipamentos em outro. Entre
       * os dois existia um plano operacional sem equipamento nenhum — e, se o
       * segundo comando falhasse, ele ficava assim. Um PMOC sem equipamento
       * não projeta execução: é um plano que não manda ninguém a lugar nenhum.
       */
      if (data.assetIds?.length) {
        await tx.pmocEquipmentCoverage.createMany({
          data: data.assetIds.map((assetId) => ({
            id: generateUuidV7(),
            organizationId: data.organizationId,
            planId: plan.id,
            assetId,
            startsOn: new Date(`${data.startsOn}T00:00:00.000Z`),
            endsOn: null,
          })),
        });
      }

      /**
       * As unidades declaradas, na mesma transação, pela mesma razão.
       *
       * Unidade descreve o serviço — é o que o relatório final lista. Um
       * plano criado sem elas e completado depois existiria, no intervalo,
       * como um PMOC que não diz o que faz.
       */
      if (data.unitIds?.length) {
        await tx.pmocPlanUnit.createMany({
          data: data.unitIds.map((unitId) => ({
            id: generateUuidV7(),
            planId: plan.id,
            unitId,
          })),
        });
      }

      await this.audit(
        tx,
        plan.id,
        data.organizationId,
        actorId,
        'PMOC_PLAN_CREATED',
        {
          code,
          name: data.name,
          equipmentCount: data.assetIds?.length ?? 0,
          unitCount: data.unitIds?.length ?? 0,
        },
      );
      return plan;
    });
  }

  /**
   * Aloca e devolve o próximo código livre, dentro da transação recebida.
   *
   * O `ON CONFLICT DO UPDATE` incrementa e devolve na mesma instrução: duas
   * transações concorrentes serializam na linha do contador e recebem valores
   * diferentes. Nenhuma precisa de retry no cliente.
   */
  private async nextCode(
    tx: PrismaTransactionClient,
    data: Pick<
      CreatePlanData,
      'organizationId' | 'customerId' | 'customerName'
    >,
  ): Promise<string> {
    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      const linhas = await tx.$queryRaw<{ last_value: number }[]>`
        INSERT INTO pmoc_code_sequences (organization_id, customer_id, last_value, updated_at)
        VALUES (${data.organizationId}::uuid, ${data.customerId}::uuid, 1, now())
        ON CONFLICT (organization_id, customer_id) DO UPDATE
          SET last_value = pmoc_code_sequences.last_value + 1,
              updated_at = now()
        RETURNING last_value
      `;
      const candidato = buildSuggestedCode(
        data.customerName,
        linhas[0]?.last_value ?? 1,
      );

      /**
       * O número pode estar ocupado por um código digitado à mão. Avança —
       * consumindo a sequência, para que o próximo create não tropece no
       * mesmo — em vez de devolver um código que a constraint recusaria.
       */
      const ocupado = await tx.pmocPlan.findFirst({
        where: {
          organizationId: data.organizationId,
          code: candidato,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!ocupado) return candidato;
    }
    throw new ConflictException(
      'Could not allocate a free PMOC code for this customer',
    );
  }

  /**
   * O próximo número da sequência do cliente — e o código que sai dele.
   *
   * ## Por que não é `COUNT(*) + 1`
   *
   * A unicidade do código é parcial: `pmoc_plans_code_unique_active` só vale
   * onde `deleted_at IS NULL`. Contar planos devolveria um número já usado no
   * instante em que alguém apagasse um, e o histórico ganharia dois
   * `PMOC-CLIENTE-003` distintos.
   *
   * O `ON CONFLICT DO UPDATE` incrementa e devolve na mesma instrução: duas
   * transações concorrentes serializam na linha e recebem valores diferentes.
   * Nenhuma delas precisa de retry no cliente.
   *
   * [reserve] separa as duas necessidades do §22: a sugestão só **lê** o
   * próximo número, e o create **consome** um. Uma tela aberta e abandonada
   * não deve queimar `007` para sempre.
   */
  allocateCode(input: {
    organizationId: string;
    customerId: string;
    customerName: string;
    reserve: boolean;
  }) {
    return this.rls.run(async (tx) => {
      let sequencia: number;

      if (input.reserve) {
        const linhas = await tx.$queryRaw<{ last_value: number }[]>`
          INSERT INTO pmoc_code_sequences (organization_id, customer_id, last_value, updated_at)
          VALUES (${input.organizationId}::uuid, ${input.customerId}::uuid, 1, now())
          ON CONFLICT (organization_id, customer_id) DO UPDATE
            SET last_value = pmoc_code_sequences.last_value + 1,
                updated_at = now()
          RETURNING last_value
        `;
        sequencia = linhas[0]?.last_value ?? 1;
      } else {
        const linhas = await tx.$queryRaw<{ last_value: number }[]>`
          SELECT last_value FROM pmoc_code_sequences
           WHERE organization_id = ${input.organizationId}::uuid
             AND customer_id = ${input.customerId}::uuid
        `;
        sequencia = (linhas[0]?.last_value ?? 0) + 1;
      }

      /**
       * O contador pode apontar para um número já ocupado por um código
       * digitado à mão. Avança até achar livre, e leva o contador junto quando
       * está reservando — senão a próxima chamada tropeçaria no mesmo.
       */
      for (let tentativa = 0; tentativa < 50; tentativa += 1) {
        const candidato = buildSuggestedCode(input.customerName, sequencia);
        const existente = await tx.pmocPlan.findFirst({
          where: {
            organizationId: input.organizationId,
            code: candidato,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!existente) {
          if (input.reserve && tentativa > 0) {
            await tx.$executeRaw`
              UPDATE pmoc_code_sequences
                 SET last_value = GREATEST(last_value, ${sequencia}), updated_at = now()
               WHERE organization_id = ${input.organizationId}::uuid
                 AND customer_id = ${input.customerId}::uuid
            `;
          }
          return { code: candidato, sequence: sequencia };
        }
        sequencia += 1;
      }

      return {
        code: buildSuggestedCode(input.customerName, sequencia),
        sequence: sequencia,
      };
    });
  }

  /**
   * Estes equipamentos são mesmo deste cliente?
   *
   * A pergunta é do backend, não da tela. O seletor já mostra só o que é do
   * cliente, mas quem manda o corpo da requisição é quem quiser — e um
   * `assetId` de outro cliente entraria como cobertura sem esta checagem.
   */
  findEligibleAssets(input: {
    organizationId: string;
    customerId: string;
    assetIds: readonly string[];
  }) {
    return this.rls.run((tx) =>
      tx.asset.findMany({
        where: {
          id: { in: [...input.assetIds] },
          organizationId: input.organizationId,
          customerId: input.customerId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          status: true,
          model: true,
          manufacturer: true,
          location: true,
          customerId: true,
        },
      }),
    );
  }

  update(
    id: string,
    organizationId: string,
    actorId: string,
    data: Prisma.PmocPlanUpdateInput,
    action: string,
    before: Record<string, unknown>,
  ) {
    return this.rls.run(async (tx) => {
      const plan = await tx.pmocPlan.update({
        where: { id },
        data,
        select: planView,
      });
      await this.audit(tx, id, organizationId, actorId, action, before, {
        status: plan.status,
        nextDueOn: plan.nextDueOn,
      });
      return plan;
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      await this.expireStale(tx, organizationId);
      const plan = await tx.pmocPlan.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: planView,
      });
      if (!plan) {
        await this.logNotFoundContext(tx, 'PmocPlan', id, organizationId);
      }
      return plan;
    });
  }

  /**
   * Listagem, com o filtro de conformidade **resolvido no banco**.
   *
   * `compliance` não é coluna: é a comparação entre `next_due_on`,
   * `current_date` e a antecedência do plano. Filtrar por ela em memória
   * exigiria trazer todos os planos para descartar a maioria — e a página
   * devolvida seria a errada.
   */
  list(organizationId: string, query: PmocPlanQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);

    return this.rls.run(async (tx) => {
      await this.expireStale(tx, organizationId);

      const filters = Prisma.sql`
        p.organization_id = ${organizationId}::uuid
        AND p.deleted_at IS NULL
        ${query.status ? Prisma.sql`AND p.status = ${query.status}` : Prisma.empty}
        ${query.businessUnitId ? Prisma.sql`AND p.business_unit_id = ${query.businessUnitId}::uuid` : Prisma.empty}
        ${query.customerId ? Prisma.sql`AND p.customer_id = ${query.customerId}::uuid` : Prisma.empty}
        ${
          query.search
            ? Prisma.sql`AND (p.name ILIKE ${`%${query.search}%`} OR p.code ILIKE ${`%${query.search}%`})`
            : Prisma.empty
        }
        ${
          query.dueUntil
            ? Prisma.sql`AND p.next_due_on IS NOT NULL AND p.next_due_on <= ${query.dueUntil}::date`
            : Prisma.empty
        }
        ${
          query.assetId
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM pmoc_equipment_coverages c
                 WHERE c.plan_id = p.id AND c.deleted_at IS NULL
                   AND c.asset_id = ${query.assetId}::uuid
              )`
            : Prisma.empty
        }
        ${query.compliance ? Prisma.sql`AND ${this.complianceFilter(query.compliance)}` : Prisma.empty}
      `;

      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT p.id
          FROM pmoc_plans p
         WHERE ${filters}
         ORDER BY p.next_due_on ASC NULLS LAST, p.created_at DESC
         LIMIT ${pagination.limit} OFFSET ${(pagination.page - 1) * pagination.limit}
      `;
      const counted = await tx.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM pmoc_plans p WHERE ${filters}
      `;
      const total = counted[0]?.total ?? 0n;

      const ids = rows.map((row) => row.id);
      const plans = ids.length
        ? await tx.pmocPlan.findMany({
            where: { id: { in: ids } },
            select: planView,
          })
        : [];

      /** A ordem é a do SQL; `findMany` não a preserva. */
      const byId = new Map(plans.map((plan) => [plan.id, plan]));
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((plan): plan is PlanRecord => Boolean(plan));

      return PaginationHelper.result(ordered, Number(total), pagination);
    });
  }

  /** O predicado de conformidade, em SQL — a mesma régua de `evaluateCompliance`. */
  private complianceFilter(status: string) {
    switch (status) {
      case 'OVERDUE':
        return Prisma.sql`(p.status = 'ACTIVE' AND p.next_due_on IS NOT NULL AND p.next_due_on < current_date)`;
      case 'DUE_SOON':
        return Prisma.sql`(
          p.status = 'ACTIVE' AND p.next_due_on IS NOT NULL
          AND p.next_due_on >= current_date
          AND p.next_due_on <= current_date + (p.due_soon_days || ' days')::interval
        )`;
      case 'UP_TO_DATE':
        return Prisma.sql`(
          p.status = 'ACTIVE' AND p.next_due_on IS NOT NULL
          AND p.next_due_on > current_date + (p.due_soon_days || ' days')::interval
        )`;
      default:
        return Prisma.sql`(p.status <> 'ACTIVE' OR p.next_due_on IS NULL)`;
    }
  }

  /**
   * Vencimento de vigência, aplicado na leitura.
   *
   * Um plano cuja vigência acabou não pode continuar `ACTIVE` só porque ninguém
   * abriu a tela. A varredura é barata — atinge apenas o que já passou — e roda
   * antes de listar e de detalhar, como o Commercial Engine faz com propostas
   * vencidas.
   */
  private async expireStale(
    tx: PrismaTransactionClient,
    organizationId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE pmoc_plans
         SET status = 'EXPIRED', updated_at = now()
       WHERE organization_id = ${organizationId}::uuid
         AND deleted_at IS NULL
         AND status = 'ACTIVE'
         AND ends_on IS NOT NULL
         AND ends_on < current_date
    `;
  }

  /** Planos cuja vigência acabou — devolvidos para o job emitir os eventos. */
  expireDue(organizationId: string) {
    return this.rls.run((tx) => this.expireStale(tx, organizationId));
  }

  /* ---------------------------------------------------------------- */
  /* Periodicidade e vencimento                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Ativa o plano e define o primeiro vencimento.
   *
   * O primeiro vencimento é o **início da vigência**, não "hoje mais um
   * período": um plano que começou em janeiro e foi cadastrado em março já
   * devia uma manutenção de janeiro, e mostrá-lo em dia esconderia o atraso.
   */
  activate(id: string, organizationId: string, actorId: string) {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; next_due_on: Date }[]>`
        UPDATE pmoc_plans
           SET status = 'ACTIVE',
               activated_at = COALESCE(activated_at, now()),
               next_due_on = COALESCE(next_due_on, starts_on),
               updated_at = now()
         WHERE id = ${id}::uuid
           AND organization_id = ${organizationId}::uuid
           AND deleted_at IS NULL
           AND status IN ('DRAFT', 'SUSPENDED')
           AND EXISTS (
             SELECT 1
               FROM pmoc_equipment_coverages coverage
              WHERE coverage.plan_id = pmoc_plans.id
                AND coverage.organization_id = pmoc_plans.organization_id
                AND coverage.deleted_at IS NULL
           )
        RETURNING id, next_due_on
      `;
      if (rows.length === 0) return null;

      const cycles = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO pmoc_executions (
          id, organization_id, plan_id, due_on, status, sequence_number, updated_at
        ) VALUES (
          ${generateUuidV7()}::uuid, ${organizationId}::uuid,
          ${id}::uuid, ${rows[0]!.next_due_on}::date, 'PENDING',
          COALESCE((SELECT max(sequence_number)+1 FROM pmoc_executions WHERE plan_id=${id}::uuid),1), now()
        )
        ON CONFLICT (plan_id, due_on) DO UPDATE
          SET updated_at = pmoc_executions.updated_at
        RETURNING id
      `;
      const executionId = cycles[0]!.id;

      await this.audit(
        tx,
        id,
        organizationId,
        actorId,
        'PMOC_PLAN_ACTIVATED',
        {},
        {
          nextDueOn: rows[0]?.next_due_on,
        },
      );

      const plan = await tx.pmocPlan.findFirstOrThrow({
        where: { id },
        select: planView,
      });

      await this.events.emit(tx, {
        type: 'pmoc.plan.activated',
        organizationId,
        businessUnitId: plan.businessUnit.id,
        actorId,
        entityType: 'PMOC_PLAN',
        entityId: plan.id,
        payload: {
          code: plan.code,
          businessUnitId: plan.businessUnit.id,
          customerId: plan.customer.id,
          frequencyUnit: plan.frequencyUnit,
          nextDueOn: plan.nextDueOn
            ? plan.nextDueOn.toISOString().slice(0, 10)
            : '',
        },
      });

      return { plan, executionId };
    });
  }

  /**
   * Fecha um ciclo e rola a periodicidade.
   *
   * Tudo numa transação: o ciclo vira `COMPLETED`, o plano recebe a data da
   * execução e o próximo vencimento **calculado pelo Postgres a partir dessa
   * data**, e o ciclo seguinte nasce. Em três instruções separadas, uma falha
   * no meio deixaria um plano concluído sem próximo vencimento — em dia para
   * sempre.
   */
  completeExecution(input: {
    executionId: string;
    planId: string;
    organizationId: string;
    actorId: string;
    performedAt: Date;
    artifactExecutionId: string | null;
    notes: string | null;
  }) {
    return this.rls.run(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE pmoc_executions
           SET status = 'COMPLETED',
               performed_at = ${input.performedAt},
               completed_by_id = ${input.actorId}::uuid,
               notes = COALESCE(${input.notes}, notes),
               artifact_execution_id = COALESCE(${input.artifactExecutionId}::uuid, artifact_execution_id),
               updated_at = now()
         WHERE id = ${input.executionId}::uuid
           AND organization_id = ${input.organizationId}::uuid
           AND status = 'PENDING'
        RETURNING id
      `;

      /** Já concluído: outra requisição chegou primeiro. */
      if (claimed.length === 0) return null;

      const rolled = await tx.$queryRaw<{ next_due_on: Date }[]>`
        UPDATE pmoc_plans
           SET last_executed_at = ${input.performedAt},
               next_due_on = (${input.performedAt}::date + make_interval(
                 years  => CASE WHEN frequency_unit = 'YEARS'  THEN frequency_amount ELSE 0 END,
                 months => CASE WHEN frequency_unit = 'MONTHS' THEN frequency_amount ELSE 0 END,
                 weeks  => CASE WHEN frequency_unit = 'WEEKS'  THEN frequency_amount ELSE 0 END,
                 days   => CASE WHEN frequency_unit = 'DAYS'   THEN frequency_amount ELSE 0 END
               ))::date,
               /** O aviso do vencimento novo ainda não foi dado. */
               due_soon_notified_for = NULL,
               overdue_notified_for = NULL,
               updated_at = now()
         WHERE id = ${input.planId}::uuid
           AND organization_id = ${input.organizationId}::uuid
        RETURNING next_due_on
      `;

      const nextDueOn = rolled[0]?.next_due_on ?? null;

      /**
       * O ciclo seguinte nasce junto — mas só enquanto a vigência alcançar.
       *
       * Um plano que termina em dezembro não abre ciclo para janeiro: seria uma
       * manutenção prevista para depois do fim do contrato.
       */
      if (nextDueOn) {
        await tx.$executeRaw`
          INSERT INTO pmoc_executions (
            id, organization_id, plan_id, due_on, status, sequence_number, updated_at
          )
          SELECT ${generateUuidV7()}::uuid, ${input.organizationId}::uuid,
                 ${input.planId}::uuid, ${nextDueOn}::date, 'PENDING',
                 COALESCE((SELECT max(sequence_number)+1 FROM pmoc_executions WHERE plan_id=${input.planId}::uuid),1), now()
            FROM pmoc_plans p
           WHERE p.id = ${input.planId}::uuid
             AND (p.ends_on IS NULL OR p.ends_on >= ${nextDueOn}::date)
          ON CONFLICT DO NOTHING
        `;
      }

      await this.audit(
        tx,
        input.planId,
        input.organizationId,
        input.actorId,
        'PMOC_EXECUTION_COMPLETED',
        {},
        { executionId: input.executionId, nextDueOn },
      );

      const plan = await tx.pmocPlan.findFirstOrThrow({
        where: { id: input.planId },
        select: planView,
      });

      await this.events.emit(tx, {
        type: 'pmoc.execution.completed',
        organizationId: input.organizationId,
        businessUnitId: plan.businessUnit.id,
        actorId: input.actorId,
        entityType: 'PMOC_PLAN',
        entityId: plan.id,
        payload: {
          code: plan.code,
          businessUnitId: plan.businessUnit.id,
          customerId: plan.customer.id,
          nextDueOn: nextDueOn ? nextDueOn.toISOString().slice(0, 10) : '',
        },
      });

      return { nextDueOn };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Ciclos                                                            */
  /* ---------------------------------------------------------------- */

  /** Abre o ciclo do vencimento atual, se ainda não existir. */
  openCycle(organizationId: string, planId: string, dueOn: Date) {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO pmoc_executions (
          id, organization_id, plan_id, due_on, status, sequence_number, updated_at
        ) VALUES (
          ${generateUuidV7()}::uuid, ${organizationId}::uuid,
          ${planId}::uuid, ${dueOn}::date, 'PENDING',
          COALESCE((SELECT max(sequence_number)+1 FROM pmoc_executions WHERE plan_id=${planId}::uuid),1), now()
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (rows[0]) return rows[0].id;

      const existing = await tx.pmocExecution.findFirst({
        where: { planId, dueOn, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      return existing?.id ?? null;
    });
  }

  currentExecution(planId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocExecution.findFirst({
        where: { planId, organizationId, status: 'PENDING' },
        select: executionView,
        orderBy: { dueOn: 'asc' },
      }),
    );
  }

  findExecution(id: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const execution = await tx.pmocExecution.findFirst({
        where: { id, organizationId },
        select: { ...executionView, planId: true },
      });
      if (!execution) {
        await this.logNotFoundContext(tx, 'PmocExecution', id, organizationId);
      }
      return execution;
    });
  }

  private async logNotFoundContext(
    tx: PrismaTransactionClient,
    entity: 'PmocPlan' | 'PmocExecution',
    entityId: string,
    expectedOrganizationId: string,
  ): Promise<void> {
    const [probe] = await tx.$queryRaw<
      {
        role: string;
        organization: string | null;
        units: string | null;
        actor: string | null;
      }[]
    >`
      SELECT current_user::text AS role,
             NULLIF(current_setting('app.organization_id', true), '') AS organization,
             NULLIF(current_setting('app.business_unit_ids', true), '') AS units,
             NULLIF(current_setting('app.actor_id', true), '') AS actor
    `;
    const context = this.contexts.getOptional();
    this.logger.warn(
      JSON.stringify({
        stage: 'pmoc-not-found',
        entity,
        entityId,
        requestId: context?.requestId ?? null,
        actorId: context?.userId ?? null,
        expectedOrganizationId,
        requestOrganizationId: context?.organizationId ?? null,
        requestBusinessUnitId: context?.businessUnitId ?? null,
        requestBusinessUnitIds: context?.businessUnitIds ?? [],
        databaseRole: probe?.role ?? null,
        rlsOrganizationId: probe?.organization ?? null,
        rlsBusinessUnitIds: probe?.units?.split(',').filter(Boolean) ?? [],
        rlsActorId: probe?.actor ?? null,
      }),
    );
  }

  listExecutions(planId: string, organizationId: string, limit = 20) {
    return this.rls.run((tx) =>
      tx.pmocExecution.findMany({
        where: { planId, organizationId },
        select: executionView,
        orderBy: [{ dueOn: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      }),
    );
  }

  attachEvidence(executionId: string, artifactExecutionId: string) {
    return this.rls
      .run((tx) =>
        tx.pmocExecution.update({
          where: { id: executionId },
          data: { artifactExecutionId },
          select: { id: true },
        }),
      )
      .then(() => undefined);
  }

  attachSchedulingEvent(executionId: string, schedulingEventId: string) {
    return this.rls
      .run((tx) =>
        tx.pmocExecution.update({
          where: { id: executionId },
          data: { schedulingEventId },
          select: { id: true },
        }),
      )
      .then(() => undefined);
  }

  /**
   * Cria a ordem de serviço do ciclo, uma vez só.
   *
   * `pg_advisory_xact_lock` serializa duas chamadas concorrentes para o mesmo
   * ciclo; a segunda encontra `operation_id` preenchido e devolve o que existe.
   * Sem a trava, as duas passariam pela checagem e o índice único de código de
   * operação derrubaria uma delas com 500 em vez do resultado certo — é a mesma
   * defesa da conversão de orçamento.
   */
  createOperation(input: {
    executionId: string;
    organizationId: string;
    businessUnitId: string;
    customerId: string;
    assetId: string | null;
    actorId: string;
    code: string;
    kind: string;
    title: string;
    description: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:operation:${input.executionId}`}))`;

      const current = await tx.pmocExecution.findFirstOrThrow({
        where: { id: input.executionId },
        select: { operationId: true },
      });
      if (current.operationId) {
        return { operationId: current.operationId, created: false };
      }

      const operation = await tx.operation.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          /** O PMOC gera a ordem de um equipamento — a lista tem um só. */
          assets: input.assetId
            ? { create: [{ assetId: input.assetId }] }
            : undefined,
          code: input.code,
          kind: input.kind,
          title: input.title,
          description: input.description,
          status: input.scheduledStart ? 'SCHEDULED' : 'OPEN',
          priority: 'NORMAL',
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          createdById: input.actorId,
        },
        select: { id: true, code: true, status: true },
      });

      await tx.operationHistory.create({
        data: {
          operationId: operation.id,
          userId: input.actorId,
          action: 'CREATED',
          toStatus: operation.status,
          details: { source: 'pmoc', executionId: input.executionId },
        },
      });

      await tx.pmocExecution.update({
        where: { id: input.executionId },
        data: { operationId: operation.id },
      });

      return { operationId: operation.id, created: true, operation };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Execução física por equipamento (V2)                             */
  /* ---------------------------------------------------------------- */

  executionPreparation(
    organizationId: string,
    planId: string,
    cycleId: string,
    assetId: string,
  ) {
    return this.rls.run(async (tx) => {
      const plan = await tx.pmocPlan.findFirst({
        where: { id: planId, organizationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          businessUnitId: true,
          customer: { select: { id: true, legalName: true, tradeName: true } },
          procedure: true,
          serviceLocation: true,
          scope: true,
          serviceTypes: true,
          reviewRequired: true,
          technicalResponsible: { select: { id: true, displayName: true } },
          technicalResponsibleUserId: true,
          /* A atribuição operacional: quem atende este contrato. É ela que
             autoriza o técnico a abrir o atendimento dele pelo celular. */
          technicianUserId: true,
        },
      });
      if (!plan) return null;
      const cycle = await tx.pmocExecution.findFirst({
        where: { id: cycleId, planId, organizationId },
        select: { id: true, dueOn: true, status: true, sequenceNumber: true },
      });
      const coverage = await tx.pmocEquipmentCoverage.findFirst({
        where: { planId, organizationId, assetId, deletedAt: null },
        select: {
          id: true,
          startsOn: true,
          endsOn: true,
          asset: {
            select: {
              id: true,
              name: true,
              category: true,
              identifier: true,
              serialNumber: true,
              status: true,
              manufacturer: true,
              model: true,
              location: true,
              specifications: true,
            },
          },
        },
      });
      if (!cycle || !coverage) return null;
      const existing = await tx.pmocEquipmentExecution.findUnique({
        where: { cycleId_coverageId: { cycleId, coverageId: coverage.id } },
        select: equipmentExecutionView,
      });
      const signature = plan.technicalResponsibleUserId
        ? await tx.userSignature.findFirst({
            where: {
              organizationId,
              userId: plan.technicalResponsibleUserId,
              active: true,
              revokedAt: null,
            },
            select: {
              id: true,
              storageObjectId: true,
              version: true,
              sha256: true,
            },
          })
        : null;
      const credential = plan.technicalResponsibleUserId
        ? await tx.professionalCredential.findFirst({
            where: {
              organizationId,
              userId: plan.technicalResponsibleUserId,
              active: true,
              revokedAt: null,
            },
            orderBy: { createdAt: 'asc' },
            select: {
              type: true,
              registrationNumber: true,
              region: true,
              issuingAuthority: true,
              displayLabel: true,
            },
          })
        : null;
      return {
        plan,
        cycle,
        coverage,
        existing,
        technicalResponsibleSignature: signature,
        technicalResponsibleCredential: credential,
      };
    });
  }

  /** O ciclo, para a lista saber em que estado ele está. */
  findCycle(organizationId: string, planId: string, cycleId: string) {
    return this.rls.run((tx) =>
      tx.pmocExecution.findFirst({
        where: { id: cycleId, planId, organizationId },
        select: { id: true, status: true },
      }),
    );
  }

  listEquipmentExecutions(
    organizationId: string,
    planId: string,
    cycleId: string,
  ) {
    return this.rls.run((tx) =>
      tx.pmocEquipmentCoverage.findMany({
        where: { organizationId, planId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          asset: {
            select: {
              id: true,
              name: true,
              category: true,
              identifier: true,
              serialNumber: true,
              status: true,
            },
          },
          equipmentExecutions: {
            where: { cycleId },
            select: equipmentExecutionView,
          },
        },
      }),
    );
  }

  startEquipmentExecution(input: {
    organizationId: string;
    planId: string;
    cycleId: string;
    coverageId: string;
    assetId: string;
    businessUnitId: string;
    customerId: string;
    responsibleFieldTechnicianId: string;
    auxiliaryTechnicianIds: string[];
    actorId: string;
    procedureSnapshot: Prisma.InputJsonValue;
    technicalResponsibleSnapshot: Prisma.InputJsonValue;
    code: string;
    title: string;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:equipment:${input.cycleId}:${input.coverageId}`}))`;
      const existing = await tx.pmocEquipmentExecution.findUnique({
        where: {
          cycleId_coverageId: {
            cycleId: input.cycleId,
            coverageId: input.coverageId,
          },
        },
        select: equipmentExecutionView,
      });
      if (existing) return { execution: existing, created: false };

      const operation = await tx.operation.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          /** O PMOC gera a ordem de um equipamento — a lista tem um só. */
          assets: input.assetId
            ? { create: [{ assetId: input.assetId }] }
            : undefined,
          code: input.code,
          kind: 'PMOC',
          title: input.title,
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
          responsibleFieldTechnicianId: input.responsibleFieldTechnicianId,
          startedByUserId: input.actorId,
          startedAt: new Date(),
          createdById: input.actorId,
        },
        select: { id: true },
      });
      await tx.operationUser.create({
        data: {
          operationId: operation.id,
          userId: input.responsibleFieldTechnicianId,
          assignedById: input.actorId,
        },
      });
      if (input.auxiliaryTechnicianIds.length) {
        await tx.operationAuxiliaryTechnician.createMany({
          data: input.auxiliaryTechnicianIds.map((userId) => ({
            id: generateUuidV7(),
            organizationId: input.organizationId,
            operationId: operation.id,
            userId,
            assignedById: input.actorId,
          })),
        });
      }
      await tx.operationHistory.create({
        data: {
          operationId: operation.id,
          userId: input.actorId,
          action: 'PMOC_EQUIPMENT_EXECUTION_STARTED',
          toStatus: 'IN_PROGRESS',
          details: { cycleId: input.cycleId, assetId: input.assetId },
        },
      });
      /*
       * A contagem do equipamento é alocada **dentro do insert**.
       *
       * `max(sequence_number)+1` na própria instrução, como `openCycle` faz para
       * o ciclo: ler o máximo antes e gravar depois abriria a janela em que duas
       * execuções do mesmo aparelho recebem o mesmo número. Aqui quem perde a
       * corrida viola o índice único `(plan_id, asset_id, sequence_number)` e a
       * transação falha — em vez de repetir o número em silêncio.
       *
       * É por isso que este insert não passa pelo `create` do Prisma: ele não
       * sabe expressar um valor derivado de uma subconsulta sobre a própria
       * tabela.
       */
      const inserido = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO pmoc_equipment_executions (
          id, organization_id, business_unit_id, cycle_id, plan_id,
          coverage_id, asset_id, operation_id,
          responsible_field_technician_id, status,
          procedure_snapshot, technical_responsible_snapshot,
          started_by_id, sequence_number, started_at, created_at, updated_at
        ) VALUES (
          ${generateUuidV7()}::uuid,
          ${input.organizationId}::uuid,
          ${input.businessUnitId}::uuid,
          ${input.cycleId}::uuid,
          ${input.planId}::uuid,
          ${input.coverageId}::uuid,
          ${input.assetId}::uuid,
          ${operation.id}::uuid,
          ${input.responsibleFieldTechnicianId}::uuid,
          'IN_PROGRESS',
          ${JSON.stringify(input.procedureSnapshot ?? {})}::jsonb,
          ${JSON.stringify(input.technicalResponsibleSnapshot ?? {})}::jsonb,
          ${input.actorId}::uuid,
          COALESCE((
            SELECT max(sequence_number) + 1
              FROM pmoc_equipment_executions
             WHERE plan_id = ${input.planId}::uuid
               AND asset_id = ${input.assetId}::uuid
          ), 1),
          now(), now(), now()
        )
        RETURNING id
      `;
      const execution = await tx.pmocEquipmentExecution.findUniqueOrThrow({
        where: { id: inserido[0]!.id },
        select: equipmentExecutionView,
      });
      await this.audit(
        tx,
        input.planId,
        input.organizationId,
        input.actorId,
        'PMOC_EQUIPMENT_EXECUTION_STARTED',
        {},
        {
          cycleId: input.cycleId,
          assetId: input.assetId,
          executionId: execution.id,
        },
      );
      return { execution, created: true };
    });
  }

  addEquipmentEvidence(input: {
    organizationId: string;
    executionId: string;
    storageFileId: string;
    kind: string;
    caption: string | null;
    actorId: string;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:evidence:${input.executionId}`}))`;
      const execution = await tx.pmocEquipmentExecution.findFirst({
        where: { id: input.executionId, organizationId: input.organizationId },
        select: { id: true },
      });
      const file = await tx.storageFile.findFirst({
        where: {
          id: input.storageFileId,
          organizationId: input.organizationId,
          status: 'AVAILABLE',
          deletedAt: null,
        },
        select: { id: true, mimeType: true },
      });
      if (!execution || !file) return null;
      const count = await tx.pmocEquipmentEvidence.count({
        where: { equipmentExecutionId: input.executionId },
      });
      if (count >= 6) return { limitReached: true as const };
      const evidence = await tx.pmocEquipmentEvidence.create({
        data: {
          organizationId: input.organizationId,
          equipmentExecutionId: input.executionId,
          storageFileId: input.storageFileId,
          kind: input.kind,
          caption: input.caption,
          uploadedById: input.actorId,
        },
        select: { id: true },
      });
      return { limitReached: false as const, evidence };
    });
  }

  linkEquipmentArtifact(
    organizationId: string,
    executionId: string,
    artifactExecutionId: string,
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.pmocEquipmentExecution.findFirst({
        where: { id: executionId, organizationId },
        select: { id: true, businessUnitId: true, assetId: true },
      });
      if (!execution) return null;
      const artifact = await tx.artifactExecution.findFirst({
        where: {
          id: artifactExecutionId,
          organizationId,
          businessUnitId: execution.businessUnitId,
          assetId: execution.assetId,
          deletedAt: null,
          template: { artifactType: { contains: 'PMOC', mode: 'insensitive' } },
        },
        select: { id: true },
      });
      if (!artifact) return { invalidArtifact: true as const };
      await tx.pmocEquipmentExecution.update({
        where: { id: executionId },
        data: { artifactExecutionId },
      });
      return { invalidArtifact: false as const };
    });
  }

  /**
   * Cria (ou reaproveita) o documento de uma execução concluída.
   *
   * `restrictToTechnicianId` é a autoridade de quem emite pelo celular: quando
   * presente, só o técnico escalado **daquela execução** passa. A conferência
   * mora dentro desta transação, junto do lock que garante a idempotência —
   * conferir fora deixaria a janela em que a escala muda entre a leitura e a
   * criação do documento, e o que se está decidindo é de quem é o nome que sai
   * assinando.
   *
   * `null` é a ausência de restrição: é assim que o dono emite o relatório da
   * execução de um técnico que faltou.
   */
  createEquipmentArtifact(
    organizationId: string,
    equipmentExecutionId: string,
    actorId: string,
    restrictToTechnicianId: string | null = null,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:artifact:${equipmentExecutionId}`}))`;
      const physical = await tx.pmocEquipmentExecution.findFirst({
        where: {
          id: equipmentExecutionId,
          organizationId,
          status: 'COMPLETED',
        },
        include: {
          cycle: {
            include: {
              plan: {
                include: {
                  customer: true,
                  businessUnit: true,
                },
              },
            },
          },
          asset: true,
          responsibleFieldTechnician: {
            select: { id: true, displayName: true },
          },
          operation: {
            include: {
              auxiliaryTechnicians: {
                where: { removedAt: null },
                include: { user: { select: { id: true, displayName: true } } },
              },
            },
          },
          evidence: {
            orderBy: { createdAt: 'asc' },
            include: { storageFile: true },
          },
        },
      });
      if (!physical) return null;

      /* Recusa nomeada, e não `null`: "execução não encontrada" mandaria o
         técnico procurar um registro que existe e está correto. */
      if (
        restrictToTechnicianId &&
        physical.responsibleFieldTechnicianId !== restrictToTechnicianId
      ) {
        return { refused: 'NOT_ASSIGNED' as const };
      }

      if (physical.artifactExecutionId) {
        const current = await tx.artifactExecution.findUniqueOrThrow({
          where: { id: physical.artifactExecutionId },
          select: { id: true, renderStatus: true },
        });
        return {
          artifactExecutionId: current.id,
          renderStatus: current.renderStatus,
          created: false,
        };
      }
      const template = await tx.artifactTemplate.findFirst({
        where: {
          artifactType: { contains: 'PMOC', mode: 'insensitive' },
          status: 'ACTIVE',
          deletedAt: null,
          OR: [
            { organizationId },
            { organizationId: null, visibility: 'GLOBAL' },
          ],
        },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'asc' },
      });
      const version = template?.versions[0];
      if (!template || !version) return null;
      const technical = physical.technicalResponsibleSnapshot as Record<
        string,
        unknown
      >;
      const signature = (technical.signature ?? {}) as Record<string, unknown>;
      const credential = (technical.credential ?? {}) as Record<
        string,
        unknown
      >;
      const evidence = physical.evidence.map((item) => ({
        id: item.id,
        kind: item.kind,
        caption: item.caption,
        fileId: item.storageFile.id,
        fileName: item.storageFile.fileName,
        mimeType: item.storageFile.mimeType,
        sha256: item.storageFile.sha256,
      }));
      const context = {
        sourceType: 'PMOC_EQUIPMENT_EXECUTION',
        sourceEntityId: physical.id,
        plan: {
          id: physical.cycle.plan.id,
          code: physical.cycle.plan.code,
          name: physical.cycle.plan.name,
        },
        cycle: {
          id: physical.cycle.id,
          sequenceNumber: physical.cycle.sequenceNumber,
          dueOn: physical.cycle.dueOn.toISOString().slice(0, 10),
        },
        /*
         * Qual manutenção **deste equipamento** é esta.
         *
         * Separado de `cycle.sequenceNumber`, que é a do ciclo e vale para todos
         * os aparelhos atendidos no mesmo período. Um equipamento que entrou no
         * plano no meio da vigência está na sua primeira manutenção dentro do
         * sétimo ciclo, e é a primeira que o relatório precisa afirmar.
         *
         * O total sai da vigência com a periodicidade — `null` em plano sem prazo
         * final, e aí o documento imprime só a posição.
         */
        maintenance: {
          sequence: physical.sequenceNumber,
          total: plannedExecutionCount({
            startsOn: toDateOnly(physical.cycle.plan.startsOn),
            endsOn: physical.cycle.plan.endsOn
              ? toDateOnly(physical.cycle.plan.endsOn)
              : null,
            frequencyAmount: physical.cycle.plan.frequencyAmount,
            frequencyUnit: physical.cycle.plan.frequencyUnit as FrequencyUnit,
          }),
        },
        performedAt: physical.performedAt?.toISOString() ?? null,
        /*
         * A observação de quem atendeu.
         *
         * O documento já tem a seção "Observações e conclusão" e a lê de
         * `metadata.executionNotes` — que **ninguém preenchia** fora da fábrica de
         * amostras. O técnico escrevia o que encontrou, o texto ficava na
         * execução, e o relatório saía sem ele: a substância do atendimento
         * gravada e não impressa.
         *
         * O assembler espalha os metadados do snapshot no render input, então
         * nomear o campo aqui é o que faz a seção existir em produção.
         */
        executionNotes: physical.notes,
        customer: {
          id: physical.cycle.plan.customer.id,
          name:
            physical.cycle.plan.customer.tradeName ??
            physical.cycle.plan.customer.legalName,
        },
        serviceLocation: physical.cycle.plan.serviceLocation,
        scope: physical.cycle.plan.scope,
        serviceTypes: physical.cycle.plan.serviceTypes,
        equipment: {
          id: physical.asset.id,
          name: physical.asset.name,
          manufacturer: physical.asset.manufacturer,
          model: physical.asset.model,
          serialNumber: physical.asset.serialNumber,
          identifier: physical.asset.identifier,
          location: physical.asset.location,
        },
        procedure: physical.procedureSnapshot,
        fieldTechnician: physical.responsibleFieldTechnician,
        auxiliaries:
          physical.operation?.auxiliaryTechnicians.map((item) => item.user) ??
          [],
        technicalResponsible: technical,
        evidence,
        reviewRequired: physical.cycle.plan.reviewRequired,
      };
      const sections = [
        {
          id: 'pmoc_context',
          title: 'Execução PMOC por equipamento',
          order: 1,
          type: 'FORM',
          fields: Object.keys(context).map((key, index) => ({
            id: key,
            label: key,
            type: 'TEXT',
            order: index + 1,
            required: true,
          })),
        },
      ];
      const signatureSlots = [
        {
          id: 'technical_responsible',
          label: 'Responsável Técnico',
          signerRole: 'TECHNICAL_RESPONSIBLE',
          required: true,
          order: 1,
        },
      ];
      const structureHash = createHash('sha256')
        .update(JSON.stringify({ sections, signatureSlots, context }))
        .digest('hex');
      const snapshot = await tx.artifactSnapshot.create({
        data: {
          organizationId,
          templateId: template.id,
          templateVersionId: version.id,
          templateVersion: version.version,
          templateKey: template.key,
          templateName: template.name,
          artifactType: template.artifactType,
          segment: template.segment,
          metadata: context as Prisma.InputJsonValue,
          sections,
          signatureSlots,
          layout: version.layout ?? {},
          structureHash,
        },
      });
      const artifact = await tx.artifactExecution.create({
        data: {
          organizationId,
          businessUnitId: physical.businessUnitId,
          operationId: physical.operationId,
          customerId: physical.cycle.plan.customerId,
          assetId: physical.assetId,
          templateId: template.id,
          snapshotId: snapshot.id,
          responsibleUserId:
            typeof technical.userId === 'string' ? technical.userId : null,
          createdById: actorId,
          code: `PMOC-${physical.id.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
          /* A contagem do **equipamento**, não a do ciclo: era o número do ciclo
             aqui, e o documento de um aparelho que entrou no meio da vigência
             saía intitulado "Execução 7" na sua primeira manutenção. */
          title: `PMOC — Manutenção ${physical.sequenceNumber} — ${physical.asset.name}`,
          status: physical.cycle.plan.reviewRequired
            ? 'UNDER_REVIEW'
            : 'COMPLETED',
          startedAt: physical.startedAt,
          completedAt: physical.completedAt,
          context: context as Prisma.InputJsonValue,
          responses: {
            create: Object.entries(context).map(([key, value]) => ({
              organizationId,
              sectionId: 'pmoc_context',
              fieldId: key,
              value:
                value === null
                  ? Prisma.JsonNull
                  : (value as Prisma.InputJsonValue),
              valueType: typeof value === 'object' ? 'JSON' : 'TEXT',
              provenance: 'SYSTEM',
              answeredById: actorId,
            })),
          },
        },
      });
      if (
        typeof technical.userId === 'string' &&
        typeof signature.sha256 === 'string'
      ) {
        await tx.artifactExecutionSignature.create({
          data: {
            organizationId,
            executionId: artifact.id,
            slotId: 'technical_responsible',
            signerRole: 'TECHNICAL_RESPONSIBLE',
            signedAs: 'TECHNICAL_RESPONSIBLE',
            userId: technical.userId,
            signerName:
              typeof technical.displayName === 'string'
                ? technical.displayName
                : '',
            signatureData: signature as Prisma.InputJsonValue,
            signatureHash: signature.sha256,
            signatureAssetId:
              typeof signature.storageObjectId === 'string'
                ? signature.storageObjectId
                : null,
            signatureAssetHash: signature.sha256,
            professionalRole: 'TECHNICAL_RESPONSIBLE',
            credentialType:
              typeof credential.type === 'string' ? credential.type : null,
            credentialNumber:
              typeof credential.registrationNumber === 'string'
                ? credential.registrationNumber
                : null,
            credentialRegion:
              typeof credential.region === 'string' ? credential.region : null,
            capturedAt: physical.startedAt,
          },
        });
      }
      await tx.pmocEquipmentExecution.update({
        where: { id: physical.id },
        data: { artifactExecutionId: artifact.id },
      });
      await this.audit(
        tx,
        physical.cycle.plan.id,
        organizationId,
        actorId,
        'PMOC_EQUIPMENT_ARTIFACT_CREATED',
        {},
        {
          equipmentExecutionId: physical.id,
          artifactExecutionId: artifact.id,
          assetId: physical.assetId,
        },
      );
      return {
        artifactExecutionId: artifact.id,
        renderStatus: artifact.renderStatus,
        created: true,
      };
    });
  }

  /**
   * Conclui a execução de um equipamento.
   *
   * ## Quem pode concluir entra no `where`
   *
   * `restrictToTechnicianId` é o técnico escalado, ou `null` para o dono da
   * organização — que atende qualquer execução. A restrição viaja **dentro** do
   * claim, junto do status: conferir antes e gravar depois deixaria a janela em
   * que a atribuição muda entre a leitura e a escrita.
   *
   * ## A recusa diz qual recusa é
   *
   * Sem isso, quem não é o técnico escalado receberia "execução não está em
   * andamento" — a mensagem do outro motivo, e a pessoa iria procurar o estado
   * errado. Quando o claim não pega nada, uma leitura decide qual foi o motivo.
   * Ela só acontece no caminho da falha, então o caminho felizes segue com uma
   * instrução.
   */
  completeEquipmentExecution(input: {
    organizationId: string;
    planId: string;
    cycleId: string;
    executionId: string;
    actorId: string;
    restrictToTechnicianId: string | null;
    performedAt: Date;
    notes: string | null;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:cycle-completion:${input.cycleId}`}))`;
      const claimed = await tx.pmocEquipmentExecution.updateMany({
        where: {
          id: input.executionId,
          organizationId: input.organizationId,
          cycleId: input.cycleId,
          status: 'IN_PROGRESS',
          ...(input.restrictToTechnicianId
            ? { responsibleFieldTechnicianId: input.restrictToTechnicianId }
            : {}),
        },
        data: {
          status: 'COMPLETED',
          performedAt: input.performedAt,
          completedAt: new Date(),
          completedById: input.actorId,
          notes: input.notes,
        },
      });
      if (!claimed.count) {
        const atual = await tx.pmocEquipmentExecution.findFirst({
          where: {
            id: input.executionId,
            organizationId: input.organizationId,
            cycleId: input.cycleId,
          },
          select: { status: true, responsibleFieldTechnicianId: true },
        });
        if (!atual) return { refused: 'NOT_FOUND' as const } as const;
        if (atual.status !== 'IN_PROGRESS') {
          return { refused: 'NOT_IN_PROGRESS' as const };
        }
        return { refused: 'NOT_ASSIGNED' as const };
      }
      const row = await tx.pmocEquipmentExecution.findFirstOrThrow({
        where: { id: input.executionId },
        select: { operationId: true, businessUnitId: true, assetId: true },
      });
      if (row.operationId)
        await tx.operation.update({
          where: { id: row.operationId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedByUserId: input.actorId,
          },
        });
      const required = await tx.pmocEquipmentCoverage.count({
        where: {
          planId: input.planId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
      });
      const resolved = await tx.pmocEquipmentExecution.count({
        where: {
          cycleId: input.cycleId,
          organizationId: input.organizationId,
          status: { in: ['COMPLETED', 'CANCELLED'] },
        },
      });
      const allResolved = required > 0 && resolved >= required;
      let nextDueOn: Date | null = null;
      if (allResolved) {
        const cycle = await tx.pmocExecution.updateMany({
          where: {
            id: input.cycleId,
            planId: input.planId,
            organizationId: input.organizationId,
            status: 'PENDING',
          },
          data: {
            status: 'COMPLETED',
            performedAt: input.performedAt,
            completedById: input.actorId,
          },
        });
        if (cycle.count) {
          const rolled = await tx.$queryRaw<{ next_due_on: Date }[]>`
            UPDATE pmoc_plans SET last_executed_at=${input.performedAt},
              next_due_on=(${input.performedAt}::date + make_interval(
                years=>CASE WHEN frequency_unit='YEARS' THEN frequency_amount ELSE 0 END,
                months=>CASE WHEN frequency_unit='MONTHS' THEN frequency_amount ELSE 0 END,
                weeks=>CASE WHEN frequency_unit='WEEKS' THEN frequency_amount ELSE 0 END,
                days=>CASE WHEN frequency_unit='DAYS' THEN frequency_amount ELSE 0 END))::date,
              due_soon_notified_for=NULL, overdue_notified_for=NULL, updated_at=now()
            WHERE id=${input.planId}::uuid AND organization_id=${input.organizationId}::uuid
            RETURNING next_due_on
          `;
          nextDueOn = rolled[0]?.next_due_on ?? null;
          if (nextDueOn)
            await tx.$executeRaw`
            INSERT INTO pmoc_executions(id,organization_id,plan_id,due_on,status,sequence_number,updated_at)
            SELECT ${generateUuidV7()}::uuid,${input.organizationId}::uuid,${input.planId}::uuid,${nextDueOn}::date,'PENDING',
              COALESCE((SELECT max(sequence_number)+1 FROM pmoc_executions WHERE plan_id=${input.planId}::uuid),1),now()
            FROM pmoc_plans p WHERE p.id=${input.planId}::uuid AND (p.ends_on IS NULL OR p.ends_on>=${nextDueOn}::date)
            ON CONFLICT DO NOTHING
          `;
        }
      }
      await this.audit(
        tx,
        input.planId,
        input.organizationId,
        input.actorId,
        'PMOC_EQUIPMENT_EXECUTION_COMPLETED',
        {},
        {
          cycleId: input.cycleId,
          executionId: input.executionId,
          assetId: row.assetId,
          allResolved,
          nextDueOn,
        },
      );
      await this.events.emit(tx, {
        type: 'pmoc.equipment_execution.completed',
        organizationId: input.organizationId,
        businessUnitId: row.businessUnitId,
        actorId: input.actorId,
        entityType: 'PMOC_EQUIPMENT_EXECUTION',
        entityId: input.executionId,
        payload: {
          planId: input.planId,
          cycleId: input.cycleId,
          assetId: row.assetId,
          performedAt: input.performedAt.toISOString(),
        },
      });
      if (allResolved) {
        await this.events.emit(tx, {
          type: 'pmoc.execution.completed',
          organizationId: input.organizationId,
          businessUnitId: row.businessUnitId,
          actorId: input.actorId,
          entityType: 'PMOC_PLAN',
          entityId: input.planId,
          payload: {
            cycleId: input.cycleId,
            nextDueOn: nextDueOn?.toISOString().slice(0, 10) ?? '',
          },
        });
      }
      return {
        refused: null,
        allResolved,
        nextDueOn,
        execution: await tx.pmocEquipmentExecution.findFirstOrThrow({
          where: { id: input.executionId },
          select: equipmentExecutionView,
        }),
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Cobertura                                                         */
  /* ---------------------------------------------------------------- */

  addCoverage(input: {
    organizationId: string;
    planId: string;
    assetId: string;
    startsOn: Date;
    endsOn: Date | null;
    notes: string | null;
    actorId: string;
  }) {
    return this.rls.run(async (tx) => {
      const coverage = await tx.pmocEquipmentCoverage.create({
        data: {
          organizationId: input.organizationId,
          planId: input.planId,
          assetId: input.assetId,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          notes: input.notes,
        },
        select: coverageView,
      });
      await this.audit(
        tx,
        input.planId,
        input.organizationId,
        input.actorId,
        'PMOC_COVERAGE_ADDED',
        {},
        { assetId: input.assetId },
      );
      return coverage;
    });
  }

  removeCoverage(
    id: string,
    planId: string,
    organizationId: string,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      /**
       * Serializa alterações de cobertura do mesmo plano. Sem esta trava,
       * duas remoções simultâneas poderiam enxergar duas coberturas e apagar
       * ambas, deixando um plano ACTIVE sem trabalho operacional.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:coverage:${planId}`}))`;
      const plan = await tx.pmocPlan.findFirst({
        where: { id: planId, organizationId, deletedAt: null },
        select: {
          status: true,
          _count: {
            select: { coverages: { where: { deletedAt: null } } },
          },
        },
      });
      if (!plan) return false;
      if (plan.status === 'ACTIVE' && plan._count.coverages <= 1) {
        throw new ConflictException(
          'An active PMOC plan must keep at least one covered equipment',
        );
      }
      const removed = await tx.pmocEquipmentCoverage.updateMany({
        where: { id, planId, organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (removed.count === 0) return false;
      await this.audit(
        tx,
        planId,
        organizationId,
        actorId,
        'PMOC_COVERAGE_REMOVED',
        {},
        { coverageId: id },
      );
      return true;
    });
  }

  /**
   * Tudo o que o documento do plano imprime, numa leitura.
   *
   * Projeção própria de propósito: `coverageView` serve a listagens e traz o
   * mínimo do equipamento. O documento precisa de marca, modelo e local, e
   * alargar a projeção compartilhada faria toda listagem de cobertura carregar
   * campos que ela não mostra.
   */
  documentSource(planId: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const plan = await tx.pmocPlan.findFirst({
        where: { id: planId, organizationId, deletedAt: null },
        select: {
          code: true,
          name: true,
          status: true,
          notes: true,
          startsOn: true,
          endsOn: true,
          frequencyAmount: true,
          frequencyUnit: true,
          serviceTypes: true,
          procedure: true,
          lastExecutedAt: true,
          nextDueOn: true,
          technician: { select: { displayName: true } },
          /**
           * O Responsável Técnico, com a assinatura ativa dele.
           *
           * É a assinatura que sai no contrato impresso — o documento do PMOC a
           * pedia ao compositor e ninguém a carregava, então a linha saía sempre em
           * branco. `active` e `revokedAt: null` no filtro porque uma assinatura
           * revogada é exatamente a que não pode sair impressa; `take: 1` porque o
           * índice único garante uma ativa por pessoa.
           */
          technicalResponsible: {
            select: {
              displayName: true,
              professionalSignatures: {
                where: { active: true, revokedAt: null },
                orderBy: { version: 'desc' as const },
                take: 1,
                select: {
                  storageObject: {
                    select: {
                      bucket: true,
                      objectKey: true,
                      mimeType: true,
                    },
                  },
                },
              },
            },
          },
          customer: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
            },
          },
          businessUnit: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
              email: true,
              phone: true,
              website: true,
              logoUrl: true,
              /* A marca da empresa, para quando a unidade não tiver a sua.
                 `issuerLogo` decide; aqui só se garante que o dado chegue. */
              organization: { select: { logoUrl: true } },
              city: true,
              stateCode: true,
              district: true,
              street: true,
              number: true,
              timezone: true,
            },
          },
        },
      });
      if (!plan) return null;

      /* Sequencial, não `Promise.all`: são consultas do mesmo cliente
         transacional, que o driver serializa de qualquer forma enquanto
         mantém a transação aberta pelo intervalo inteiro. */
      const coverages = await tx.pmocEquipmentCoverage.findMany({
        where: { planId, organizationId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          startsOn: true,
          asset: {
            select: {
              name: true,
              manufacturer: true,
              model: true,
              identifier: true,
              serialNumber: true,
              location: true,
              specifications: true,
            },
          },
        },
      });

      const planUnits = await tx.pmocPlanUnit.findMany({
        where: { planId, plan: { organizationId } },
        orderBy: { createdAt: 'asc' },
        select: {
          unit: {
            select: {
              name: true,
              checklistTemplate: { select: { name: true } },
            },
          },
        },
      });

      return { plan, coverages, planUnits };
    });
  }

  listCoverages(planId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocEquipmentCoverage.findMany({
        where: { planId, organizationId, deletedAt: null },
        select: coverageView,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  listCoveragesPage(input: {
    planId: string;
    organizationId: string;
    limit: number;
    cursor: { name: string; id: string } | null;
    search?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    return this.rls.run(async (tx) => {
      const cursorFilter = input.cursor
        ? {
            OR: [
              { asset: { name: { gt: input.cursor.name } } },
              {
                asset: { name: input.cursor.name },
                id: { gt: input.cursor.id },
              },
            ],
          }
        : undefined;
      return tx.pmocEquipmentCoverage.findMany({
        where: {
          planId: input.planId,
          organizationId: input.organizationId,
          deletedAt: null,
          ...(input.status ? { asset: { status: input.status } } : {}),
          ...(input.search
            ? {
                OR: [
                  {
                    asset: {
                      name: { contains: input.search, mode: 'insensitive' },
                    },
                  },
                  {
                    asset: {
                      identifier: {
                        contains: input.search,
                        mode: 'insensitive',
                      },
                    },
                  },
                  {
                    asset: {
                      serialNumber: {
                        contains: input.search,
                        mode: 'insensitive',
                      },
                    },
                  },
                ],
              }
            : {}),
          ...(cursorFilter ? { AND: [cursorFilter] } : {}),
        },
        select: coverageView,
        orderBy: [{ asset: { name: 'asc' } }, { id: 'asc' }],
        take: input.limit + 1,
      });
    });
  }

  listTimelinePage(input: {
    planId: string;
    organizationId: string;
    limit: number;
    cursor: { occurredAt: Date; id: string } | null;
  }) {
    return this.rls.run(async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          organizationId: input.organizationId,
          entityType: 'PMOC_PLAN',
          entityId: input.planId,
          ...(input.cursor
            ? {
                OR: [
                  { createdAt: { lt: input.cursor.occurredAt } },
                  {
                    createdAt: input.cursor.occurredAt,
                    id: { lt: input.cursor.id },
                  },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          action: true,
          after: true,
          createdAt: true,
          user: { select: { id: true, displayName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      });
      const assetIds = rows.flatMap((row) => {
        const after = row.after as Record<string, unknown> | null;
        return typeof after?.assetId === 'string' ? [after.assetId] : [];
      });
      const assets = assetIds.length
        ? await tx.asset.findMany({
            where: {
              organizationId: input.organizationId,
              id: { in: assetIds },
            },
            select: { id: true, name: true },
          })
        : [];
      return { rows, assets };
    });
  }

  /** O equipamento coberto há mais tempo — vira o `assetId` da ordem gerada. */
  firstCoveredAsset(planId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocEquipmentCoverage.findFirst({
        where: { planId, organizationId, deletedAt: null },
        select: { assetId: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * O painel de conformidade, numa varredura por tabela.
   *
   * Contagens com `FILTER`, e a conformidade calculada com a **mesma** régua do
   * filtro de listagem. Duas fórmulas para "vencido" divergiriam no primeiro
   * caso de borda, e o painel discordaria da lista logo abaixo dele.
   */
  complianceSummary(organizationId: string, query: PmocAnalyticsQueryDto) {
    const from = query.from ?? new Date(Date.now() - 30 * 24 * 3600_000);
    const to = query.to ?? new Date();

    return this.rls.run(async (tx) => {
      await this.expireStale(tx, organizationId);

      const unit = query.businessUnitId
        ? Prisma.sql`AND p.business_unit_id = ${query.businessUnitId}::uuid`
        : Prisma.empty;

      const [plans] = await tx.$queryRaw<
        {
          total: bigint;
          draft: bigint;
          active: bigint;
          suspended: bigint;
          expired: bigint;
          cancelled: bigint;
          up_to_date: bigint;
          due_soon: bigint;
          overdue: bigint;
        }[]
      >`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE p.status = 'DRAFT') AS draft,
          COUNT(*) FILTER (WHERE p.status = 'ACTIVE') AS active,
          COUNT(*) FILTER (WHERE p.status = 'SUSPENDED') AS suspended,
          COUNT(*) FILTER (WHERE p.status = 'EXPIRED') AS expired,
          COUNT(*) FILTER (WHERE p.status = 'CANCELLED') AS cancelled,
          COUNT(*) FILTER (
            WHERE p.status = 'ACTIVE' AND p.next_due_on IS NOT NULL
              AND p.next_due_on > current_date + (p.due_soon_days || ' days')::interval
          ) AS up_to_date,
          COUNT(*) FILTER (
            WHERE p.status = 'ACTIVE' AND p.next_due_on IS NOT NULL
              AND p.next_due_on >= current_date
              AND p.next_due_on <= current_date + (p.due_soon_days || ' days')::interval
          ) AS due_soon,
          COUNT(*) FILTER (
            WHERE p.status = 'ACTIVE' AND p.next_due_on IS NOT NULL
              AND p.next_due_on < current_date
          ) AS overdue
        FROM pmoc_plans p
        WHERE p.organization_id = ${organizationId}::uuid
          AND p.deleted_at IS NULL
          ${unit}
      `;

      const [equipment] = await tx.$queryRaw<{ covered: bigint }[]>`
        SELECT COUNT(DISTINCT c.asset_id) AS covered
          FROM pmoc_equipment_coverages c
          JOIN pmoc_plans p ON p.id = c.plan_id
         WHERE c.organization_id = ${organizationId}::uuid
           AND c.deleted_at IS NULL
           AND p.deleted_at IS NULL
           AND p.status = 'ACTIVE'
           ${unit}
      `;

      const [executions] = await tx.$queryRaw<
        { completed: bigint; pending: bigint; overdue: bigint }[]
      >`
        SELECT
          (SELECT COUNT(*) FROM pmoc_equipment_executions pe
            JOIN pmoc_executions ce ON ce.id=pe.cycle_id
            JOIN pmoc_plans p ON p.id=ce.plan_id
           WHERE pe.organization_id=${organizationId}::uuid AND pe.status='COMPLETED'
             AND pe.performed_at BETWEEN ${from} AND ${to} AND p.deleted_at IS NULL ${unit}) AS completed,
          COALESCE(SUM(GREATEST(c.covered - c.resolved, 0)) FILTER (WHERE c.status='PENDING'),0) AS pending,
          COALESCE(SUM(GREATEST(c.covered - c.resolved, 0)) FILTER (WHERE c.status='PENDING' AND c.due_on<current_date),0) AS overdue
        FROM (
          SELECT e.id,e.status,e.due_on,
            (SELECT COUNT(*) FROM pmoc_equipment_coverages pc WHERE pc.plan_id=e.plan_id AND pc.deleted_at IS NULL) AS covered,
            (SELECT COUNT(*) FROM pmoc_equipment_executions pe WHERE pe.cycle_id=e.id AND pe.status IN ('COMPLETED','CANCELLED')) AS resolved
          FROM pmoc_executions e JOIN pmoc_plans p ON p.id=e.plan_id
          WHERE e.organization_id=${organizationId}::uuid AND p.deleted_at IS NULL ${unit}
        ) c
      `;

      return { plans, equipment, executions, period: { from, to } };
    });
  }

  /** As próximas manutenções, em ordem de vencimento. */
  upcoming(organizationId: string, query: PmocUpcomingQueryDto) {
    return this.rls.run(async (tx) => {
      await this.expireStale(tx, organizationId);
      return tx.$queryRaw<
        {
          plan_id: string;
          plan_code: string;
          plan_name: string;
          execution_id: string | null;
          due_on: Date;
          days_until_due: number;
          due_soon_days: number;
          business_unit_id: string;
          business_unit_name: string;
          customer_id: string;
          customer_name: string;
          covered: bigint;
        }[]
      >`
        SELECT p.id AS plan_id,
               p.code AS plan_code,
               p.name AS plan_name,
               e.id AS execution_id,
               p.next_due_on AS due_on,
               (p.next_due_on - current_date) AS days_until_due,
               p.due_soon_days,
               b.id AS business_unit_id,
               COALESCE(b.trade_name, b.legal_name) AS business_unit_name,
               c.id AS customer_id,
               COALESCE(c.trade_name, c.legal_name) AS customer_name,
               (
                 SELECT COUNT(*) FROM pmoc_equipment_coverages cov
                  WHERE cov.plan_id = p.id AND cov.deleted_at IS NULL
               ) AS covered
          FROM pmoc_plans p
          JOIN business_units b ON b.id = p.business_unit_id
          JOIN customers c ON c.id = p.customer_id
          LEFT JOIN pmoc_executions e
            ON e.plan_id = p.id AND e.due_on = p.next_due_on AND e.status = 'PENDING'
         WHERE p.organization_id = ${organizationId}::uuid
           AND p.deleted_at IS NULL
           AND p.status = 'ACTIVE'
           AND p.next_due_on IS NOT NULL
           AND p.next_due_on <= current_date + (${query.days} || ' days')::interval
           ${query.businessUnitId ? Prisma.sql`AND p.business_unit_id = ${query.businessUnitId}::uuid` : Prisma.empty}
         ORDER BY p.next_due_on ASC
         LIMIT ${query.limit}
      `;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Avisos de vencimento                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Marca que o aviso deste vencimento já foi dado.
   *
   * O `WHERE` compara com o vencimento atual: se a manutenção foi feita e o
   * vencimento rolou, a marca não bate e o aviso do novo ciclo acontece. É o
   * que impede o mesmo "vence em 15 dias" todo dia durante quinze dias.
   */
  notify(input: {
    planId: string;
    organizationId: string;
    phase: 'DUE_SOON' | 'OVERDUE';
    dueOn: Date;
    days: number;
    actorId: string | null;
  }): Promise<boolean> {
    const column =
      input.phase === 'DUE_SOON'
        ? 'due_soon_notified_for'
        : 'overdue_notified_for';

    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE pmoc_plans
           SET ${Prisma.raw(column)} = ${input.dueOn}::date, updated_at = now()
         WHERE id = ${input.planId}::uuid
           AND organization_id = ${input.organizationId}::uuid
           AND status = 'ACTIVE'
           AND next_due_on = ${input.dueOn}::date
           AND (${Prisma.raw(column)} IS DISTINCT FROM ${input.dueOn}::date)
        RETURNING id
      `;

      /**
       * Nada atualizado: ou a manutenção já foi feita e o vencimento rolou, ou
       * o aviso deste vencimento já saiu. Nos dois casos, não há evento.
       */
      if (rows.length === 0) return false;

      const plan = await tx.pmocPlan.findFirstOrThrow({
        where: { id: input.planId },
        select: planView,
      });

      await this.events.emit(tx, {
        type: input.phase === 'DUE_SOON' ? 'pmoc.due_soon' : 'pmoc.overdue',
        organizationId: input.organizationId,
        businessUnitId: plan.businessUnit.id,
        actorId: input.actorId,
        entityType: 'PMOC_PLAN',
        entityId: plan.id,
        payload: {
          code: plan.code,
          businessUnitId: plan.businessUnit.id,
          customerId: plan.customer.id,
          dueOn: input.dueOn.toISOString().slice(0, 10),
          ...(input.phase === 'DUE_SOON'
            ? { daysUntilDue: input.days }
            : { daysOverdue: input.days }),
        },
      });

      return true;
    });
  }

  /** O plano como o job precisa dele: situação, vencimento e antecedência. */
  findForNotification(planId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocPlan.findFirst({
        where: { id: planId, organizationId, deletedAt: null },
        select: {
          id: true,
          status: true,
          nextDueOn: true,
          dueSoonDays: true,
          endsOn: true,
        },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Referências                                                       */
  /* ---------------------------------------------------------------- */

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          /** O preview projeta datas civis: o fuso é da unidade. */
          timezone: true,
        },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Unidades                                                          */
  /* ---------------------------------------------------------------- */

  listUnits(organizationId: string, onlyActive = true) {
    return this.rls.run((tx) =>
      tx.pmocUnit.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(onlyActive ? { isActive: true } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: unitView,
      }),
    );
  }

  /**
   * As unidades que **este plano** declarou atender.
   *
   * Leitura própria, fora do `planView`: a listagem de planos não precisa
   * delas, e carregá-las ali faria toda página de lista pagar um join que só o
   * detalhe e o relatório usam.
   */
  listPlanUnits(planId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocPlanUnit.findMany({
        where: { planId, plan: { organizationId, deletedAt: null } },
        orderBy: [{ unit: { sortOrder: 'asc' } }, { unit: { name: 'asc' } }],
        include: { unit: { include: unitView } },
      }),
    );
  }

  /**
   * As unidades declaradas por planos **ativos**, para o relatório.
   *
   * Vem pela tabela de vínculo e não pela de unidades: o relatório descreve o
   * que está em vigor, e uma unidade cadastrada que nenhum plano atende não é
   * serviço prestado. A agregação fica no serviço porque o volume é o número de
   * vínculos ativos — unidades por plano, alguns por organização —, e um
   * `GROUP BY` em SQL cru aqui custaria a tipagem do `items` do roteiro.
   */
  listActiveUnitLinks(organizationId: string, businessUnitId?: string) {
    return this.rls.run((tx) =>
      tx.pmocPlanUnit.findMany({
        where: {
          plan: {
            organizationId,
            deletedAt: null,
            status: 'ACTIVE',
            ...(businessUnitId ? { businessUnitId } : {}),
          },
          unit: { deletedAt: null },
        },
        select: {
          planId: true,
          unit: { include: unitView },
        },
      }),
    );
  }

  /** As unidades destes ids que são **desta** organização e estão vivas. */
  findEligibleUnits(organizationId: string, unitIds: readonly string[]) {
    return this.rls.run((tx) =>
      tx.pmocUnit.findMany({
        where: {
          organizationId,
          deletedAt: null,
          isActive: true,
          id: { in: [...unitIds] },
        },
        select: { id: true },
      }),
    );
  }

  /** O modelo de checklist, restrito à organização — a FK não a conhece. */
  findChecklistTemplate(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.checklistTemplate.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  findUnit(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.pmocUnit.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: unitView,
      }),
    );
  }

  createUnit(data: {
    organizationId: string;
    key: string;
    name: string;
    description?: string;
    checklistTemplateId?: string;
    sortOrder?: number;
  }) {
    return this.rls.run((tx) =>
      tx.pmocUnit.create({
        data: { id: generateUuidV7(), ...data },
        include: unitView,
      }),
    );
  }

  updateUnit(
    id: string,
    data: {
      name?: string;
      description?: string;
      checklistTemplateId?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    return this.rls.run((tx) =>
      tx.pmocUnit.update({ where: { id }, data, include: unitView }),
    );
  }

  /**
   * Remoção é lógica.
   *
   * Planos já criados apontam para a unidade, e o relatório de um período
   * passado precisa continuar dizendo o que foi feito. Apagar a linha
   * deixaria o histórico sem nome.
   */
  softDeleteUnit(id: string) {
    return this.rls.run((tx) =>
      tx.pmocUnit.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
    );
  }

  /**
   * O catálogo de nomes sugeridos.
   *
   * Tabela global, sem `organizationId` — mesma forma de `plans`. Continua
   * passando pelo `rls.run` para usar a mesma conexão e o mesmo papel de
   * runtime que o resto do módulo; não há política a satisfazer porque não
   * há coluna de inquilino.
   */
  planNameOptions() {
    return this.rls.run((tx) =>
      tx.pmocPlanNameOption.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        select: { key: true, label: true },
      }),
    );
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.customer.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, legalName: true, tradeName: true },
      }),
    );
  }

  /** O equipamento precisa ser do tenant **e** da mesma unidade do plano. */
  findAsset(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.asset.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          businessUnitId: true,
          customerId: true,
          name: true,
        },
      }),
    );
  }

  findMember(userId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.organizationMembership.findFirst({
        where: { userId, organizationId, status: 'ACTIVE' },
        select: { userId: true },
      }),
    );
  }

  /** A execução de artefato que serve de evidência — precisa existir de verdade. */
  findArtifactExecution(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.artifactExecution.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          businessUnitId: true,
          template: { select: { artifactType: true } },
        },
      }),
    );
  }

  defaultCalendar(organizationId: string, businessUnitId: string) {
    return this.rls.run((tx) =>
      tx.schedulingCalendar.findFirst({
        where: {
          organizationId,
          isActive: true,
          deletedAt: null,
          OR: [{ businessUnitId }, { businessUnitId: null }],
        },
        select: { id: true, timezone: true },
        orderBy: [{ isDefault: 'desc' }, { businessUnitId: 'desc' }],
      }),
    );
  }

  ensureSchedulingEvent(
    executionId: string,
    data: Prisma.SchedulingEventUncheckedCreateInput,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc:schedule:${executionId}`}))`;
      const current = await tx.pmocExecution.findFirstOrThrow({
        where: { id: executionId },
        select: { schedulingEventId: true },
      });
      if (current.schedulingEventId) return current.schedulingEventId;
      const event = await tx.schedulingEvent.create({
        data,
        select: { id: true },
      });
      await tx.pmocExecution.update({
        where: { id: executionId },
        data: { schedulingEventId: event.id },
      });
      return event.id;
    });
  }

  /** Próximo código de operação livre — a autoridade é o índice único. */
  operationCodeTaken(organizationId: string, code: string) {
    return this.rls.run(async (tx) => {
      const taken = await tx.operation.findFirst({
        where: { organizationId, code, deletedAt: null },
        select: { id: true },
      });
      return Boolean(taken);
    });
  }

  planCodeTaken(organizationId: string, code: string) {
    return this.rls.run(async (tx) => {
      const taken = await tx.pmocPlan.findFirst({
        where: { organizationId, code, deletedAt: null },
        select: { id: true },
      });
      return Boolean(taken);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Auditoria                                                         */
  /* ---------------------------------------------------------------- */

  private audit(
    tx: PrismaTransactionClient,
    planId: string,
    organizationId: string,
    actorId: string,
    action: string,
    before: Record<string, unknown>,
    after: Record<string, unknown> = {},
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        userId: actorId,
        action,
        entityType: 'PMOC_PLAN',
        entityId: planId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
