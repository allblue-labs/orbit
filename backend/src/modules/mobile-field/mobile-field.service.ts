/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { Injectable, Logger } from '@nestjs/common';
import { EntityNotFoundException, ForbiddenException } from '../../exceptions';
import { civilDateKey } from '../scheduling/scheduling-time';
import type {
  MobileDocumentsQueryDto,
  MobileFieldCustomersQueryDto,
  MobileWorkQueueQueryDto,
} from './mobile-field.dto';
import {
  MobileFieldRepository,
  type MobileFieldProjectionFilters,
  type MobileFieldProjectionTarget,
} from './mobile-field.repository';
import type { ArtifactRenderStatus } from '../artifact-rendering/artifact-render.read-models';
import type { OperationKind } from '../../contracts/literals';
import type {
  MobileArtifactSummaryReadModel,
  MobileCustomerSummaryReadModel,
  MobileDueState,
  MobileEquipmentSummaryReadModel,
  MobileFieldAction,
  MobileFieldContextReadModel,
  MobileFieldDashboardReadModel,
  MobileWorkItemReadModel,
  MobileWorkQueueReadModel,
  MobileFieldHomeReadModel,
  MobileDocumentsPageReadModel,
  MobileRecentDocumentReadModel,
  MobileFieldCustomerPageReadModel,
  MobileQueueCustomerReadModel,
  MobileServiceAddressReadModel,
} from './mobile-field.read-models';

/** Quantos itens cada recorte curto da tela inicial traz. */
const RECENTES = 5;

/** Os rótulos públicos dos documentos de campo. A tela não traduz enum. */
const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  SERVICE_ORDER: 'Ordem de serviço',
  ORDEM_SERVICO: 'Ordem de serviço',
  PMOC: 'PMOC',
  RVT: 'RVT',
  RELATORIO_VISITA: 'RVT',
  TECHNICAL_REPORT: 'Relatório técnico',
  RELATORIO_TECNICO: 'Relatório técnico',
};

/**
 * O tipo do atendimento, em português.
 *
 * Fechado sobre `OperationKind` pela mesma razão que `DOCUMENT_STATES`: um tipo novo
 * no domínio deixa de compilar aqui até alguém decidir como ele se chama para quem
 * está em campo. A alternativa — o aplicativo traduzir a sigla — espalharia o
 * vocabulário do produto por duas bases de código.
 */
const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  INSTALLATION: 'Instalação',
  MAINTENANCE: 'Manutenção',
  INSPECTION: 'Inspeção',
  DELIVERY: 'Entrega',
  OTHER: 'Outro',
};

/**
 * De estado de renderização para o que a tela pode oferecer.
 *
 * **Exaustivo de propósito.** A primeira versão comparava com a string
 * `'RENDERED'`, que nenhum ponto do sistema produz — o estado pronto se chama
 * `READY`. O efeito foi silencioso e do pior tipo: nada quebrou, nenhum teste
 * caiu, e todo documento emitido aparecia como "Preparando" para sempre.
 *
 * Declarar o mapa sobre `ArtifactRenderStatus` transforma o mesmo erro em erro
 * de compilação: um estado novo no domínio deixa de compilar aqui até alguém
 * decidir o que ele significa para quem está em campo.
 */
const DOCUMENT_STATES: Record<
  ArtifactRenderStatus,
  MobileRecentDocumentReadModel['state']
> = {
  NOT_RENDERED: 'PREPARING',
  PENDING: 'PREPARING',
  RENDERING: 'PREPARING',
  READY: 'AVAILABLE',
  FAILED: 'FAILED',
};

export interface MobileFieldActor {
  id: string;
  organizationId: string;
  businessUnitIds: readonly string[];
  permissions: readonly string[];
  /** Structural owner; relevant to self-service access, never product gates. */
  isOrganizationOwner?: boolean;
}

@Injectable()
export class MobileFieldService {
  private readonly logger = new Logger(MobileFieldService.name);
  constructor(private readonly repository: MobileFieldRepository) {}

