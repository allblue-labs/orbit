/**
 * O único lugar que decide o que o plano permite.
 *
 * O produto pergunta por **capacidade** e por **recurso**, nunca por nome de
 * plano (§22). Não há `if (plano === 'PROFISSIONAL')` em lugar nenhum acima
 * desta camada — e não pode haver, porque a API nem devolve o plano.
 *
 * ## RBAC e direito comercial não se misturam
 *
 * `CapabilityGuard` responde "esta pessoa pode?" a partir das permissões da
 * organização. Este serviço responde "a empresa contratou?". As duas perguntas
 * se somam e nenhuma substitui a outra (§11–§14): tirar uma capacidade do
 * plano não é o mesmo que tirar a permissão de alguém.
 *
 * ## Duas formas de proteger, e a diferença importa
 *
 * `assertCanAllocate` responde a pergunta; `guardAllocation` a responde e
 * **mantém a resposta verdadeira** até o commit, porque segura o bloqueio
 * consultivo enquanto o trabalho acontece. Só a segunda é segura contra
 * concorrência (§65–§68). A primeira serve para leitura e para pré-checagem
 * barata.
 */
import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../context';
import { RlsTransaction } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import {
  AllocationResource,
  UsageResource,
  fitsWithin,
  type PlanCapability,
  type PlanLimit,
  type PlanResource,
} from '../catalog/plan-catalog.types';
import { isKnownPlan, planDefinition } from '../catalog/plan-registry';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { grantsProductAccess } from '../subscriptions/subscription.types';
import {
  customProfile,
  fromCatalog,
  fromSubscription,
  isAllocationResource,
  isUsageResource,
  legacyUngoverned,
  limitFor,
  type EffectiveEntitlements,
} from './effective-entitlements';
import { SubscriptionNotActiveException } from '../subscriptions/subscription.errors';
import {
  PlanAllocationLimitReachedException,
  PlanCapabilityUnavailableException,
  PlanConfigurationInvalidException,
  PlanUsageLimitReachedException,
} from './entitlement.errors';
import { EntitlementMapper } from './entitlement.mapper';
import { EntitlementMetrics } from './entitlement.metrics';
import {
  EntitlementRepository,
  type LedgerSource,
  type PlanRow,
} from './entitlement.repository';
import type {
  OrganizationEntitlementsReadModel,
  PlanCatalogReadModel,
} from '../subscription-plan.read-models';
import { monthlyWindow, type UsageWindow } from './usage-window';

export interface UsageConsumption {
  readonly resource: UsageResource;
  readonly window: UsageWindow;
  /** `false` quando o mesmo evento de negócio já havia consumido a cota. */
  readonly counted: boolean;
  readonly total: number;
}

/**
 * A memória de uma requisição.
 *
 * Uma listagem que checa capacidade por linha resolveria o mesmo plano cem
 * vezes (§140). A chave é o objeto de contexto da requisição, então a memória
 * nasce e morre com ela — não há como servir o plano de um inquilino a outro,
 * e fora de uma requisição simplesmente não há cache.
 */
const MEMORIA = new WeakMap<object, Map<string, Promise<PlanRow>>>();

/**
 * Os dois nomes comerciais da mesma equipe.
 *
 * A página vende "5 técnicos operadores" e "5 auxiliares técnico"; o Orbit tem
 * uma tabela só de pessoas habilitadas para campo, e é ela que os dois números
 * descrevem. Manter os dois códigos preserva a linguagem comercial sem cobrar
 * duas vezes de quem acumula os papéis.
 */
const EQUIPE_DE_CAMPO: readonly AllocationResource[] = [
  AllocationResource.FIELD_TECHNICIANS,
  AllocationResource.AUXILIARY_TECHNICIANS,
];

