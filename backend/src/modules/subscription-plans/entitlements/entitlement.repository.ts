/**
 * O acesso ao banco da camada de direitos.
 *
 * Três responsabilidades, todas dentro da transação de quem chamou quando
 * existe uma (ver `RlsTransaction.runAmbient`): descobrir o plano vigente,
 * contar o estado canônico e escrever o razão de uso.
 *
 * Nenhuma contagem vem de contador mantido à mão (§64): quantos usuários uma
 * organização tem é uma pergunta que o banco responde a partir das mesmas
 * linhas que o produto lê. Contador paralelo é mais uma coisa para derrapar.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { generateUuidV7 } from '../../../utils';
import {
  AllocationResource,
  type UsageResource,
} from '../catalog/plan-catalog.types';
import { PlanConfigurationInvalidException } from './entitlement.errors';
import type { UsageWindow } from './usage-window';

export interface PlanRow {
  planKey: string;
  planName: string;
  limits: Prisma.JsonValue;
  /** A âncora da janela mensal. A PR-PL-02 a substituirá pela assinatura. */
  anchor: Date;
}

export interface LedgerSource {
  readonly type: string;
  readonly id: string;
}

@Injectable()
export class EntitlementRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /**
   * Roda dentro da transação recebida, ou abre a sua.
   *
   * Nem todo caminho canônico chega com contexto de inquilino declarado: o
   * aceite de convite, por exemplo, é anônimo e só declara a organização
   * dentro da própria transação em que escreve. Contar de fora dali daria
   * zero — a política de RLS esconderia tudo — e um teto conferido contra zero
   * não recusa nada. Por isso a transação pode vir de quem chama.
   */
  private dentro<T>(
    tx: PrismaTransactionClient | undefined,
    work: (transaction: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx ? work(tx) : this.rls.run(work);
  }

  /**
   * O plano vigente da organização.
   *
   * Devolve `null` quando a organização não é visível — a decisão do que fazer
   * com isso é de quem chamou, e é sempre fechar.
   */
  async findPlan(
    organizationId: string,
    transaction?: PrismaTransactionClient,
  ): Promise<PlanRow | null> {
    return this.dentro(transaction, async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId, deletedAt: null },
        select: {
          createdAt: true,
          subscriptionStartedAt: true,
          currentPeriodStart: true,
          plan: { select: { key: true, name: true, limits: true } },
        },
      });
      if (!organization) return null;
      return {
        planKey: organization.plan.key,
        planName: organization.plan.name,
        limits: organization.plan.limits,
        anchor:
          organization.subscriptionStartedAt ??
          organization.currentPeriodStart ??
          organization.createdAt,
      };
    });
  }

  /**
   * Quantas unidades do recurso a organização tem ativas agora.
   *
   * Cada recurso tem um predicado canônico, escrito uma vez aqui e citado no
   * relatório da PR — é a definição, não um detalhe de implementação.
   */
  countAllocation(
    organizationId: string,
    resource: AllocationResource,
    transaction?: PrismaTransactionClient,
  ): Promise<number> {
    return this.dentro(transaction, (tx) =>
      this.contar(tx, organizationId, resource),
    );
  }

  private async contar(
    tx: PrismaTransactionClient,
    organizationId: string,
    resource: AllocationResource,
  ): Promise<number> {
    switch (resource) {
      case AllocationResource.BUSINESS_UNITS:
        return tx.businessUnit.count({
          where: { organizationId, status: 'ACTIVE', deletedAt: null },
        });

      /**
       * Pessoas com acesso à superfície interna. A unicidade
       * `(organization, user)` do vínculo é o que garante uma pessoa, uma
       * unidade. Identidades do Portal do Cliente vivem noutra tabela e por
       * construção não entram nesta conta (§53).
       */
      case AllocationResource.PLATFORM_USERS:
        return tx.organizationMembership.count({
          where: {
            organizationId,
            status: 'ACTIVE',
            deletedAt: null,
            user: { status: 'ACTIVE', deletedAt: null },
          },
        });

      /**
       * A equipe de campo — pessoas, não designações.
       *
       * Os dois recursos comerciais ("técnicos operadores" e "auxiliares
       * técnico") descrevem **uma única** equipe, e por isso caem na mesma
       * conta. Quem opera em campo é quem tem o perfil profissional ativo com
       * `fieldTechnicianEnabled`: é esse e somente esse o portão que o app de
       * campo confere, tanto para o responsável quanto para o auxiliar.
       *
       * A tabela é única por `(organização, pessoa)`, então nada aqui pode
       * contar a mesma pessoa duas vezes — nem por acumular
       * `TECHNICAL_RESPONSIBLE`, nem por auxiliar em dez ordens. Contar
       * designações vivas, como fazia a PR-PL-01, media outra coisa: quantas
       * pessoas estão escaladas agora, e não quantas licenças a empresa tem.
       */
      case AllocationResource.FIELD_TECHNICIANS:
      case AllocationResource.AUXILIARY_TECHNICIANS:
        return tx.professionalProfile.count({
          where: {
            organizationId,
            active: true,
            fieldTechnicianEnabled: true,
            user: { status: 'ACTIVE', deletedAt: null },
          },
        });

      case AllocationResource.ACTIVE_CUSTOMERS:
        return tx.customer.count({
          where: { organizationId, status: 'ACTIVE', deletedAt: null },
        });

      case AllocationResource.ACTIVE_EQUIPMENT:
        return tx.asset.count({
          where: { organizationId, status: 'ACTIVE', deletedAt: null },
        });

      /** Recurso sem contagem canônica falha; nunca vira zero (§127). */
      default:
        throw new PlanConfigurationInvalidException(
          `no canonical count for allocation resource ${String(resource)}`,
        );
    }
  }

  /** Quanto do recurso já foi consumido dentro da janela. */
  async sumUsage(
    organizationId: string,
    resource: UsageResource,
    window: UsageWindow,
    transaction?: PrismaTransactionClient,
  ): Promise<number> {
    return this.dentro(transaction, async (tx) => {
      const total = await tx.planUsageEvent.aggregate({
        _sum: { quantity: true },
        where: {
          organizationId,
          resource,
          windowStart: window.start,
          windowEnd: window.end,
        },
      });
      return total._sum.quantity?.toNumber() ?? 0;
    });
  }

  /**
   * Serializa as decisões sobre o mesmo recurso da mesma organização.
   *
   * O bloqueio é de transação: solta no commit, junto com a escrita que ele
   * autorizou. Enquanto ele existe, `contar → comparar → inserir` é atômico —
   * que é exatamente o que §67 proíbe fazer sem proteção.
   */
  async lock(
    organizationId: string,
    resource: string,
    transaction?: PrismaTransactionClient,
  ): Promise<void> {
    await this.dentro(transaction, (tx) =>
      /**
       * `$executeRaw`, e não `$queryRaw`: a função devolve `void`, e o
       * desserializador do Prisma não sabe ler essa coluna. Aqui só interessa
       * que o bloqueio foi tomado.
       */
      tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock($1::int, $2::int)',
        hash32(organizationId),
        hash32(chaveDeBloqueio(resource)),
      ),
    );
  }

  /**
   * Registra o consumo, uma vez por evento de negócio.
   *
   * Devolve `false` quando a linha já existia: o mesmo documento renderizado
   * de novo, o mesmo job reentregue. O índice único por origem é quem decide —
   * não uma consulta anterior, que teria uma janela entre ler e escrever.
   */
  async appendUsage(
    organizationId: string,
    resource: UsageResource,
    window: UsageWindow,
    source: LedgerSource,
    quantity: number,
    transaction?: PrismaTransactionClient,
  ): Promise<boolean> {
    return this.dentro(transaction, async (tx) => {
      const inseridas = await tx.$executeRaw`
        INSERT INTO "plan_usage_events"
          ("id", "organization_id", "resource", "window_start", "window_end",
           "quantity", "source_type", "source_id", "occurred_at")
        VALUES
          (${generateUuidV7()}::uuid, ${organizationId}::uuid, ${resource},
           ${window.start}::timestamptz, ${window.end}::timestamptz,
           ${new Prisma.Decimal(quantity)}::numeric, ${source.type},
           ${source.id}, now())
        ON CONFLICT ("organization_id", "resource", "source_type", "source_id")
        DO NOTHING
      `;
      return inseridas > 0;
    });
  }
}

/**
 * Recursos que dividem a mesma vaga dividem o mesmo cadeado.
 *
 * "Técnicos operadores" e "auxiliares técnico" contam as mesmas pessoas. Se
 * cada nome tomasse o seu próprio bloqueio, duas habilitações concorrentes
 * passariam lado a lado por portas diferentes e o teto seria ultrapassado —
 * o cadeado tem de ser da vaga, não do rótulo comercial.
 */
function chaveDeBloqueio(resource: string): string {
  return resource === AllocationResource.FIELD_TECHNICIANS ||
    resource === AllocationResource.AUXILIARY_TECHNICIANS
    ? 'FIELD_STAFF'
    : resource;
}

/**
 * Uma chave de 32 bits com sinal, estável entre processos.
 *
 * Deliberadamente calculada aqui e não com `hashtext()`: a função do Postgres
 * é interna e não tem estabilidade prometida entre versões, e uma chave de
 * bloqueio que muda numa atualização deixa de serializar sem avisar ninguém.
 */
function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}
