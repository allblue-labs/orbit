import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { IssuedDocumentQueryDto } from './issued-document.dto';
import type { IssuedDocumentReadModel } from './issued-document.read-models';

/** A linha como o PostgreSQL a devolve: `snake_case` e `BigInt` nas contagens. */
interface Row {
  source: string;
  id: string;
  code: string | null;
  title: string | null;
  type: string;
  render_status: string;
  status: string;
  business_unit_id: string | null;
  customer_id: string | null;
  operation_id: string | null;
  created_at: Date;
  issued_at: Date | null;
  revisions: bigint;
  period_from: Date | null;
  period_to: Date | null;
}

@Injectable()
export class IssuedDocumentRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /**
   * Uma página de tudo o que a organização emitiu.
   *
   * ## Por que SQL cru
   *
   * Porque a pergunta atravessa duas árvores que não têm relação entre si:
   * `artifact_executions` e `management_reports`. Prisma não une tabelas sem
   * relação, e a alternativa — duas consultas paginadas somadas em memória —
   * devolveria contagem e páginas falsas. É o defeito que esta tela já teve uma
   * vez, quando separava filas no cliente e a aba dizia 3 havendo 200.
   *
   * ## Por que a contagem vem na mesma consulta
   *
   * `COUNT(*) OVER ()` conta o conjunto filtrado inteiro enquanto a janela
   * devolve a página. Uma segunda consulta pagaria a união duas vezes e poderia
   * contar um conjunto diferente do que a página mostra, se alguém emitir entre
   * as duas.
   */
  async page(
    organizationId: string,
    query: IssuedDocumentQueryDto,
  ): Promise<{ data: IssuedDocumentReadModel[]; total: number }> {
    const limit = query.limit;
    const offset = (query.page - 1) * limit;

    const rows = await this.rls.run(
      (tx) =>
        tx.$queryRaw<(Row & { total: bigint })[]>`
        WITH unificado AS (
          ${this.executionsBranch(organizationId, query)}
          ${this.union(query)}
          ${this.reportsBranch(organizationId, query)}
        )
        SELECT *, COUNT(*) OVER () AS total
          FROM unificado
         WHERE TRUE
           ${this.commonFilters(query)}
         /* Pelo mais recente, e o id desempata: sem critério estavel, duas
            linhas do mesmo instante podem trocar de lugar entre paginas e uma
            delas nunca aparece. */
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return {
      data: rows.map((row) => this.toReadModel(row)),
      total: rows.length ? Number(rows[0]!.total) : 0,
    };
  }

  /**
   * Os dois ramos, ou um deles.
   *
   * Com `source` escolhido, o outro ramo não é consultado — e não é otimização:
   * um ramo filtrado para vazio dentro de `UNION ALL` ainda varre a tabela.
   */
  private union(query: IssuedDocumentQueryDto) {
    if (query.source) return Prisma.empty;
    return Prisma.sql`UNION ALL`;
  }

  private executionsBranch(
    organizationId: string,
    query: IssuedDocumentQueryDto,
  ) {
    if (query.source === 'REPORT') return Prisma.empty;
    return Prisma.sql`
      SELECT 'EXECUTION' AS source,
             e.id::text               AS id,
             e.code                   AS code,
             e.title                  AS title,
             s.artifact_type          AS type,
             e.render_status          AS render_status,
             e.status                 AS status,
             e.business_unit_id::text AS business_unit_id,
             e.customer_id::text      AS customer_id,
             e.operation_id::text     AS operation_id,
             e.created_at             AS created_at,
             m.issued_at              AS issued_at,
             COALESCE(m.revisions, 0) AS revisions,
             NULL::timestamptz        AS period_from,
             NULL::timestamptz        AS period_to
        FROM artifact_executions e
        JOIN artifact_snapshots s ON s.id = e.snapshot_id
        /* O manifesto é o arquivo, e a junção é externa porque a fila da central
           inclui o que ainda não tem documento: produzindo, falhou, nunca pedido. */
        LEFT JOIN (
          SELECT execution_id,
                 MAX(issued_at) AS issued_at,
                 COUNT(*)       AS revisions
            FROM artifact_manifests
           /* Emitida é toda revisão que já saiu, e não só a vigente: a anterior
              passa a SUPERSEDED quando a seguinte sai, e contar por status diria
              "1 revisão" para um documento reemitido quatro vezes. O que define
              ter saído é a data de emissão. */
           WHERE issued_at IS NOT NULL
             AND deleted_at IS NULL
           GROUP BY execution_id
        ) m ON m.execution_id = e.id
       WHERE e.organization_id = ${organizationId}::uuid
         AND e.deleted_at IS NULL
    `;
  }

  /**
   * O relatório gerencial.
   *
   * ## As mesmas quatro palavras
   *
   * Os dois motores já descreviam o estado do arquivo igual — na fila, compondo,
   * pronto, falhou. A única diferença é o nome do meio: o relatório diz
   * `GENERATING` onde a execução diz `RENDERING`. A tradução acontece aqui, uma
   * vez, em vez de a tela aprender dois vocabulários.
   *
   * ## O que ele não tem
   *
   * Código, título, cliente e atendimento. Um relatório gerencial retrata a
   * operação inteira num intervalo — não há um cliente de quem ele seja. Vem
   * `NULL`, e a tela mostra o período no lugar do código.
   */
  private reportsBranch(organizationId: string, query: IssuedDocumentQueryDto) {
    if (query.source === 'EXECUTION') return Prisma.empty;
    /* `NOT_RENDERED` é estado só de execução: relatório sem arquivo não foi
       pedido, e pedir essa fila não deve varrer a tabela para descartar tudo. */
    if (query.renderStatus === 'NOT_RENDERED') return Prisma.empty;
    /* Filtro por cliente ou atendimento exclui o relatório por definição. */
    if (query.customerId || query.operationId) return Prisma.empty;
    return Prisma.sql`
      SELECT 'REPORT' AS source,
             r.id::text               AS id,
             NULL::text               AS code,
             NULL::text               AS title,
             r.type                   AS type,
             CASE r.status
               WHEN 'GENERATING' THEN 'RENDERING'
               ELSE r.status
             END                      AS render_status,
             r.status                 AS status,
             r.business_unit_id::text AS business_unit_id,
             NULL::text               AS customer_id,
             NULL::text               AS operation_id,
             r.created_at             AS created_at,
             r.generated_at           AS issued_at,
             CASE WHEN r.file_id IS NULL THEN 0 ELSE 1 END AS revisions,
             r.period_from            AS period_from,
             r.period_to              AS period_to
        FROM management_reports r
       WHERE r.organization_id = ${organizationId}::uuid
         AND r.deleted_at IS NULL
    `;
  }

  /**
   * Os filtros que valem para as duas origens, aplicados **depois** da união.
   *
   * Repetir cada um nos dois ramos seria duas versões da mesma regra, e é assim
   * que uma delas fica para trás na próxima mudança. Os que precisam agir antes —
   * `source`, e os que excluem um ramo inteiro — agem lá, e lá estão explicados.
   */
  private commonFilters(query: IssuedDocumentQueryDto) {
    return Prisma.sql`
      ${query.businessUnitId ? Prisma.sql`AND business_unit_id = ${query.businessUnitId}` : Prisma.empty}
      ${query.customerId ? Prisma.sql`AND customer_id = ${query.customerId}` : Prisma.empty}
      ${query.operationId ? Prisma.sql`AND operation_id = ${query.operationId}` : Prisma.empty}
      ${query.renderStatus ? Prisma.sql`AND render_status = ${query.renderStatus}` : Prisma.empty}
      ${query.artifactType ? Prisma.sql`AND type = ${query.artifactType}` : Prisma.empty}
      ${query.createdFrom ? Prisma.sql`AND created_at >= ${new Date(query.createdFrom)}` : Prisma.empty}
      ${query.createdTo ? Prisma.sql`AND created_at <= ${endOfDay(query.createdTo)}` : Prisma.empty}
      ${
        query.search
          ? Prisma.sql`AND (code ILIKE ${`%${query.search}%`} OR title ILIKE ${`%${query.search}%`})`
          : Prisma.empty
      }
    `;
  }

  private toReadModel(row: Row): IssuedDocumentReadModel {
    return {
      source: row.source === 'REPORT' ? 'REPORT' : 'EXECUTION',
      id: row.id,
      code: row.code,
      title: row.title,
      type: row.type,
      renderStatus: row.render_status,
      status: row.status,
      businessUnitId: row.business_unit_id,
      customerId: row.customer_id,
      operationId: row.operation_id,
      createdAt: row.created_at.toISOString(),
      issuedAt: row.issued_at ? row.issued_at.toISOString() : null,
      revisions: Number(row.revisions),
      periodFrom: row.period_from ? row.period_from.toISOString() : null,
      periodTo: row.period_to ? row.period_to.toISOString() : null,
    };
  }
}

/**
 * O fim do período é inclusivo.
 *
 * Quem filtra "até 31/03" espera o dia 31 inteiro, e uma data sem hora chega como
 * meia-noite: `<=` cru descartaria o dia todo. Mesma regra de `executionFilter` —
 * e, sim, escrita duas vezes, porque importar aquela acoplaria esta leitura ao
 * módulo de execuções por três linhas de aritmética.
 */
function endOfDay(value: string): Date {
  const data = new Date(value);
  if (value.length === 10) data.setUTCHours(23, 59, 59, 999);
  return data;
}
