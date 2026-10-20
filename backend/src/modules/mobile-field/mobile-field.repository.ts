/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import type { Prisma } from '@prisma/client';
import {
  fieldVisibilityFilter,
  requiresAssignmentAuthorization,
} from '../operations/operation-authorization';

export interface MobileFieldProjectionSource {
  businessUnits: readonly any[];
  operations: readonly any[];
  pmocCycles: readonly any[];
  rvtOccurrences: readonly any[];
  customers: readonly any[];
  rvtAssets: readonly any[];
}

export type MobileFieldProjectionTarget =
  | { kind: 'SERVICE_OPERATION'; sourceId: string }
  | { kind: 'PMOC'; sourceId: string; equipmentId: string }
  | { kind: 'RVT'; sourceId: string };

/**
 * Os recortes que a tela de Atendimentos aplica na origem.
 *
 * Filtrar depois de projetar seria mais simples e estaria errado: o cursor
 * pagina a projeção, e descartar itens já paginados devolveria páginas de
 * tamanhos imprevisíveis — a terceira página com dois itens, a quarta vazia,
 * e o botão "carregar mais" mentindo sobre haver mais.
 */
/**
 * Duas restrições sobre a mesma coluna viram uma, não a última.
 *
 * O bucket diz "antes de agora" e o filtro diz "dentro de setembro": o item
 * precisa satisfazer **as duas**. Mesclar os limites é o que preserva o
 * sentido de cada uma.
 */
function combinarJanela(
  doBucket: unknown,
  doFiltro: unknown,
): Record<string, unknown> {
  if (doBucket == null && doFiltro == null) return {};
  if (doFiltro == null) return {};
  if (doBucket == null) return { scheduledStart: doFiltro };
  if (typeof doBucket !== 'object' || typeof doFiltro !== 'object') {
    return { scheduledStart: doFiltro };
  }

  const bucket = doBucket as Record<string, unknown>;
  const filtro = doFiltro as Record<string, unknown>;
  const gte = [bucket.gte, filtro.gte].filter(Boolean) as Date[];
  const lte = [bucket.lte, filtro.lte].filter(Boolean) as Date[];
  const gt = bucket.gt ?? filtro.gt;

  return {
    scheduledStart: {
      ...(bucket.not !== undefined ? { not: bucket.not } : {}),
      ...(gt !== undefined ? { gt } : {}),

      /// O mais restritivo de cada lado vence.
      ...(gte.length
        ? { gte: new Date(Math.max(...gte.map((d) => d.getTime()))) }
        : {}),
      ...(lte.length
        ? { lte: new Date(Math.min(...lte.map((d) => d.getTime()))) }
        : {}),
    },
  };
}

