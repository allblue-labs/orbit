/**
 * Persistência e agregação do Management Reports Engine.
 *
 * ## Somar é trabalho do banco
 *
 * Nenhuma consulta aqui traz linha de domínio para a memória do processo. Um
 * ano de operação são milhares de ordens de serviço, e trazê-las para contar
 * seis números custaria a memória e o tempo de todas elas — para produzir uma
 * tabela que cabe numa tela. Tudo é `COUNT`/`SUM` com `FILTER`, agrupado no
 * Postgres, devolvendo dezenas de linhas.
 *
 * ## O fuso é do banco também
 *
 * `date_trunc('month', x AT TIME ZONE tz)` — a série mensal de um relatório de
 * Recife precisa quebrar os meses em Recife, não em UTC nem no fuso de quem
 * clicou. Passar o fuso como parâmetro é o que torna dois relatórios do mesmo
 * mês comparáveis.
 *
 * ## O que este repositório não faz
 *
 * Não calcula Financeiro nem Estoque: os dois já têm agregação autoritativa nos
 * seus módulos, e os providers os chamam. O que está aqui é o que **não tinha
 * dono** — contagem de operações, de agenda, de propostas por situação, de
 * execuções e de carga por técnico.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationHelper, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import type { ReportQueryDto } from './report.dto';

/** Recorte de toda agregação: organização, unidade, período e filtros. */
export interface ReportScope {
  organizationId: string;
  businessUnitId: string | null;
  from: Date;
  to: Date;
  timezone: string;
  customerId?: string | null;
  operationKind?: string | null;
  operationStatus?: string | null;
}