  /**
   * A tela inicial do técnico, numa leitura.
   *
   * Junta o painel que já existia com dois recortes curtos — documentos e
   * compromissos recentes. Nenhuma regra nova: os filtros de permissão e o
   * isolamento por unidade são os mesmos, e o rótulo público do tipo de
   * documento é resolvido aqui para que a tela não traduza enum.
   */
  async home(actor: MobileFieldActor): Promise<MobileFieldHomeReadModel> {
    const [dashboard, documentos, compromissos, concluidos] = await Promise.all(
      [
        this.dashboard(actor),
        this.has(actor, 'artifact_executions.read')
          ? this.repository.recentDocuments(
              actor.organizationId,
              actor.businessUnitIds,
              RECENTES,
              actor,
            )
          : Promise.resolve([]),
        this.repository.recentAppointments(
          actor.organizationId,
          actor.businessUnitIds,
          RECENTES,
        ),
        this.repository.recentlyCompleted(
          actor.organizationId,
          actor.businessUnitIds,
          actor.id,
          RECENTES,
        ),
      ],
    );

    return {
      dashboard,
      recentlyCompleted: concluidos.map((operacao) => ({
        id: operacao.id,
        code: operacao.code,
        title: operacao.title,
        kind: operacao.kind,
        customerName:
          operacao.customer?.tradeName ?? operacao.customer?.legalName ?? null,
        equipmentName: operacao.assets[0]?.asset.name ?? null,
        completedAt: operacao.completedAt!.toISOString(),
      })),
      recentDocuments: documentos.map((documento) =>
        this.toDocument(documento),
      ),
      recentAppointments: compromissos.map((compromisso) => ({
        id: compromisso.id,
        title: compromisso.title,
        customerName:
          compromisso.customer?.tradeName ??
          compromisso.customer?.legalName ??
          null,
        type: compromisso.type,
        status: compromisso.status,
        startsAt: compromisso.startsAt.toISOString(),
      })),
    };
  }