export interface MobileFieldProjectionFilters {
  readonly customerId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Limite por classe operacional, não por tabela inteira.
 *
 * O antigo `ORDER BY scheduled_start LIMIT 500` deixava trabalhos sem data no
 * fim da consulta para sempre. Quatro recortes independentes mantêm a leitura
 * bounded e reservam espaço para cada classe que a fila efetivamente mostra.
 */
const OPERATIONS_PER_BUCKET = 125;

@Injectable()
export class MobileFieldRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /**
   * Documentos de campo emitidos recentemente nas unidades do técnico.
   *
   * Lê `field_artifacts` pelo índice `(organização, unidade, criado em)` — uma
   * consulta, e não uma por atendimento. O aplicativo montava isso pedindo o
   * contexto documental de cada item da fila, que é exatamente a cascata que
   * esta leitura existe para eliminar.
   */
  /**
   * O que esta pessoa terminou por último.
   *
   * ## Por que não sai da fila de trabalho
   *
   * A fila é o que **falta fazer**: a consulta dela exclui `COMPLETED` e
   * `CANCELLED`, e o `dueState` que ela projeta — hoje, atrasado, em
   * andamento, próximo — não tem estado para "pronto". Forçar concluído ali
   * mudaria a semântica de um contrato que o app inteiro lê, e por um motivo
   * de tela.
   *
   * Aqui é uma leitura separada, limitada e ordenada por conclusão: serve a
   * aba "Concluídos" da home sem tocar na fila.
   */
  /**
   * A liberação do valor e o orçamento vinculado de um atendimento.
   *
   * Consulta própria, e não um campo a mais na projeção da fila: o valor só é pedido
   * ao abrir **um** atendimento, e carregá-lo para os cinquenta da fila custaria um
   * join de orçamentos que nenhuma tela de lista usa.
   */
  operationAmount(organizationId: string, operationId: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id: operationId, organizationId, deletedAt: null },
        select: {
          amountVisibleInField: true,
          quote: { select: { total: true, status: true } },
        },
      }),
    );
  }

  recentlyCompleted(
    organizationId: string,
    businessUnitIds: readonly string[],
    actorId: string,
    take: number,
  ) {
    if (businessUnitIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.operation.findMany({
        where: {
          organizationId,
          businessUnitId: { in: [...businessUnitIds] },
          status: 'COMPLETED',
          completedAt: { not: null },

          /**
           * Só o que esta pessoa tocou. A home é pessoal; a lista da
           * organização inteira é outra tela.
           */
          OR: [
            { responsibleFieldTechnicianId: actorId },
            { auxiliaryTechnicians: { some: { userId: actorId } } },
          ],
        },
        orderBy: { completedAt: 'desc' },
        take,
        select: {
          id: true,
          code: true,
          title: true,
          kind: true,
          completedAt: true,
          customer: {
            select: { id: true, legalName: true, tradeName: true },
          },
          /** Só o primeiro nome: o cartão do histórico tem uma linha. */
          assets: {
            orderBy: { createdAt: 'asc' as const },
            take: 1,
            select: { asset: { select: { name: true } } },
          },
        },
      }),
    );
  }

  /**
   * Uma página da base de clientes da organização.
   *
   * ## Por que não é só quem tem trabalho
   *
   * A primeira versão da tela de Clientes derivava a lista da projeção de
   * trabalho, e 433 dos 498 clientes cadastrados não apareciam — um cliente
   * recém-criado, que por definição ainda não tem atendimento, nunca
   * apareceria. "Clientes" é a base; ter trabalho é um **atributo** dela.
   *
   * Paginado porque a base cresce: mandar quinhentos registros para caber uma
   * busca local funciona no ambiente de teste e trava no aparelho de quem tem
   * dois mil.
   */
  customersPage(
    organizationId: string,
    input: { search?: string; limit: number; cursor?: string },
  ) {
    const termo = input.search?.trim();
    return this.rls.run((tx) =>
      tx.customer.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(termo
            ? {
                OR: [
                  {
                    legalName: {
                      contains: termo,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    tradeName: {
                      contains: termo,
                      mode: 'insensitive' as const,
                    },
                  },
                  { documentNumber: { contains: termo } },
                ],
              }
            : {}),
        },

        /// Ordem estável por nome, desempatada pelo id: o cursor depende de a
        /// ordem não mudar entre páginas.
        orderBy: [{ legalName: 'asc' as const }, { id: 'asc' as const }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          documentNumber: true,
          status: true,
        },
      }),
    );
  }

  recentDocuments(
    organizationId: string,
    businessUnitIds: readonly string[],
    take: number,
  ) {
    if (businessUnitIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.fieldArtifact.findMany({
        where: {
          organizationId,
          businessUnitId: { in: [...businessUnitIds] },
        },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          documentType: true,
          createdAt: true,
          artifactExecution: {
            select: {
              renderStatus: true,
              title: true,
              customer: {
                select: { id: true, legalName: true, tradeName: true },
              },
            },
          },
        },
      }),
    );
  }

  /**
   * Uma página de documentos, na ordem em que foram emitidos.
   *
   * Ordena por `createdAt desc` com desempate por `id`: dois documentos
   * emitidos no mesmo milissegundo — o que acontece quando uma execução gera
   * mais de um — precisam de ordem total, senão a mesma linha aparece em duas
   * páginas.
   */
  documentsPage(
    organizationId: string,
    businessUnitIds: readonly string[],
    options: {
      type?: string;
      search?: string;
      customerId?: string;
      from?: Date;
      to?: Date;
      take: number;
      cursorId?: string;
    },
  ) {
    if (businessUnitIds.length === 0) return Promise.resolve([]);
    const termo = options.search?.trim();
    return this.rls.run((tx) =>
      tx.fieldArtifact.findMany({
        where: {
          organizationId,
          businessUnitId: { in: [...businessUnitIds] },
          ...(options.type ? { documentType: options.type } : {}),

          /// A janela é sobre a **emissão** do documento, que é a data que
          /// quem procura tem na cabeça — "o relatório da semana passada".
          ...(options.from || options.to
            ? {
                createdAt: {
                  ...(options.from ? { gte: options.from } : {}),
                  ...(options.to ? { lte: options.to } : {}),
                },
              }
            : {}),

          /// Cliente e busca moram na execução do artefato: o documento é o
          /// arquivo, e o contexto é dela.
          ...(options.customerId || termo
            ? {
                artifactExecution: {
                  ...(options.customerId
                    ? { customerId: options.customerId }
                    : {}),
                  ...(termo
                    ? {
                        OR: [
                          {
                            customer: {
                              legalName: {
                                contains: termo,
                                mode: 'insensitive' as const,
                              },
                            },
                          },
                          {
                            customer: {
                              tradeName: {
                                contains: termo,
                                mode: 'insensitive' as const,
                              },
                            },
                          },
                          {
                            title: {
                              contains: termo,
                              mode: 'insensitive' as const,
                            },
                          },
                        ],
                      }
                    : {}),
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.take,
        ...(options.cursorId
          ? { cursor: { id: options.cursorId }, skip: 1 }
          : {}),
        select: {
          id: true,
          documentType: true,
          createdAt: true,
          artifactExecution: {
            select: {
              renderStatus: true,
              customer: { select: { legalName: true, tradeName: true } },
            },
          },
        },
      }),
    );
  }

  /** Compromissos recentes da agenda, nas unidades do técnico. */
  recentAppointments(
    organizationId: string,
    businessUnitIds: readonly string[],
    take: number,
  ) {
    if (businessUnitIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.schedulingEvent.findMany({
        where: {
          organizationId,
          businessUnitId: { in: [...businessUnitIds] },
          deletedAt: null,
        },
        orderBy: { startsAt: 'desc' },
        take,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          startsAt: true,
          customer: { select: { legalName: true, tradeName: true } },
        },
      }),
    );
  }

  project(
    organizationId: string,
    actorId: string,
    businessUnitIds: readonly string[],
    target?: MobileFieldProjectionTarget,
    filters?: MobileFieldProjectionFilters,
  ): Promise<MobileFieldProjectionSource> {
    return this.rls.run(async (tx) => {
      const businessUnits = await tx.businessUnit.findMany({
        where: {
          organizationId,
          id: { in: [...businessUnitIds] },
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          timezone: true,
        },
      });
      const scopedIds = businessUnits.map((unit) => unit.id);
      if (!scopedIds.length)
        return {
          businessUnits,
          operations: [],
          pmocCycles: [],
          rvtOccurrences: [],
          customers: [],
          rvtAssets: [],
        };

      /**
       * Os recortes da tela de Atendimentos.
       *
       * Cliente e janela de datas entram **aqui**, no `where` compartilhado,
       * e não em cada bucket: os buckets existem para ordenar por urgência, e
       * repetir o filtro em quatro lugares é como um deles fica para trás na
       * próxima mudança.
       */
      const recorteDeCliente = filters?.customerId
        ? { customerId: filters.customerId }
        : {};
      const janela =
        filters?.from || filters?.to
          ? {
              scheduledStart: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {};

      /**
       * A autorização da atribuição, quando a organização a exige.
       *
       * Aqui é onde a preferência deixa de ser decorativa: até a PR-36 ela era
       * gravada em `settings` e **nenhuma consulta a lia**, então ligá-la não
       * escondia nada — o técnico continuava vendo tudo pelo aplicativo.
       *
       * Fica no `where` compartilhado pela mesma razão do recorte de cliente:
       * os buckets existem para ordenar por urgência, e repetir a regra em
       * quatro lugares é como um deles fica para trás.
       */
      const organizacao = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      });
      const recorteDeAutorizacao = fieldVisibilityFilter(
        requiresAssignmentAuthorization(organizacao?.settings ?? null),
      );

      const operationWhere = {
        organizationId,
        businessUnitId: { in: scopedIds },
        deletedAt: null,
        ...recorteDeCliente,
        ...recorteDeAutorizacao,
        ...janela,
        OR: [
          { responsibleFieldTechnicianId: actorId },
          {
            auxiliaryTechnicians: {
              some: { userId: actorId, removedAt: null },
            },
          },
        ],
      };
      /**
       * Tipado, e não um literal solto.
       *
       * Este `select` era um objeto sem tipo: quando `Operation.assetId` deu
       * lugar à lista de equipamentos, o `tsc` passou limpo e o endpoint
       * quebrou em runtime com `PrismaClientValidationError`. `satisfies` é o
       * que faz o compilador apontar a próxima mudança de schema aqui.
       */
      const operationSelect = {
        id: true,
        businessUnitId: true,
        customerId: true,
        customerAddressId: true,
        /**
         * Para onde o técnico vai, com as partes separadas.
         *
         * `location` da operação já existia, mas é um blob livre — e, quando vazio,
         * cai no endereço **fiscal** do cliente. Nenhum dos dois carrega complemento
         * e ponto de referência em campo próprio, que é o que decide se a pessoa
         * acha a portaria.
         */
        customerAddress: {
          select: {
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
        kind: true,
        sector: true,
        /* O pedido em aberto, para a tela parar de oferecer a ação. No máximo um
           por atendimento — garantido pelo índice parcial. */
        cancellationRequests: {
          where: { status: 'PENDING' },
          select: { id: true, reason: true, requestedAt: true },
          take: 1,
        },
        code: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        scheduledStart: true,
        scheduledEnd: true,
        startedAt: true,
        completedAt: true,
        location: true,
        updatedAt: true,
        responsibleFieldTechnician: {
          select: { id: true, displayName: true },
        },
        auxiliaryTechnicians: {
          where: { removedAt: null },
          select: { user: { select: { id: true, displayName: true } } },
        },
        assets: {
          orderBy: { createdAt: 'asc' as const },
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
        artifactExecutions: {
          where: { status: { in: ['APPROVED', 'COMPLETED', 'ARCHIVED'] } },
          take: 10,
          orderBy: { updatedAt: 'desc' as const },
          select: {
            id: true,
            status: true,
            renderStatus: true,
            snapshot: { select: { artifactType: true } },
          },
        },
        checklistExecutions: {
          take: 20,
          orderBy: { updatedAt: 'desc' as const },
          select: {
            id: true,
            status: true,
            template: { select: { name: true } },
          },
        },
      } satisfies Prisma.OperationSelect;

      let operations: any[] = [];
      if (!target || target.kind === 'SERVICE_OPERATION') {
        if (target) {
          operations = await tx.operation.findMany({
            where: {
              ...operationWhere,
              id: target.sourceId,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
            take: 1,
            select: operationSelect,
          });
        } else {
          const now = new Date();
          const buckets = [
            {
              status: { in: ['IN_PROGRESS', 'PAUSED'] },
              orderBy: [{ updatedAt: 'desc' as const }, { id: 'asc' as const }],
            },
            {
              status: {
                notIn: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED'],
              },
              scheduledStart: { not: null, lte: now },
              orderBy: [
                { scheduledStart: 'desc' as const },
                { id: 'asc' as const },
              ],
            },
            {
              status: {
                notIn: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED'],
              },
              scheduledStart: { gt: now },
              orderBy: [
                { scheduledStart: 'asc' as const },
                { id: 'asc' as const },
              ],
            },
            {
              status: {
                notIn: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED'],
              },
              scheduledStart: null,
              orderBy: [{ updatedAt: 'desc' as const }, { id: 'asc' as const }],
            },
          ];
          for (const { orderBy, ...where } of buckets) {
            /**
             * A janela de datas é **combinada** com a do bucket, não
             * espalhada por cima dela.
             *
             * Cada bucket define o próprio `scheduledStart` — é assim que ele
             * separa atrasado de futuro de sem data. Um spread ingênuo
             * (`{...operationWhere, ...where}`) faz o do bucket sobrescrever o
             * do filtro, e a consulta devolve itens fora da janela pedida: foi
             * exatamente o que aconteceu, com dois atrasados de setembro
             * passando por uma janela de 2030.
             *
             * Quando o bucket é o de "sem data", a janela não se aplica:
             * `scheduledStart: null` e um intervalo são mutuamente
             * exclusivos, e o certo é o item sumir — quem filtrou por data
             * não está pedindo o que não tem data.
             */
            const semData =
              'scheduledStart' in where && where.scheduledStart === null;
            const janelaDoBucket = semData
              ? {}
              : combinarJanela(
                  (where as { scheduledStart?: unknown }).scheduledStart,
                  janela.scheduledStart,
                );

            const filtraPorData = Boolean(filters?.from || filters?.to);
            if (semData && filtraPorData) continue;

            operations.push(
              ...(await tx.operation.findMany({
                where: { ...operationWhere, ...where, ...janelaDoBucket },
                take: OPERATIONS_PER_BUCKET,
                orderBy,
                select: operationSelect,
              })),
            );
          }
        }
      }

      const pmocCycles =
        target?.kind && target.kind !== 'PMOC'
          ? []
          : await tx.pmocExecution.findMany({
              where: {
                organizationId,
                ...(target?.kind === 'PMOC' ? { id: target.sourceId } : {}),
                status: { notIn: ['COMPLETED', 'CANCELLED'] },

                /// O ciclo tem `dueOn`, não `scheduledStart`: a janela de
                /// datas precisa ser traduzida, não copiada.
                ...(filters?.from || filters?.to
                  ? {
                      dueOn: {
                        ...(filters.from ? { gte: filters.from } : {}),
                        ...(filters.to ? { lte: filters.to } : {}),
                      },
                    }
                  : {}),
                plan: {
                  businessUnitId: { in: scopedIds },
                  status: 'ACTIVE',
                  schedulingPaused: false,

                  /// O cliente do PMOC é do **plano**, não do ciclo.
                  ...(filters?.customerId
                    ? { customerId: filters.customerId }
                    : {}),
                  OR: [
                    {
                      technicianUserId: actorId,
                      technician: {
                        professionalProfiles: {
                          some: {
                            organizationId,
                            active: true,
                            fieldTechnicianEnabled: true,
                          },
                        },
                      },
                    },
                    {
                      executions: {
                        some: {
                          equipmentExecutions: {
                            some: { responsibleFieldTechnicianId: actorId },
                          },
                        },
                      },
                    },
                  ],
                },
              },
              take: target?.kind === 'PMOC' ? 1 : 300,
              orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                dueOn: true,
                status: true,
                schedulingEventId: true,
                updatedAt: true,
                artifactExecution: {
                  select: {
                    id: true,
                    status: true,
                    renderStatus: true,
                    snapshot: { select: { artifactType: true } },
                  },
                },
                plan: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    businessUnitId: true,
                    customerId: true,
                    serviceLocation: true,
                    technician: { select: { id: true, displayName: true } },
                    technicalResponsibleUserId: true,
                    coverages: {
                      where: {
                        deletedAt: null,
                        ...(target?.kind === 'PMOC'
                          ? { assetId: target.equipmentId }
                          : {}),
                      },
                      take: 100,
                      select: {
                        id: true,
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
                  },
                },
                equipmentExecutions: {
                  select: {
                    id: true,
                    coverageId: true,
                    status: true,
                    responsibleFieldTechnician: {
                      select: { id: true, displayName: true },
                    },
                    operation: {
                      select: {
                        auxiliaryTechnicians: {
                          where: { removedAt: null },
                          select: {
                            user: { select: { id: true, displayName: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            });

      const rvtOccurrences =
        target?.kind && target.kind !== 'RVT'
          ? []
          : await tx.rvtOccurrence.findMany({
              where: {
                organizationId,
                ...(target?.kind === 'RVT' ? { id: target.sourceId } : {}),
                businessUnitId: { in: scopedIds },
                status: { notIn: ['COMPLETED', 'CANCELLED'] },
                ...(filters?.customerId
                  ? { configuration: { customerId: filters.customerId } }
                  : {}),
                ...(filters?.from || filters?.to
                  ? {
                      scheduledFor: {
                        ...(filters.from ? { gte: filters.from } : {}),
                        ...(filters.to ? { lte: filters.to } : {}),
                      },
                    }
                  : {}),
                OR: [
                  {
                    configuration: {
                      defaultResponsibleFieldTechnicianId: actorId,
                    },
                  },
                  { execution: { responsibleFieldTechnicianId: actorId } },
                ],
              },
              take: target?.kind === 'RVT' ? 1 : 300,
              orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                businessUnitId: true,
                scheduledFor: true,
                status: true,
                schedulingEventId: true,
                updatedAt: true,
                configuration: {
                  select: {
                    id: true,
                    name: true,
                    maintenanceType: {
                      select: { id: true, key: true, label: true },
                    },
                    customerId: true,
                    serviceLocation: true,
                    timezone: true,
                    defaultResponsibleFieldTechnicianId: true,
                    equipment: {
                      where: { removedAt: null },
                      take: 100,
                      select: { assetId: true },
                    },
                  },
                },
                execution: {
                  select: {
                    id: true,
                    status: true,
                    artifactExecutionId: true,
                    responsibleFieldTechnicianId: true,
                  },
                },
              },
            });

      const customerIds = new Set<string>();
      operations.forEach(
        (item: { customerId: string | null }) =>
          item.customerId && customerIds.add(item.customerId),
      );
      pmocCycles.forEach((item) => customerIds.add(item.plan.customerId));
      rvtOccurrences.forEach((item) =>
        customerIds.add(item.configuration.customerId),
      );
      const customers = await tx.customer.findMany({
        where: {
          organizationId,
          id: { in: [...customerIds] },
          deletedAt: null,
        },
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
      });
      const rvtAssetIds = rvtOccurrences.flatMap((item) =>
        item.configuration.equipment.map((equipment) => equipment.assetId),
      );
      const rvtAssets = await tx.asset.findMany({
        where: {
          organizationId,
          businessUnitId: { in: scopedIds },
          id: { in: rvtAssetIds },
          deletedAt: null,
        },
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
      });
      return {
        businessUnits,
        operations,
        pmocCycles,
        rvtOccurrences,
        customers,
        rvtAssets,
      };
    });
  }
}