const reportView = {
  id: true,
  type: true,
  schemaVersion: true,
  status: true,
  format: true,
  parameters: true,
  data: true,
  sourceHash: true,
  provenance: true,
  timezone: true,
  periodFrom: true,
  periodTo: true,
  generatedAt: true,
  fileId: true,
  renderer: true,
  error: true,
  attempts: true,
  correlationId: true,
  createdAt: true,
  businessUnit: { select: { id: true, legalName: true, tradeName: true } },
  generatedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.ManagementReportSelect;

export type ReportRecord = Prisma.ManagementReportGetPayload<{
  select: typeof reportView;
}>;

export interface CreateReportData {
  organizationId: string;
  businessUnitId: string | null;
  type: string;
  format: string;
  parameters: Prisma.InputJsonValue;
  parametersHash: string;
  timezone: string;
  periodFrom: Date;
  periodTo: Date;
  generatedById: string;
  correlationId: string;
}

@Injectable()
export class ReportRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /* ---------------------------------------------------------------- */
  /* Ciclo de vida do relatório                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Cria a solicitação, ou devolve a que já está em andamento.
   *
   * `ON CONFLICT DO NOTHING` sobre o índice parcial de "em andamento": dois
   * cliques no mesmo botão não viram duas composições. Uma checagem prévia
   * seguida de `INSERT` não resolveria — entre as duas cabe o segundo clique,
   * e é exatamente aí que nascem dois PDFs idênticos.
   */
  createOrReuse(
    data: CreateReportData,
  ): Promise<{ id: string; created: boolean }> {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO management_reports (
          id, organization_id, business_unit_id, type, status, format,
          parameters, parameters_hash, timezone, period_from, period_to,
          generated_by_id, correlation_id, updated_at
        ) VALUES (
          ${generateUuidV7()}::uuid,
          ${data.organizationId}::uuid,
          ${data.businessUnitId}::uuid,
          ${data.type},
          'PENDING',
          ${data.format},
          ${data.parameters}::jsonb,
          ${data.parametersHash},
          ${data.timezone},
          ${data.periodFrom},
          ${data.periodTo},
          ${data.generatedById}::uuid,
          ${data.correlationId},
          now()
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;

      const created = rows[0];
      if (created) return { id: created.id, created: true };

      const existing = await tx.managementReport.findFirstOrThrow({
        where: {
          organizationId: data.organizationId,
          type: data.type,
          parametersHash: data.parametersHash,
          status: { in: ['PENDING', 'GENERATING'] },
          deletedAt: null,
        },
        select: { id: true },
      });
      return { id: existing.id, created: false };
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.managementReport.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: reportView,
      }),
    );
  }

  /** Relatório com o arquivo — só para assinar a URL de download. */
  findWithFile(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.managementReport.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          type: true,
          status: true,
          businessUnitId: true,
          file: {
            select: {
              id: true,
              bucket: true,
              objectKey: true,
              fileName: true,
              mimeType: true,
            },
          },
        },
      }),
    );
  }

  list(organizationId: string, query: ReportQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.ManagementReportWhereInput = {
      organizationId,
      deletedAt: null,
      type: query.type,
      status: query.status,
      businessUnitId: query.businessUnitId,
      generatedById: query.generatedById,
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    return this.rls.run(async (tx) => {
      const data = await tx.managementReport.findMany({
        where,
        /** A listagem não carrega o snapshot: são páginas de JSON por linha. */
        select: { ...reportView, data: false },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.managementReport.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  /**
   * Reivindica a composição.
   *
   * `WHERE status <> 'READY'`: um relatório já pronto não é recomposto por
   * reentrega da fila. Sem linha devolvida, o processador desiste — e o
   * snapshot histórico permanece o que era.
   */
  claim(id: string): Promise<{ attempts: number } | null> {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<{ attempts: number }[]>`
        UPDATE management_reports
           SET status = 'GENERATING',
               attempts = attempts + 1,
               error = NULL,
               updated_at = now()
         WHERE id = ${id}::uuid
           AND status <> 'READY'
           AND deleted_at IS NULL
        RETURNING attempts
      `;
      return rows[0] ?? null;
    });
  }

  /**
   * Fecha o relatório.
   *
   * Snapshot, hash, proveniência, arquivo e `generatedAt` numa instrução só —
   * o `CHECK` de "pronto tem snapshot" é avaliado por instrução, e gravar em
   * duas etapas o violaria no meio do caminho.
   */
  markReady(
    id: string,
    input: {
      data: Prisma.InputJsonValue;
      sourceHash: string;
      provenance: Prisma.InputJsonValue;
      fileId: string | null;
      renderer: string | null;
    },
  ) {
    return this.rls
      .run((tx) =>
        tx.managementReport.update({
          where: { id },
          data: {
            status: 'READY',
            data: input.data,
            sourceHash: input.sourceHash,
            provenance: input.provenance,
            fileId: input.fileId,
            renderer: input.renderer,
            generatedAt: new Date(),
            error: null,
          },
        }),
      )
      .then(() => undefined);
  }

  markFailed(id: string, reason: string) {
    return this.rls
      .run((tx) =>
        tx.managementReport.update({
          where: { id },
          data: { status: 'FAILED', error: reason.slice(0, 500) },
        }),
      )
      .then(() => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* Contexto                                                          */
  /* ---------------------------------------------------------------- */

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, legalName: true, tradeName: true, timezone: true },
      }),
    );
  }

  /**
   * O timbre do relatório.
   *
   * A unidade do recorte quando o relatório é de uma; a matriz quando é da
   * organização inteira — a mesma regra do fuso, logo abaixo, porque é a mesma
   * pergunta: "de quem é este papel?".
   *
   * São as colunas que o cabeçalho imprime, e só elas. Um `include` generoso
   * arrastaria o cadastro inteiro da unidade para desenhar um timbre.
   */
  findLetterhead(organizationId: string, businessUnitId: string | null) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          ...(businessUnitId ? { id: businessUnitId } : {}),
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
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
      }),
    );
  }

  /**
   * O fuso do recorte.
   *
   * Da unidade quando há uma; da matriz quando o relatório é da organização
   * inteira. Nunca do navegador: o mesmo "outubro" precisa começar na mesma
   * hora para quem gera de Recife e para quem gera de Lisboa.
   */
  organizationTimezone(organizationId: string) {
    return this.rls.run(async (tx) => {
      const unit = await tx.businessUnit.findFirst({
        where: { organizationId, deletedAt: null },
        select: { timezone: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
      return unit?.timezone ?? 'America/Recife';
    });
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.customer.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, legalName: true, tradeName: true },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Operações                                                         */
  /* ---------------------------------------------------------------- */

  private unitFilter(scope: ReportScope, column = 'business_unit_id') {
    return scope.businessUnitId
      ? Prisma.sql`AND ${Prisma.raw(column)} = ${scope.businessUnitId}::uuid`
      : Prisma.empty;
  }

  private operationFilters(scope: ReportScope) {
    return Prisma.sql`
      ${this.unitFilter(scope)}
      ${scope.customerId ? Prisma.sql`AND customer_id = ${scope.customerId}::uuid` : Prisma.empty}
      ${scope.operationKind ? Prisma.sql`AND kind = ${scope.operationKind}` : Prisma.empty}
      ${scope.operationStatus ? Prisma.sql`AND status = ${scope.operationStatus}` : Prisma.empty}
    `;
  }

  /**
   * Os números do período, numa varredura só.
   *
   * `FILTER` faz seis contagens sobre a mesma leitura. Seis consultas
   * separadas leriam a mesma faixa seis vezes.
   *
   * As três datas têm significados diferentes e é por isso que as três
   * aparecem: `created_at` diz o que **entrou** no período, `completed_at` o
   * que **saiu**, e a comparação com `scheduled_end` o que saiu **no prazo**.
   * Uma "conclusão" contada por data de abertura misturaria dois períodos.
   */
  operationTotals(scope: ReportScope) {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          opened: bigint;
          completed: bigint;
          cancelled: bigint;
          with_deadline: bigint;
          on_time: bigint;
          late: bigint;
        }[]
      >`
        SELECT
          COUNT(*) FILTER (
            WHERE created_at >= ${scope.from} AND created_at <= ${scope.to}
          ) AS opened,
          COUNT(*) FILTER (
            WHERE completed_at >= ${scope.from} AND completed_at <= ${scope.to}
          ) AS completed,
          COUNT(*) FILTER (
            WHERE status = 'CANCELLED'
              AND created_at >= ${scope.from} AND created_at <= ${scope.to}
          ) AS cancelled,
          COUNT(*) FILTER (
            WHERE completed_at >= ${scope.from} AND completed_at <= ${scope.to}
              AND scheduled_end IS NOT NULL
          ) AS with_deadline,
          COUNT(*) FILTER (
            WHERE completed_at >= ${scope.from} AND completed_at <= ${scope.to}
              AND scheduled_end IS NOT NULL AND completed_at <= scheduled_end
          ) AS on_time,
          COUNT(*) FILTER (
            WHERE completed_at >= ${scope.from} AND completed_at <= ${scope.to}
              AND scheduled_end IS NOT NULL AND completed_at > scheduled_end
          ) AS late
        FROM operations
        WHERE organization_id = ${scope.organizationId}::uuid
          AND deleted_at IS NULL
          AND (
            (created_at >= ${scope.from} AND created_at <= ${scope.to})
            OR (completed_at >= ${scope.from} AND completed_at <= ${scope.to})
          )
          ${this.operationFilters(scope)}
      `;
      return rows[0];
    });
  }

  /** Distribuição por um atributo — `kind` ou `status`. */
  operationsBy(scope: ReportScope, column: 'kind' | 'status') {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<{ label: string; total: bigint }[]>`
        SELECT ${Prisma.raw(column)} AS label, COUNT(*) AS total
          FROM operations
         WHERE organization_id = ${scope.organizationId}::uuid
           AND deleted_at IS NULL
           AND created_at >= ${scope.from}
           AND created_at <= ${scope.to}
           ${this.operationFilters(scope)}
         GROUP BY 1
         ORDER BY 2 DESC, 1 ASC
      `,
    );
  }

  /** Clientes com mais operações no período. Recorte, e a tabela diz isso. */
  operationsByCustomer(scope: ReportScope, limit = 10) {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<
          { customer: string | null; total: bigint; completed: bigint }[]
        >`
        SELECT COALESCE(c.trade_name, c.legal_name) AS customer,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE o.status = 'COMPLETED') AS completed
          FROM operations o
          LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.organization_id = ${scope.organizationId}::uuid
           AND o.deleted_at IS NULL
           AND o.created_at >= ${scope.from}
           AND o.created_at <= ${scope.to}
           ${this.unitFilter(scope, 'o.business_unit_id')}
           ${scope.customerId ? Prisma.sql`AND o.customer_id = ${scope.customerId}::uuid` : Prisma.empty}
         GROUP BY 1
         ORDER BY 2 DESC, 1 ASC
         LIMIT ${limit}
      `,
    );
  }

  /**
   * Evolução mensal.
   *
   * O mês é quebrado **no fuso do recorte**: `AT TIME ZONE` converte o
   * instante para a hora local antes de truncar. Sem isso, uma operação
   * concluída às 22h de 31 de outubro em Recife cairia em novembro.
   */
  operationsMonthly(scope: ReportScope) {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<{ month: string; opened: bigint; completed: bigint }[]>`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', ${scope.from} AT TIME ZONE ${scope.timezone}),
            date_trunc('month', ${scope.to} AT TIME ZONE ${scope.timezone}),
            interval '1 month'
          ) AS month
        )
        SELECT to_char(m.month, 'YYYY-MM') AS month,
               COUNT(o.id) FILTER (
                 WHERE date_trunc('month', o.created_at AT TIME ZONE ${scope.timezone}) = m.month
                   AND o.created_at >= ${scope.from} AND o.created_at <= ${scope.to}
               ) AS opened,
               COUNT(o.id) FILTER (
                 WHERE date_trunc('month', o.completed_at AT TIME ZONE ${scope.timezone}) = m.month
                   AND o.completed_at >= ${scope.from} AND o.completed_at <= ${scope.to}
               ) AS completed
          FROM months m
          LEFT JOIN operations o
            ON o.organization_id = ${scope.organizationId}::uuid
           AND o.deleted_at IS NULL
           ${this.unitFilter(scope, 'o.business_unit_id')}
         GROUP BY 1
         ORDER BY 1 ASC
      `,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Agenda                                                            */
  /* ---------------------------------------------------------------- */

  schedulingTotals(scope: ReportScope) {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<{ type: string; status: string; total: bigint }[]>`
        SELECT type, status, COUNT(*) AS total
          FROM scheduling_events
         WHERE organization_id = ${scope.organizationId}::uuid
           AND deleted_at IS NULL
           AND starts_at >= ${scope.from}
           AND starts_at <= ${scope.to}
           ${this.unitFilter(scope)}
         GROUP BY 1, 2
         ORDER BY 1, 2
      `,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Comercial                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Propostas por evento do período.
   *
   * Cada situação é contada pela **sua** data — enviada por `sent_at`,
   * decidida por `decided_at`, expirada por `expired_at`. Contar tudo por
   * `created_at` diria quantas propostas nasceram no período, que é outra
   * pergunta: uma proposta de setembro aprovada em outubro é resultado de
   * outubro.
   *
   * `approved_total` soma **apenas aprovadas**, e o Read Model diz que é valor
   * aprovado — nunca receita. Receita realizada é do Financeiro, e aprovar
   * proposta não faz dinheiro entrar.
   */
  quoteTotals(scope: ReportScope) {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          created: bigint;
          sent: bigint;
          approved: bigint;
          rejected: bigint;
          expired: bigint;
          cancelled: bigint;
          approved_total: Prisma.Decimal | null;
          sent_total: Prisma.Decimal | null;
        }[]
      >`
        SELECT
          COUNT(*) FILTER (WHERE created_at BETWEEN ${scope.from} AND ${scope.to}) AS created,
          COUNT(*) FILTER (WHERE sent_at BETWEEN ${scope.from} AND ${scope.to}) AS sent,
          COUNT(*) FILTER (
            WHERE status = 'APPROVED' AND decided_at BETWEEN ${scope.from} AND ${scope.to}
          ) AS approved,
          COUNT(*) FILTER (
            WHERE status = 'REJECTED' AND decided_at BETWEEN ${scope.from} AND ${scope.to}
          ) AS rejected,
          COUNT(*) FILTER (WHERE expired_at BETWEEN ${scope.from} AND ${scope.to}) AS expired,
          COUNT(*) FILTER (WHERE cancelled_at BETWEEN ${scope.from} AND ${scope.to}) AS cancelled,
          SUM(total) FILTER (
            WHERE status = 'APPROVED' AND decided_at BETWEEN ${scope.from} AND ${scope.to}
          ) AS approved_total,
          SUM(total) FILTER (WHERE sent_at BETWEEN ${scope.from} AND ${scope.to}) AS sent_total
        FROM quotes
        WHERE organization_id = ${scope.organizationId}::uuid
          AND deleted_at IS NULL
          ${this.unitFilter(scope)}
          ${scope.customerId ? Prisma.sql`AND customer_id = ${scope.customerId}::uuid` : Prisma.empty}
      `;
      return rows[0];
    });
  }

  /* ---------------------------------------------------------------- */
  /* Documentos e execuções                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Execuções de artefato no período, por situação e por tipo de documento.
   *
   * `artifactType` vem do **template**, que é a autoridade sobre o que aquele
   * documento é. `pmocOnly` recorta o mesmo conjunto para o relatório de PMOC —
   * não há entidade PMOC no domínio, e o que existe de fato é a execução de um
   * artefato do tipo PMOC.
   */
  executionTotals(scope: ReportScope, pmocOnly = false) {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<
          { artifact_type: string; status: string; total: bigint }[]
        >`
        SELECT t.artifact_type, e.status, COUNT(*) AS total
          FROM artifact_executions e
          JOIN artifact_templates t ON t.id = e.template_id
         WHERE e.organization_id = ${scope.organizationId}::uuid
           AND e.deleted_at IS NULL
           AND e.created_at >= ${scope.from}
           AND e.created_at <= ${scope.to}
           ${this.unitFilter(scope, 'e.business_unit_id')}
           ${pmocOnly ? Prisma.sql`AND upper(t.artifact_type) LIKE '%PMOC%'` : Prisma.empty}
         GROUP BY 1, 2
         ORDER BY 1, 2
      `,
    );
  }

  /** Revisões emitidas no período — o documento oficial, não o rascunho. */
  manifestTotals(scope: ReportScope, pmocOnly = false) {
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<
        { issued: bigint; revoked: bigint; executions: bigint }[]
      >`
        SELECT COUNT(*) FILTER (WHERE m.issued_at BETWEEN ${scope.from} AND ${scope.to}) AS issued,
               COUNT(*) FILTER (WHERE m.revoked_at BETWEEN ${scope.from} AND ${scope.to}) AS revoked,
               COUNT(DISTINCT m.execution_id) FILTER (
                 WHERE m.issued_at BETWEEN ${scope.from} AND ${scope.to}
               ) AS executions
          FROM artifact_manifests m
          JOIN artifact_templates t ON t.id = m.template_id
         WHERE m.organization_id = ${scope.organizationId}::uuid
           AND m.deleted_at IS NULL
           ${this.unitFilter(scope, 'm.business_unit_id')}
           ${pmocOnly ? Prisma.sql`AND upper(t.artifact_type) LIKE '%PMOC%'` : Prisma.empty}
      `;
      return rows[0];
    });
  }

  /* ---------------------------------------------------------------- */
  /* Equipe                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Carga objetiva por técnico.
   *
   * Atribuídas e concluídas — **contagem, não nota**. Não há score, ranking
   * nem média: dois técnicos com números diferentes podem estar atendendo
   * demandas incomparáveis, e um número que parece avaliação é usado como
   * avaliação. A ordenação é por volume, e a tabela diz que é volume.
   */
  workforceTotals(scope: ReportScope, limit = 20) {
    return this.rls.run(
      (tx) =>
        tx.$queryRaw<
          { technician: string; assigned: bigint; completed: bigint }[]
        >`
        SELECT u.display_name AS technician,
               COUNT(*) AS assigned,
               COUNT(*) FILTER (
                 WHERE o.completed_at BETWEEN ${scope.from} AND ${scope.to}
               ) AS completed
          FROM operation_users ou
          JOIN operations o ON o.id = ou.operation_id
          JOIN users u ON u.id = ou.user_id
         WHERE o.organization_id = ${scope.organizationId}::uuid
           AND o.deleted_at IS NULL
           AND o.created_at >= ${scope.from}
           AND o.created_at <= ${scope.to}
           ${this.unitFilter(scope, 'o.business_unit_id')}
         GROUP BY 1
         ORDER BY 2 DESC, 1 ASC
         LIMIT ${limit}
      `,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Auditoria                                                         */
  /* ---------------------------------------------------------------- */

  audit(
    organizationId: string,
    actorId: string,
    action: string,
    reportId: string,
    payload: Record<string, unknown>,
  ) {
    return this.rls.run((tx) =>
      this.auditWith(tx, organizationId, actorId, action, reportId, payload),
    );
  }

  private auditWith(
    tx: PrismaTransactionClient,
    organizationId: string,
    actorId: string,
    action: string,
    reportId: string,
    payload: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        userId: actorId,
        action,
        entityType: 'MANAGEMENT_REPORT',
        entityId: reportId,
        after: payload as Prisma.InputJsonValue,
      },
    });
  }
}