  /**
   * A tela de Documentos, paginada.
   *
   * Mesma projeção da tela inicial, sem o teto de cinco. Nenhuma regra nova: o
   * isolamento por organização e unidade é o mesmo, e o filtro por tipo é
   * recorte de leitura.
   */
  async documents(
    actor: MobileFieldActor,
    query: MobileDocumentsQueryDto,
  ): Promise<MobileDocumentsPageReadModel> {
    const started = performance.now();
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;

    /**
     * Pede um a mais do que cabe na página. É como se sabe que existe próxima
     * sem contar a tabela inteira — e sem prometer uma página seguinte vazia.
     */
    const linhas = await this.repository.documentsPage(
      actor.organizationId,
      actor.businessUnitIds,
      {
        ...(query.type ? { type: query.type } : {}),
        ...(query.search ? { search: query.search } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.from
          ? { from: new Date(`${query.from}T00:00:00.000Z`) }
          : {}),
        ...(query.to ? { to: new Date(`${query.to}T23:59:59.999Z`) } : {}),
        take: limit + 1,
        ...(cursor ? { cursorId: cursor.id } : {}),
      },
      actor,
    );

    const hasNextPage = linhas.length > limit;
    const data = linhas.slice(0, limit).map((linha) => this.toDocument(linha));
    const last = data.at(-1);
    this.metric('documents', started, data.length);
    return {
      data,
      meta: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last ? this.encodeCursor(last.artifactId) : null,
      },
    };
  }

  /** A linha do banco vira documento público — o rótulo já resolvido. */
  private toDocument(documento: {
    id: string;
    documentType: string;
    createdAt: Date;
    artifactExecution: {
      renderStatus: string;
      customer: { legalName: string; tradeName: string | null } | null;
    };
  }): MobileRecentDocumentReadModel {
    return {
      artifactId: documento.id,
      documentType: documento.documentType,
      label: DOCUMENT_LABELS[documento.documentType] ?? 'Documento',
      customerName:
        documento.artifactExecution.customer?.tradeName ??
        documento.artifactExecution.customer?.legalName ??
        null,
      createdAt: documento.createdAt.toISOString(),
      /**
       * Disponível só quando a renderização terminou; nunca oferece um arquivo
       * que não existe.
       */
      state:
        DOCUMENT_STATES[
          documento.artifactExecution.renderStatus as ArtifactRenderStatus
        ] ?? 'PREPARING',
    };
  }

  async dashboard(
    actor: MobileFieldActor,
  ): Promise<MobileFieldDashboardReadModel> {
    const started = performance.now();
    const items = await this.items(actor);
    const visible = items.filter((item) => this.matchesPermission(item));
    const result = {
      next:
        visible.find(
          (item) =>
            item.dueState !== 'IN_PROGRESS' && item.dueState !== 'OVERDUE',
        ) ?? null,
      counters: {
        today: visible.filter((item) => item.dueState === 'DUE_TODAY').length,
        overdue: visible.filter((item) => item.dueState === 'OVERDUE').length,
        inProgress: visible.filter((item) => item.dueState === 'IN_PROGRESS')
          .length,
        upcoming: visible.filter((item) => item.dueState === 'UPCOMING').length,
      },
      today: visible
        .filter((item) => item.dueState === 'DUE_TODAY')
        .slice(0, 5),
      overdue: visible
        .filter((item) => item.dueState === 'OVERDUE')
        .slice(0, 5),
      inProgress: visible
        .filter((item) => item.dueState === 'IN_PROGRESS')
        .slice(0, 5),
      capabilities: {
        canScanEquipment: this.has(actor, 'assets.read'),
        canCreateAdHocRvt:
          this.has(actor, 'rvt.execute') &&
          (actor.isOrganizationOwner === true ||
            Boolean(
              await this.repository.canExecuteRvt(
                actor.organizationId,
                actor.id,
              ),
            )),
      },
    };
    this.metric('dashboard', started, visible.length);
    return result;
  }

  /**
   * Os clientes que esta pessoa tem trabalho — e só eles.
   *
   * ## Por que não é `/customers`
   *
   * A lista de clientes da organização pode ter centenas, exige
   * `customers.read` (que um técnico não necessariamente tem) e, o que mais
   * importa, filtrar a fila por um cliente onde não há trabalho devolve uma
   * tela vazia que parece defeito.
   *
   * Isto sai da mesma projeção que alimenta a fila: se aparece aqui, há pelo
   * menos um atendimento atrás.
   */
  async queueCustomers(
    actor: MobileFieldActor,
  ): Promise<readonly MobileQueueCustomerReadModel[]> {
    const items = (await this.items(actor)).filter((item) =>
      this.matchesPermission(item),
    );

    const porId = new Map<string, MobileQueueCustomerReadModel>();
    for (const item of items) {
      const cliente = item.customer;
      if (!cliente) continue;
      const atual = porId.get(cliente.id);
      porId.set(cliente.id, {
        id: cliente.id,
        name: cliente.name,
        workCount: (atual?.workCount ?? 0) + 1,
      });
    }

    /// Quem tem mais trabalho primeiro, e o nome desempata: uma lista que
    /// muda de ordem a cada carga é uma lista que ninguém aprende.
    return [...porId.values()].sort(
      (a, b) => b.workCount - a.workCount || a.name.localeCompare(b.name),
    );
  }

  /**
   * A base de clientes, com o trabalho desta pessoa anotado em cada um.
   *
   * ## O que mudou, e por quê
   *
   * A primeira versão derivava a lista da projeção de trabalho. O efeito foi
   * que 433 dos 498 clientes cadastrados não apareciam, e um cliente criado
   * naquela mesma tela — que por definição ainda não tem atendimento — também
   * não. "Clientes" é a base; ter trabalho é um atributo dela.
   *
   * A contagem continua sendo **pessoal**: quantos atendimentos em aberto e
   * concluídos esta pessoa tem com aquele cliente. É o que faz a lista ser
   * útil em campo sem virar um relatório da organização.
   */
  async fieldCustomers(
    actor: MobileFieldActor,
    query: MobileFieldCustomersQueryDto,
  ): Promise<MobileFieldCustomerPageReadModel> {
    const limit = query.limit ?? 30;

    const [pagina, itens, concluidos] = await Promise.all([
      this.repository.customersPage(actor.organizationId, {
        search: query.search,
        limit,
        cursor: query.cursor,
      }),
      this.items(actor).then((lista) =>
        lista.filter((item) => this.matchesPermission(item)),
      ),
      this.repository.recentlyCompleted(
        actor.organizationId,
        actor.businessUnitIds,
        actor.id,
        200,
      ),
    ]);

    /// As contagens são montadas uma vez, num mapa, e não por cliente da
    /// página: varrer a projeção dentro do laço seria trinta varreduras.
    const abertos = new Map<string, number>();
    const proximos = new Map<string, string>();
    for (const item of itens) {
      const id = item.customer?.id;
      if (!id) continue;
      abertos.set(id, (abertos.get(id) ?? 0) + 1);
      if (item.scheduledFor != null) {
        const atual = proximos.get(id);
        if (atual == null || item.scheduledFor < atual) {
          proximos.set(id, item.scheduledFor);
        }
      }
    }

    const feitos = new Map<string, number>();
    const ultimos = new Map<string, string>();
    for (const operacao of concluidos) {
      const id = operacao.customer?.id;
      if (!id || operacao.completedAt == null) continue;
      feitos.set(id, (feitos.get(id) ?? 0) + 1);
      const quando = operacao.completedAt.toISOString();
      const atual = ultimos.get(id);
      if (atual == null || quando > atual) ultimos.set(id, quando);
    }

    const temProxima = pagina.length > limit;
    const linhas = pagina.slice(0, limit);

    return {
      data: linhas.map((cliente) => ({
        id: cliente.id,
        name: cliente.tradeName ?? cliente.legalName,
        legalName: cliente.legalName,
        documentNumber: cliente.documentNumber,
        status: cliente.status,
        openCount: abertos.get(cliente.id) ?? 0,
        completedCount: feitos.get(cliente.id) ?? 0,
        lastServiceAt: ultimos.get(cliente.id) ?? null,
        nextServiceAt: proximos.get(cliente.id) ?? null,
      })),
      meta: {
        limit,
        hasNextPage: temProxima,
        nextCursor: temProxima ? (linhas.at(-1)?.id ?? null) : null,
      },
    };
  }

  async workQueue(
    actor: MobileFieldActor,
    query: MobileWorkQueueQueryDto,
  ): Promise<MobileWorkQueueReadModel> {
    const started = performance.now();
    const view = query.view ?? 'ALL';

    /**
     * Cliente e datas são aplicados **na origem**, não sobre a projeção.
     *
     * Filtrar depois de projetar devolveria páginas de tamanhos
     * imprevisíveis: o cursor pagina a lista inteira, e descartar itens já
     * paginados dá a terceira página com dois itens e a quarta vazia, com o
     * "carregar mais" mentindo sobre haver mais.
     */
    const filters: MobileFieldProjectionFilters = {
      customerId: query.customerId,
      from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    };

    /**
     * A busca é aplicada sobre a projeção, e não na origem.
     *
     * Três tabelas alimentam a fila — operações, ciclos PMOC e ocorrências
     * RVT — e cada uma guarda o cliente num lugar diferente. Um `OR` textual
     * por tabela seriam três consultas divergentes que envelhecem separado.
     * A projeção já normalizou cliente, título e código; procurar aqui é um
     * lugar só, e a lista é limitada por classe antes de chegar.
     */
    const busca = query.search?.trim().toLowerCase();

    let items = (await this.items(actor, undefined, filters)).filter(
      (item) =>
        this.matchesPermission(item) &&
        (!query.kind || item.kind === query.kind) &&
        (view === 'ALL' || this.matchesView(item.dueState, view)) &&
        (!busca || this.matchesSearch(item, busca)),
    );
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    if (cursor) {
      const index = items.findIndex((item) => item.id === cursor.id);
      if (index < 0)
        throw new ForbiddenException('Cursor da fila de campo inválido');
      items = items.slice(index + 1);
    }
    const limit = query.limit ?? 20;
    const page = items.slice(0, limit + 1);
    const hasNextPage = page.length > limit;
    const data = page.slice(0, limit);
    const last = data.at(-1);
    const result = {
      data,
      meta: {
        limit,
        hasNextPage,
        nextCursor: hasNextPage && last ? this.encodeCursor(last.id) : null,
      },
    };
    this.metric('work_queue', started, data.length);
    return result;
  }

  async fieldContext(
    actor: MobileFieldActor,
    canonicalId: string,
  ): Promise<MobileFieldContextReadModel> {
    const target = this.projectionTarget(canonicalId);
    const item = target
      ? (await this.items(actor, target)).find(
          (candidate) =>
            candidate.id === canonicalId && this.matchesPermission(candidate),
        )
      : undefined;
    if (!item) throw new EntityNotFoundException('MobileWorkItem', canonicalId);
    return {
      workItem: item,
      request: { description: item.description },
      procedures: [],
      documentContext: item.artifacts,
      ...(await this.financialSummary(actor, canonicalId)),
      snapshotVersion: 1,
    };
  }

  /**
   * Quanto o atendimento vale — só quando o dono liberou aquele atendimento.
   *
   * ## Omitir, e não zerar
   *
   * O campo sai do objeto quando não há liberação. `{ approvedAmount: null }` diria
   * ao aplicativo "este atendimento não tem valor", que é uma afirmação diferente de
   * "não cabe a você ver" — e a tela mostraria "R$ 0,00" num serviço de oito mil.
   *
   * O valor manual tem prioridade, inclusive quando é zero. Sem valor manual,
   * usa o total do orçamento vinculado. Sem ambos, publica valor nulo.
   */
  private async financialSummary(
    actor: MobileFieldActor,
    canonicalId: string,
  ): Promise<Pick<MobileFieldContextReadModel, 'financialSummary'> | object> {
    if (!canonicalId.startsWith('SERVICE_OPERATION:')) return {};
    const operationId = canonicalId.slice('SERVICE_OPERATION:'.length);
    const operation = await this.repository.operationAmount(
      actor.organizationId,
      operationId,
    );
    /* Não liberado: o campo não existe. É a única forma de dizer "não cabe a
       você ver" sem afirmar nada sobre o valor. */
    if (!operation?.amountVisibleInField) return {};

    if (
      operation.manualAmount !== null &&
      operation.manualAmount !== undefined
    ) {
      return {
        financialSummary: {
          currency: 'BRL',
          approvedAmount: operation.manualAmount.toString(),
          paymentStatus: null,
        },
      };
    }

    /**
     * Liberado e sem orçamento: o campo **existe**, com valor nulo.
     *
     * Os dois casos vinham omitidos juntos, e o efeito era o dono ligar a
     * chave, não ver nada e concluir que a liberação não funcionou. São
     * situações diferentes e agora se distinguem: aqui a tela diz que falta
     * vincular um orçamento, que é a ação que resolve.
     */
    if (!operation.quote) {
      return {
        financialSummary: {
          currency: 'BRL',
          approvedAmount: null,
          paymentStatus: null,
        },
      };
    }

    return {
      financialSummary: {
        currency: 'BRL',
        approvedAmount: operation.quote.total.toString(),
        paymentStatus: operation.quote.status,
      },
    };
  }

  /** Authoritative bounded projection reused by offline packaging/sync. */
  async offlineItems(
    actor: MobileFieldActor,
  ): Promise<MobileWorkItemReadModel[]> {
    return (await this.items(actor)).filter((item) =>
      this.matchesPermission(item),
    );
  }

  private async items(
    actor: MobileFieldActor,
    target?: MobileFieldProjectionTarget,
    filters?: MobileFieldProjectionFilters,
  ): Promise<MobileWorkItemReadModel[]> {
    if (!actor.organizationId || !actor.businessUnitIds.length) return [];
    const source = await this.repository.project(
      actor.organizationId,
      actor.id,
      actor.businessUnitIds,
      target,
      filters,
    );
    const units = new Map(source.businessUnits.map((unit) => [unit.id, unit]));
    const customers = new Map(
      source.customers.map((customer) => [customer.id, customer]),
    );
    const assets = new Map(source.rvtAssets.map((asset) => [asset.id, asset]));
    const result: MobileWorkItemReadModel[] = [];

    for (const operation of source.operations) {
      const unit = units.get(operation.businessUnitId);
      if (!unit) continue;
      const actions = this.operationActions(operation, actor);
      result.push({
        id: `SERVICE_OPERATION:${operation.id}`,
        kind: 'SERVICE_OPERATION',
        sourceId: operation.id,
        schedulingId: null,
        title: operation.title,
        description: operation.description,
        businessUnit: this.party(unit),
        customer: this.customer(customers.get(operation.customerId)),
        location:
          operation.location ??
          customers.get(operation.customerId)?.address ??
          null,
        serviceAddress: this.serviceAddress(
          operation.customerAddress,
          operation.sector,
        ),
        serviceType: OPERATION_KIND_LABELS[operation.kind] ?? null,
        pendingCancellation: operation.cancellationRequests?.[0]
          ? {
              id: operation.cancellationRequests[0].id,
              reason: operation.cancellationRequests[0].reason,
              requestedAt:
                operation.cancellationRequests[0].requestedAt.toISOString(),
            }
          : null,
        scheduledFor: operation.scheduledStart?.toISOString() ?? null,
        scheduledEnd: operation.scheduledEnd?.toISOString() ?? null,
        timezone: unit.timezone,
        dueState: this.dueState(
          operation.status,
          operation.scheduledStart,
          unit.timezone,
        ),
        operationalStatus: operation.status,
        priority: operation.priority,
        responsibleFieldTechnician: operation.responsibleFieldTechnician
          ? this.party(operation.responsibleFieldTechnician)
          : null,
        auxiliaryTechnicians: operation.auxiliaryTechnicians.map((value: any) =>
          this.party(value.user),
        ),
        equipmentSummary: (operation.assets ?? []).map((link: any) =>
          this.equipment(link.asset),
        ),
        artifacts: operation.artifactExecutions.map((value: any) =>
          this.artifact(value),
        ),
        allowedActions: actions,
        primaryAction: this.primary(actions),
        navigationContext: {
          kind: 'SERVICE_OPERATION',
          sourceId: operation.id,
          /* Atendimento avulso não pertence a plano de PMOC. */
          planId: null,
          executionId: null,
          occurrenceId: null,
          cycleId: null,
          equipmentId: operation.assetId,
        },
        updatedAt: operation.updatedAt.toISOString(),
      });
    }

    for (const cycle of source.pmocCycles) {
      const unit = units.get(cycle.plan.businessUnitId);
      if (!unit) continue;
      for (const coverage of cycle.plan.coverages) {
        const execution = cycle.equipmentExecutions.find(
          (value: any) => value.coverageId === coverage.id,
        );
        if (
          execution &&
          execution.responsibleFieldTechnician.id !== actor.id &&
          !execution.operation?.auxiliaryTechnicians.some(
            (value: any) => value.user.id === actor.id,
          )
        )
          continue;
        const actions = this.pmocActions(cycle, execution, actor);
        result.push({
          id: `PMOC:${cycle.id}:${coverage.asset.id}`,
          kind: 'PMOC',
          sourceId: cycle.id,
          schedulingId: cycle.schedulingEventId,
          title: `${cycle.plan.name} — ${coverage.asset.name}`,
          description: `Ciclo PMOC ${cycle.plan.code}`,
          businessUnit: this.party(unit),
          customer: this.customer(customers.get(cycle.plan.customerId)),
          location:
            cycle.plan.serviceLocation ??
            customers.get(cycle.plan.customerId)?.address ??
            null,
          /* O ciclo de PMOC não aponta para um endereço do cadastro: o lugar é o
             do plano, que viaja em `location`. Inventar um aqui a partir do
             endereço fiscal do cliente mandaria o técnico para a contabilidade. */
          serviceAddress: null,
          serviceType: 'Manutenção programada (PMOC)',
          /* O pedido é da operação. Um ciclo de PMOC sem operação aberta não tem
             o que cancelar — e, com ela aberta, o pedido aparece pelo item dela. */
          pendingCancellation: null,
          scheduledFor: cycle.dueOn.toISOString(),
          scheduledEnd: null,
          timezone: unit.timezone,
          dueState: this.dueState(
            execution?.status ?? cycle.status,
            cycle.dueOn,
            unit.timezone,
            true,
          ),
          operationalStatus: execution?.status ?? cycle.status,
          priority: null,
          responsibleFieldTechnician: execution?.responsibleFieldTechnician
            ? this.party(execution.responsibleFieldTechnician)
            : cycle.plan.technician
              ? this.party(cycle.plan.technician)
              : null,
          auxiliaryTechnicians: (
            execution?.operation?.auxiliaryTechnicians ?? []
          ).map((value: any) => this.party(value.user)),
          equipmentSummary: [this.equipment(coverage.asset)],
          artifacts: cycle.artifactExecution
            ? [this.artifact(cycle.artifactExecution)]
            : [],
          allowedActions: actions,
          primaryAction: this.primary(actions),
          navigationContext: {
            kind: 'PMOC',
            sourceId: cycle.id,
            /*
             * O plano, para o aplicativo alcançar o atendimento.
             *
             * Todas as rotas de execução são escopadas por ele
             * (`/pmoc/plans/:planId/…`), e o contexto publicava só o ciclo e o
             * equipamento. Sem este campo o aplicativo conseguia **ler** um PMOC
             * e não conseguia atendê-lo.
             */
            planId: cycle.plan.id,
            executionId: execution?.id ?? null,
            occurrenceId: null,
            cycleId: cycle.id,
            equipmentId: coverage.asset.id,
          },
          updatedAt: cycle.updatedAt.toISOString(),
        });
      }
    }

    for (const occurrence of source.rvtOccurrences) {
      const unit = units.get(occurrence.businessUnitId);
      if (!unit) continue;
      const configuration = occurrence.configuration;
      const actions = this.rvtActions(
        occurrence,
        actor,
        source.canExecuteRvt === true || actor.isOrganizationOwner === true,
      );
      result.push({
        id: `RVT:${occurrence.id}`,
        kind: 'RVT',
        sourceId: occurrence.id,
        schedulingId: occurrence.schedulingEventId,
        title: configuration.name,
        description:
          typeof configuration.procedure?.description === 'string' &&
          configuration.procedure.description.trim()
            ? configuration.procedure.description
            : (configuration.maintenanceType?.label ?? 'Visita técnica'),
        businessUnit: this.party(unit),
        customer: this.customer(customers.get(configuration.customerId)),
        location:
          configuration.serviceLocation ??
          customers.get(configuration.customerId)?.address ??
          null,
        serviceAddress: null,
        serviceType: configuration.maintenanceType?.label ?? 'Visita técnica',
        pendingCancellation: null,
        scheduledFor: occurrence.scheduledFor?.toISOString() ?? null,
        scheduledEnd: null,
        timezone: configuration.timezone || unit.timezone,
        dueState: this.dueState(
          occurrence.execution?.status ?? occurrence.status,
          occurrence.scheduledFor,
          configuration.timezone || unit.timezone,
        ),
        operationalStatus: occurrence.execution?.status ?? occurrence.status,
        priority: null,
        responsibleFieldTechnician: occurrence.responsibleFieldTechnicianId
          ? {
              id: occurrence.responsibleFieldTechnicianId,
              name: 'Técnico responsável',
            }
          : null,
        auxiliaryTechnicians: [],
        equipmentSummary: (occurrence.equipmentIds?.length
          ? occurrence.equipmentIds
          : configuration.equipment.map((value: any) => value.assetId)
        )
          .map((id: string) => assets.get(id))
          .filter(Boolean)
          .slice(0, 20)
          .map((value: any) => this.equipment(value)),
        artifacts: [],
        allowedActions: actions,
        primaryAction: this.primary(actions),
        navigationContext: {
          kind: 'RVT',
          sourceId: occurrence.id,
          /* Visita técnica tem configuração própria, não plano de PMOC. */
          planId: null,
          executionId: occurrence.execution?.id ?? null,
          occurrenceId: occurrence.id,
          cycleId: null,
          equipmentId: null,
        },
        updatedAt: occurrence.updatedAt.toISOString(),
      });
    }
    return result.sort((a, b) => this.compare(a, b));
  }

  private operationActions(
    source: any,
    actor: MobileFieldActor,
  ): MobileFieldAction[] {
    const actions: MobileFieldAction[] = [];
    if (this.has(actor, 'operations.read')) actions.push('VIEW');
    if (source.location) actions.push('OPEN_ROUTE');
    if (
      source.status === 'IN_PROGRESS' &&
      this.has(actor, 'operations.status.update')
    )
      actions.push('RESUME');
    if (
      ['OPEN', 'SCHEDULED'].includes(source.status) &&
      this.has(actor, 'operations.status.update')
    )
      actions.push('START');
    if (
      source.status === 'IN_PROGRESS' &&
      this.has(actor, 'operations.status.update')
    )
      actions.push('COMPLETE');
    if (this.has(actor, 'operations.attachments.create'))
      actions.push('ADD_EVIDENCE');
    /*
     * Pedir o cancelamento não exige permissão de mudar estado — pedir não muda
     * nada. Exige estar escalado, e a projeção já garante isso: a consulta filtra
     * por responsável ou auxiliar, e sem isso o item nem aparece.
     *
     * Some quando já há pedido em aberto: a tela precisa mostrar "enviado,
     * aguardando" em vez de um botão que criaria o segundo.
     */
    if (
      !['COMPLETED', 'CANCELLED'].includes(source.status) &&
      !source.cancellationRequests?.length
    )
      actions.push('REQUEST_CANCELLATION');
    if (
      source.artifactExecutions.length &&
      this.has(actor, 'artifact_executions.read')
    )
      actions.push('VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT');
    if (source.assets?.length && this.has(actor, 'assets.read'))
      actions.push('SCAN_EQUIPMENT');
    return actions;
  }

  private pmocActions(
    cycle: any,
    execution: any,
    actor: MobileFieldActor,
  ): MobileFieldAction[] {
    const actions: MobileFieldAction[] = [];
    if (this.has(actor, 'pmoc.read')) actions.push('VIEW');
    if (execution?.status === 'IN_PROGRESS' && this.has(actor, 'pmoc.execute'))
      actions.push('RESUME', 'ADD_EVIDENCE', 'COMPLETE');
    if (
      !execution &&
      cycle.plan.technicalResponsibleUserId &&
      this.has(actor, 'pmoc.execute')
    )
      actions.push('EXECUTE_PMOC');
    if (cycle.artifactExecution && this.has(actor, 'artifact_executions.read'))
      actions.push('VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT');
    if (this.has(actor, 'assets.read')) actions.push('SCAN_EQUIPMENT');
    return actions;
  }

  private rvtActions(
    source: any,
    actor: MobileFieldActor,
    eligible: boolean,
  ): MobileFieldAction[] {
    const actions: MobileFieldAction[] = [];
    if (this.has(actor, 'rvt.read')) actions.push('VIEW');
    const canExecute = eligible && this.has(actor, 'rvt.execute');
    const owner = actor.isOrganizationOwner === true;
    if (
      !source.execution &&
      source.status === 'SCHEDULED' &&
      canExecute &&
      (owner ||
        !source.responsibleFieldTechnicianId ||
        source.responsibleFieldTechnicianId === actor.id)
    )
      actions.push('EXECUTE_RVT');
    if (
      source.execution?.status === 'IN_PROGRESS' &&
      canExecute &&
      (owner || source.execution.responsibleFieldTechnicianId === actor.id)
    )
      actions.push('RESUME', 'ADD_EVIDENCE', 'COMPLETE');
    if (this.has(actor, 'assets.read')) actions.push('SCAN_EQUIPMENT');
    return actions;
  }

  private dueState(
    status: string,
    at: Date | null,
    timezone: string,
    dateOnly = false,
  ): MobileDueState {
    if (['IN_PROGRESS', 'STARTED', 'PAUSED'].includes(status))
      return 'IN_PROGRESS';
    if (!at) return 'UNSCHEDULED';
    const itemDate = dateOnly
      ? at.toISOString().slice(0, 10)
      : civilDateKey(at, timezone);
    const today = civilDateKey(new Date(), timezone);
    if (itemDate < today) return 'OVERDUE';
    if (itemDate === today) return 'DUE_TODAY';
    return 'UPCOMING';
  }

  private matchesPermission(item: MobileWorkItemReadModel): boolean {
    return item.allowedActions.includes('VIEW');
  }
  /** Cliente, título ou descrição — o que a pessoa lembraria de digitar. */
  private matchesSearch(item: MobileWorkItemReadModel, termo: string): boolean {
    return [item.customer?.name, item.title, item.description].some(
      (campo) => campo?.toLowerCase().includes(termo) ?? false,
    );
  }

  private matchesView(state: MobileDueState, view: string): boolean {
    return (
      (view === 'TODAY' && state === 'DUE_TODAY') ||
      (view === 'OVERDUE' && state === 'OVERDUE') ||
      (view === 'IN_PROGRESS' && state === 'IN_PROGRESS') ||
      (view === 'UPCOMING' && state === 'UPCOMING')
    );
  }
  private compare(
    a: MobileWorkItemReadModel,
    b: MobileWorkItemReadModel,
  ): number {
    const rank = {
      IN_PROGRESS: 0,
      OVERDUE: 1,
      DUE_TODAY: 2,
      UPCOMING: 3,
      UNSCHEDULED: 4,
    };
    return (
      rank[a.dueState] - rank[b.dueState] ||
      (a.scheduledFor ?? '9999').localeCompare(b.scheduledFor ?? '9999') ||
      a.id.localeCompare(b.id)
    );
  }
  private has(actor: MobileFieldActor, permission: string): boolean {
    return (
      actor.isOrganizationOwner === true ||
      actor.permissions.includes('*') ||
      actor.permissions.includes(permission)
    );
  }

  /**
   * Converte somente identidades canônicas conhecidas em uma leitura
   * direcionada. O ID continua sendo revalidado pelo repository com tenant,
   * unidade e atribuição; parsear aqui não concede acesso.
   */
  private projectionTarget(id: string): MobileFieldProjectionTarget | null {
    const parts = id.split(':');
    if (parts[0] === 'SERVICE_OPERATION' && parts.length === 2 && parts[1]) {
      return { kind: 'SERVICE_OPERATION', sourceId: parts[1] };
    }
    if (parts[0] === 'PMOC' && parts.length === 3 && parts[1] && parts[2]) {
      return { kind: 'PMOC', sourceId: parts[1], equipmentId: parts[2] };
    }
    if (parts[0] === 'RVT' && parts.length === 2 && parts[1]) {
      return { kind: 'RVT', sourceId: parts[1] };
    }
    return null;
  }
  private party(value: any) {
    return {
      id: value.id,
      name: value.displayName ?? value.tradeName ?? value.legalName,
    };
  }
  /**
   * O cliente de um item da fila.
   *
   * ## O contato não depende mais de `customers.read`
   *
   * Dependia, e a pergunta era a errada. `customers.read` governa **navegar o
   * cadastro de clientes** — uma permissão que o Técnico Operacional não costuma
   * ter, e não deve mesmo ter. O efeito era o técnico chegar ao prédio sem o
   * telefone de quem o espera.
   *
   * O que torna seguro revelar aqui não é uma permissão: é o recorte da consulta.
   * Todo item desta projeção já vem filtrado por
   * `responsibleFieldTechnicianId = ator OR auxiliar` — a cláusula está no
   * repositório, e sem ela o item sequer aparece. Então o cliente que chega a esta
   * função é, por construção, o cliente de um atendimento **desta** pessoa. Dar o
   * telefone dele é dar o telefone do próprio trabalho, não abrir a carteira.
   *
   * O que continua fechado é tudo o mais do cadastro: esta função devolve nome,
   * endereço e **um** contato — o principal —, e nada além.
   */
  private customer(value: any): MobileCustomerSummaryReadModel | null {
    if (!value) return null;
    return {
      id: value.id,
      name: value.tradeName ?? value.legalName,
      address: value.address ?? null,
      contact: value.contacts[0] ? { ...value.contacts[0] } : null,
    };
  }
  /**
   * O endereço do atendimento, com as partes que importam em campo separadas.
   *
   * `null` quando a operação não aponta para um endereço do cadastro — e `null` é a
   * resposta honesta: montar um a partir do endereço fiscal do cliente mandaria o
   * técnico para a contabilidade. Nesse caso o aplicativo cai em `location`, que é
   * o que já existia.
   *
   * `sector` vem da operação, não do endereço: é o ponto exato lá dentro
   * ("Auditório", "Cozinha"), e muda a cada atendimento no mesmo prédio.
   */
  private serviceAddress(
    value: any,
    sector: string | null,
  ): MobileServiceAddressReadModel | null {
    if (!value) return null;
    return {
      label: value.label ?? null,
      street: value.street,
      number: value.number ?? null,
      complement: value.complement ?? null,
      district: value.district ?? null,
      city: value.city,
      stateCode: value.stateCode ?? null,
      postalCode: value.postalCode ?? null,
      reference: value.notes ?? null,
      sector: sector ?? null,
    };
  }

  private equipment(value: any): MobileEquipmentSummaryReadModel {
    return {
      id: value.id,
      code: value.identifier,
      name: value.name,
      type: value.category,
      brand: value.manufacturer,
      model: value.model,
      sector: value.location,
      status: value.status,
      qrAvailable: value.qrIdentities.length > 0,
    };
  }
  private artifact(value: any): MobileArtifactSummaryReadModel {
    return {
      id: value.id,
      type: value.snapshot.artifactType,
      status: value.status,
      previewAvailable: value.renderStatus === 'COMPLETED',
      downloadAvailable: value.renderStatus === 'COMPLETED',
    };
  }
  private primary(
    actions: readonly MobileFieldAction[],
  ): MobileFieldAction | null {
    return (
      (['RESUME', 'EXECUTE_PMOC', 'EXECUTE_RVT', 'START', 'VIEW'].find(
        (value) => actions.includes(value as MobileFieldAction),
      ) as MobileFieldAction | undefined) ?? null
    );
  }
  private encodeCursor(id: string): string {
    return Buffer.from(JSON.stringify({ v: 1, id }), 'utf8').toString(
      'base64url',
    );
  }
  private decodeCursor(value: string): { id: string } {
    try {
      const result = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as { v?: unknown; id?: unknown };
      if (result.v !== 1 || typeof result.id !== 'string') throw new Error();
      return { id: result.id };
    } catch {
      throw new ForbiddenException('Cursor da fila de campo inválido');
    }
  }
  private metric(operation: string, started: number, count: number): void {
    this.logger.log(
      JSON.stringify({
        metric: `mobile_field_${operation}_requests`,
        durationMs: Number((performance.now() - started).toFixed(2)),
        itemsReturned: count,
      }),
    );
  }
}