@Injectable()
export class EntitlementService {
  constructor(
    private readonly repository: EntitlementRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextService,
    private readonly metrics: EntitlementMetrics,
    private readonly mapper: EntitlementMapper,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Direitos                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Os direitos vigentes da organização.
   *
   * A origem é resolvida aqui e em nenhum outro lugar: catálogo congelado,
   * perfil declarado na linha do plano, ou legado explícito. Quem chama recebe
   * direitos, não um `planId` (§24).
   */
  async resolve(organizationId: string): Promise<EffectiveEntitlements> {
    const assinatura = await this.subscriptions.currentOrNull(organizationId);
    if (assinatura) {
      /**
       * A mudança programada já venceu: os direitos passam a ser os do plano
       * de destino. Rebaixar não apaga nada — o que existe continua existindo,
       * e o que fica bloqueado é criar mais.
       */
      const vencida =
        assinatura.pendingEffectiveAt !== null &&
        assinatura.pendingEffectiveAt <= new Date() &&
        assinatura.pendingEntitlementsSnapshot !== null;
      return fromSubscription(
        vencida ? assinatura.pendingPlanCode! : assinatura.planCode,
        vencida ? assinatura.pendingPlanCode! : assinatura.planCode,
        vencida
          ? assinatura.pendingEntitlementsSnapshot
          : assinatura.entitlementsSnapshot,
        grantsProductAccess(assinatura.effectiveStatus),
      );
    }
    /**
     * Sem assinatura, somente a origem antiga responde com acesso.
     *
     * Planos customizados/legados continuam pelo `plan_id`. Um código do
     * catálogo comercial sem contrato canônico, por outro lado, é uma falha de
     * provisionamento e não pode virar acesso pago gratuito.
     */
    return this.direitosDe(await this.plano(organizationId));
  }

  /** A escolha da origem, num lugar só. */
  private direitosDe(plano: PlanRow): EffectiveEntitlements {
    if (isKnownPlan(plano.planKey)) {
      /** Catálogo comercial sem assinatura canônica nunca concede acesso. */
      return {
        ...fromCatalog(planDefinition(plano.planKey)),
        accessGranted: false,
      };
    }
    return (
      customProfile(plano.planKey, plano.planName, plano.limits) ??
      legacyUngoverned(plano.planKey, plano.planName)
    );
  }

  /** A linha do plano, uma consulta por requisição. */
  private async plano(organizationId: string): Promise<PlanRow> {
    const memoria = this.memoria();
    const guardado = memoria?.get(organizationId);
    if (guardado) return guardado;

    const promessa = this.repository.findPlan(organizationId).then((plano) => {
      if (!plano) {
        throw new PlanConfigurationInvalidException(
          `organization ${organizationId} has no resolvable plan`,
        );
      }
      return plano;
    });
    memoria?.set(organizationId, promessa);
    try {
      return await promessa;
    } catch (error) {
      memoria?.delete(organizationId);
      throw error;
    }
  }

  private memoria(): Map<string, Promise<PlanRow>> | null {
    const contexto = this.contexts.getOptional();
    if (!contexto) return null;
    let mapa = MEMORIA.get(contexto);
    if (!mapa) {
      mapa = new Map();
      MEMORIA.set(contexto, mapa);
    }
    return mapa;
  }

  /**
   * A situação da organização, pronta para leitura.
   *
   * Doze recursos, doze contagens — uma leitura só, e só quando alguém abre a
   * tela de plano. Não é caminho de listagem, então não há N+1 a evitar aqui.
   */
  async describe(
    organizationId: string,
  ): Promise<OrganizationEntitlementsReadModel> {
    const direitos = await this.resolve(organizationId);
    const janela = await this.getCurrentWindow(organizationId);
    const alocacao = await Promise.all(
      Object.values(AllocationResource).map(async (recurso) =>
        this.mapper.resource(
          recurso,
          this.limiteDe(direitos, recurso),
          await this.repository.countAllocation(organizationId, recurso),
        ),
      ),
    );
    const uso = await Promise.all(
      Object.values(UsageResource).map(async (recurso) =>
        this.mapper.resource(
          recurso,
          this.limiteDe(direitos, recurso),
          await this.repository.sumUsage(organizationId, recurso, janela),
        ),
      ),
    );
    return this.mapper.entitlements(direitos, janela, alocacao, uso);
  }

  /** O catálogo comercial congelado, igual para toda organização. */
  catalog(): PlanCatalogReadModel {
    return this.mapper.catalog();
  }

  /* ---------------------------------------------------------------- */
  /* Capacidades                                                       */
  /* ---------------------------------------------------------------- */

  async hasCapability(
    organizationId: string,
    capability: PlanCapability,
  ): Promise<boolean> {
    const direitos = await this.resolve(organizationId);
    const permitido =
      direitos.accessGranted && direitos.capabilities.has(capability);
    this.metrics.capability(capability, permitido ? 'ALLOWED' : 'DENIED');
    return permitido;
  }

  /** Recusa fechada: capacidade ausente é ausência de direito (§128). */
  async assertCapability(
    organizationId: string,
    capability: PlanCapability,
  ): Promise<void> {
    await this.assertAccess(organizationId);
    if (!(await this.hasCapability(organizationId, capability))) {
      throw new PlanCapabilityUnavailableException(capability);
    }
  }

  /**
   * A assinatura autoriza usar o produto agora?
   *
   * Conferido num lugar só, antes de qualquer teto. Uma organização suspensa
   * não deve ouvir "seu plano não inclui este recurso": o plano inclui, a
   * assinatura é que não está valendo, e a diferença é o que a pessoa precisa
   * saber para resolver.
   */
  async assertAccess(organizationId: string): Promise<void> {
    const direitos = await this.resolve(organizationId);
    if (!direitos.accessGranted) {
      throw new SubscriptionNotActiveException(direitos.planCode);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Limites e contagens                                               */
  /* ---------------------------------------------------------------- */

  async getEffectiveLimit(
    organizationId: string,
    resource: PlanResource,
  ): Promise<PlanLimit> {
    return this.limiteDe(await this.resolve(organizationId), resource);
  }

  /**
   * O teto que de fato vincula.
   *
   * Para quase todo recurso é o do catálogo, direto. A equipe de campo é a
   * exceção: "técnicos operadores" e "auxiliares técnico" são dois números
   * comerciais sobre **uma** equipe de pessoas, e a mesma pessoa não paga duas
   * vezes por também ser escalada como auxiliar. Com uma vaga só, o teto em
   * vigor é o mais restritivo dos dois — hoje eles são iguais em todos os
   * planos, e isso mantém a conta honesta se um dia deixarem de ser.
   */
  private limiteDe(
    direitos: EffectiveEntitlements,
    resource: PlanResource,
  ): PlanLimit {
    const declarado = limitFor(direitos, resource);
    if (!EQUIPE_DE_CAMPO.includes(resource)) {
      return declarado;
    }
    return EQUIPE_DE_CAMPO.map((recurso) => limitFor(direitos, recurso)).reduce(
      (menor, atual) => {
        if (menor.kind === 'UNLIMITED') return atual;
        if (atual.kind === 'UNLIMITED') return menor;
        return atual.value < menor.value ? atual : menor;
      },
    );
  }

  /** A janela mensal vigente da organização. */
  async getCurrentWindow(
    organizationId: string,
    at: Date = new Date(),
  ): Promise<UsageWindow> {
    /**
     * A âncora é a da assinatura, quando existe.
     *
     * É o que faz a janela de uso ser mensal mesmo numa assinatura anual: a
     * cobrança compra doze meses de acesso, e a cota anda de mês em mês a
     * partir do mesmo aniversário. Sem assinatura, a âncora antiga da
     * organização continua respondendo.
     */
    const assinatura = await this.subscriptions.currentOrNull(
      organizationId,
      at,
    );
    const ancora =
      assinatura?.billingAnchorAt ?? (await this.plano(organizationId)).anchor;
    return monthlyWindow(ancora, at);
  }

  /**
   * Quanto do recurso está em uso.
   *
   * Alocação lê o estado canônico; uso soma o razão da janela. Recurso que não
   * é nem um nem outro falha — nunca vira zero (§127).
   */
  async getCurrentUsage(
    organizationId: string,
    resource: PlanResource,
    window?: UsageWindow,
  ): Promise<number> {
    if (isAllocationResource(resource)) {
      return this.repository.countAllocation(organizationId, resource);
    }
    if (isUsageResource(resource)) {
      return this.repository.sumUsage(
        organizationId,
        resource,
        window ?? (await this.getCurrentWindow(organizationId)),
      );
    }
    throw new PlanConfigurationInvalidException(
      `unknown resource ${String(resource)}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Alocação                                                          */
  /* ---------------------------------------------------------------- */

  async canAllocate(
    organizationId: string,
    resource: AllocationResource,
    quantity = 1,
  ): Promise<boolean> {
    const limite = await this.getEffectiveLimit(organizationId, resource);
    if (limite.kind === 'UNLIMITED') return true;
    const atual = await this.repository.countAllocation(
      organizationId,
      resource,
    );
    return fitsWithin(limite, atual, quantity);
  }

  async assertCanAllocate(
    organizationId: string,
    resource: AllocationResource,
    quantity = 1,
  ): Promise<void> {
    await this.assertAccess(organizationId);
    const limite = await this.getEffectiveLimit(organizationId, resource);
    if (limite.kind === 'UNLIMITED') {
      this.metrics.limit(resource, 'ALLOWED');
      return;
    }
    const atual = await this.repository.countAllocation(
      organizationId,
      resource,
    );
    if (!fitsWithin(limite, atual, quantity)) {
      this.metrics.limit(resource, 'DENIED');
      throw new PlanAllocationLimitReachedException(
        resource,
        atual,
        limite.value,
      );
    }
    this.metrics.limit(resource, 'ALLOWED');
  }

  /**
   * Executa o trabalho com a vaga garantida do começo ao fim.
   *
   * Abre a transação, segura o bloqueio do par `(organização, recurso)`,
   * confere e só então deixa o trabalho acontecer — tudo antes do commit. Duas
   * requisições concorrentes com quatro usuários e teto de cinco resultam em
   * cinco: a segunda espera o commit da primeira e vê a contagem já mudada
   * (§65).
   */
  async guardAllocation<T>(
    organizationId: string,
    resource: AllocationResource,
    work: () => Promise<T>,
    quantity: number | (() => Promise<number>) = 1,
  ): Promise<T> {
    const limite = await this.getEffectiveLimit(organizationId, resource);
    if (limite.kind === 'UNLIMITED') {
      this.metrics.limit(resource, 'ALLOWED');
      return work();
    }
    return this.rls.runAmbient(async () => {
      await this.repository.lock(organizationId, resource);
      /**
       * Quantas vagas esta operação realmente ocupa, decidido **sob o
       * bloqueio**. Reativar quem já conta ocupa zero, e uma pergunta feita
       * antes do bloqueio poderia ser respondida com um estado já vencido.
       */
      const vagas = typeof quantity === 'number' ? quantity : await quantity();
      if (vagas > 0) {
        await this.assertCanAllocate(organizationId, resource, vagas);
      }
      return work();
    });
  }

  /**
   * Confere a vaga dentro de uma transação que já existe.
   *
   * Serve aos caminhos que declaram o inquilino por conta própria — o aceite
   * de convite é anônimo até escrever, e só lá dentro a organização existe
   * para a RLS. O bloqueio e a contagem acontecem nessa mesma transação, então
   * a garantia é a mesma de `guardAllocation`: entre conferir e escrever não
   * cabe ninguém.
   */
  async enforceAllocationIn(
    transaction: PrismaTransactionClient,
    organizationId: string,
    resource: AllocationResource,
    quantity = 1,
  ): Promise<void> {
    const plano = await this.repository.findPlan(organizationId, transaction);
    if (!plano) {
      throw new PlanConfigurationInvalidException(
        `organization ${organizationId} has no resolvable plan`,
      );
    }
    const direitos = this.direitosDe(plano);
    const limite = this.limiteDe(direitos, resource);
    if (limite.kind === 'UNLIMITED') {
      this.metrics.limit(resource, 'ALLOWED');
      return;
    }
    await this.repository.lock(organizationId, resource, transaction);
    const atual = await this.repository.countAllocation(
      organizationId,
      resource,
      transaction,
    );
    if (!fitsWithin(limite, atual, quantity)) {
      this.metrics.limit(resource, 'DENIED');
      throw new PlanAllocationLimitReachedException(
        resource,
        atual,
        limite.value,
      );
    }
    this.metrics.limit(resource, 'ALLOWED');
  }

  /* ---------------------------------------------------------------- */
  /* Uso mensal                                                        */
  /* ---------------------------------------------------------------- */

  async canConsume(
    organizationId: string,
    resource: UsageResource,
    quantity = 1,
  ): Promise<boolean> {
    const limite = await this.getEffectiveLimit(organizationId, resource);
    if (limite.kind === 'UNLIMITED') return true;
    const janela = await this.getCurrentWindow(organizationId);
    const atual = await this.repository.sumUsage(
      organizationId,
      resource,
      janela,
    );
    return fitsWithin(limite, atual, quantity);
  }

  /**
   * Conta o evento de negócio uma vez.
   *
   * A ordem é inserir e só depois somar, e não o contrário: é a inserção que
   * decide se este evento já foi contado, e ela decide sob o índice único, sem
   * janela entre ler e escrever. Evento repetido devolve `counted: false` e
   * **não** falha por limite — cobrar de novo um documento que só foi
   * renderizado de novo seria o erro exatamente oposto (§49, §71).
   */
  async consume(
    organizationId: string,
    resource: UsageResource,
    source: LedgerSource,
    quantity = 1,
  ): Promise<UsageConsumption> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new PlanConfigurationInvalidException(
        `usage quantity must be a positive integer, got ${quantity}`,
      );
    }
    await this.assertAccess(organizationId);
    const limite = await this.getEffectiveLimit(organizationId, resource);
    const janela = await this.getCurrentWindow(organizationId);

    return this.rls.runAmbient(async () => {
      await this.repository.lock(organizationId, resource);
      const contado = await this.repository.appendUsage(
        organizationId,
        resource,
        janela,
        source,
        quantity,
      );
      const total = await this.repository.sumUsage(
        organizationId,
        resource,
        janela,
      );
      if (contado && limite.kind === 'LIMITED' && total > limite.value) {
        this.metrics.limit(resource, 'DENIED');
        throw new PlanUsageLimitReachedException(
          resource,
          total - quantity,
          limite.value,
        );
      }
      if (contado) this.metrics.consumed(resource, quantity);
      this.metrics.limit(resource, 'ALLOWED');
      return { resource, window: janela, counted: contado, total };
    });
  }

  /**
   * Executa a emissão e cobra a cota na mesma transação.
   *
   * O trabalho vem primeiro porque a identidade do evento normalmente só
   * existe depois dele — o identificador do documento recém-emitido. Se a cota
   * estourar, a transação inteira volta atrás: não há emissão cobrada pela
   * metade nem efeito irreversível já publicado (§75, §76).
   */
  async guardUsage<T>(
    organizationId: string,
    resource: UsageResource,
    source: (result: T) => LedgerSource,
    work: () => Promise<T>,
    quantity = 1,
  ): Promise<T> {
    return this.rls.runAmbient(async () => {
      const resultado = await work();
      await this.consume(organizationId, resource, source(resultado), quantity);
      return resultado;
    });
  }
}

export { AllocationResource, UsageResource };
export type { EffectiveEntitlements, LedgerSource, UsageWindow };
