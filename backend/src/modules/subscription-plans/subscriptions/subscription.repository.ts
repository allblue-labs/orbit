/**
 * O acesso ao banco da assinatura.
 *
 * Duas coisas que não são detalhe: a escrita usa controle otimista de versão —
 * dois comandos concorrentes não produzem estado torto —, e a concessão de
 * avaliação depende do índice único **global** para o antifraude, e não de uma
 * consulta prévia que teria janela entre ler e escrever.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { generateUuidV7 } from '../../../utils';

export interface SubscriptionRow {
  id: string;
  organizationId: string;
  planCode: string;
  catalogVersion: number;
  entitlementsSnapshot: Prisma.JsonValue;
  billingInterval: string;
  status: string;
  billingAnchorAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  graceStartsAt: Date | null;
  graceEndsAt: Date | null;
  pendingPlanCode: string | null;
  pendingBillingInterval: string | null;
  pendingCatalogVersion: number | null;
  pendingEntitlementsSnapshot: Prisma.JsonValue | null;
  pendingEffectiveAt: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  version: number;
  /** O vínculo com o provedor. Diagnóstico — nenhuma regra decide por ele. */
  provider: string | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  providerPriceId: string | null;
  providerStatus: string | null;
  providerLastEventId: string | null;
  providerUpdatedAt: Date | null;
}

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  /**
   * Roda declarando a organização, para caminhos que ainda não a têm.
   *
   * O cadastro é público: quando a assinatura nasce, não existe requisição
   * autenticada e a política de RLS recusaria a linha — foi exatamente o
   * `42501` que apareceu na primeira execução. Aqui a organização acabou de
   * ser criada nesta mesma chamada, e declará-la é o mesmo caminho que
   * `RegistrationRepository` já usa para escrever as próprias linhas do
   * inquilino.
   */
  runAsOrganization<T>(
    organizationId: string,
    work: (transaction: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        `SELECT set_config('app.organization_id', $1, true)`,
        organizationId,
      );
      return work(transaction);
    });
  }

  /** A assinatura corrente — a única sem `endedAt`. */
  findCurrent(
    organizationId: string,
    transaction?: PrismaTransactionClient,
  ): Promise<SubscriptionRow | null> {
    const trabalho = (tx: PrismaTransactionClient) =>
      tx.organizationSubscription.findFirst({
        where: { organizationId, endedAt: null },
      });
    return transaction ? trabalho(transaction) : this.rls.run(trabalho);
  }

  create(
    data: Omit<
      SubscriptionRow,
      | 'id'
      | 'version'
      | 'provider'
      | 'providerSubscriptionId'
      | 'providerCustomerId'
      | 'providerPriceId'
      | 'providerStatus'
      | 'providerLastEventId'
      | 'providerUpdatedAt'
    >,
    transaction?: PrismaTransactionClient,
  ): Promise<SubscriptionRow> {
    const trabalho = (tx: PrismaTransactionClient) =>
      tx.organizationSubscription.create({
        data: {
          id: generateUuidV7(),
          ...data,
          entitlementsSnapshot:
            data.entitlementsSnapshot as Prisma.InputJsonValue,
          pendingEntitlementsSnapshot:
            (data.pendingEntitlementsSnapshot as Prisma.InputJsonValue) ??
            Prisma.DbNull,
        },
      });
    return transaction ? trabalho(transaction) : this.rls.run(trabalho);
  }

  /**
   * Atualiza somente se a versão esperada ainda vale.
   *
   * `updateMany` com `version` no filtro é a comparação e a escrita no mesmo
   * comando: não existe instante entre conferir e gravar. Zero linhas afetadas
   * significa que alguém escreveu antes — e quem chamou decide o que fazer.
   */
  async updateIfVersion(
    id: string,
    expectedVersion: number,
    data: Prisma.OrganizationSubscriptionUpdateInput,
    transaction?: PrismaTransactionClient,
  ): Promise<SubscriptionRow | null> {
    const trabalho = async (tx: PrismaTransactionClient) => {
      const { count } = await tx.organizationSubscription.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(data as Prisma.OrganizationSubscriptionUpdateManyMutationInput),
          version: { increment: 1 },
        },
      });
      if (count === 0) return null;
      return tx.organizationSubscription.findUniqueOrThrow({ where: { id } });
    };
    return transaction ? trabalho(transaction) : this.rls.run(trabalho);
  }

  /**
   * Grava o retrato do provedor.
   *
   * Fora do controle otimista de propósito: o retrato é diagnóstico e não
   * altera direito nenhum, e conferir versão aqui só faria o diagnóstico
   * envelhecer quando houvesse concorrência — que é justamente quando ele é
   * mais útil.
   */
  async updateProviderSnapshot(
    id: string,
    data: {
      providerStatus: string;
      providerPriceId: string | null;
      providerLastEventId: string | null;
      providerUpdatedAt: Date;
      cancelAtPeriodEnd: boolean;
    },
  ): Promise<void> {
    await this.rls.run((tx) =>
      tx.organizationSubscription.updateMany({ where: { id }, data }),
    );
  }

  /**
   * Liga a assinatura do Orbit à do provedor.
   *
   * O índice único em `provider_subscription_id` é quem garante um vínculo só:
   * duas entregas concorrentes do mesmo evento de criação não produzem duas
   * assinaturas ligadas ao mesmo objeto do provedor.
   */
  async linkProvider(
    id: string,
    link: {
      provider: string;
      providerSubscriptionId: string;
      providerCustomerId: string;
      providerPriceId: string | null;
      providerStatus: string;
    },
  ): Promise<boolean> {
    return this.rls.run(async (tx) => {
      const { count } = await tx.organizationSubscription.updateMany({
        where: { id, providerSubscriptionId: null },
        data: { ...link, providerUpdatedAt: new Date() },
      });
      if (count === 1) return true;

      const current = await tx.organizationSubscription.findUnique({
        where: { id },
        select: {
          provider: true,
          providerSubscriptionId: true,
          providerCustomerId: true,
          providerPriceId: true,
        },
      });
      return (
        current?.provider === link.provider &&
        current.providerSubscriptionId === link.providerSubscriptionId &&
        current.providerCustomerId === link.providerCustomerId &&
        current.providerPriceId === link.providerPriceId
      );
    });
  }

  /**
   * Assinaturas que o reconciliador precisa olhar.
   *
   * Consulta administrativa: roda fora do contexto de um inquilino, porque
   * varrer prazos é trabalho da plataforma. Devolve só o necessário para
   * projetar o estado, e é paginada por identificador para não crescer sem
   * limite.
   */
  async findDue(at: Date, take: number, after?: string) {
    return this.prisma.organizationSubscription.findMany({
      where: {
        endedAt: null,
        ...(after ? { id: { gt: after } } : {}),
        OR: [
          { status: 'TRIALING', trialEndsAt: { lte: at } },
          { status: 'GRACE_PERIOD', graceEndsAt: { lte: at } },
          {
            status: { in: ['ACTIVE', 'TRIALING'] },
            currentPeriodEnd: { lte: at },
          },
          { pendingEffectiveAt: { lte: at } },
        ],
      },
      orderBy: { id: 'asc' },
      take,
    });
  }

  /**
   * Registra a concessão de avaliação.
   *
   * Devolve `null` quando a impressão já existe: é o índice único global
   * respondendo, e não uma consulta anterior. Duas organizações tentando ao
   * mesmo tempo com o mesmo documento resultam em exatamente uma concessão.
   */
  async grantTrial(
    data: {
      organizationId: string;
      planCode: string;
      legalDocumentFingerprint: string;
      startsAt: Date;
      endsAt: Date;
      riskDecision: string;
      riskSignals?: Prisma.InputJsonValue;
    },
    transaction?: PrismaTransactionClient,
  ): Promise<{ id: string } | null> {
    const trabalho = async (tx: PrismaTransactionClient) => {
      try {
        return await tx.subscriptionTrialGrant.create({
          data: { id: generateUuidV7(), status: 'GRANTED', ...data },
          select: { id: true },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return null;
        }
        throw error;
      }
    };
    return transaction ? trabalho(transaction) : this.rls.run(trabalho);
  }

  /**
   * Aquele documento já consumiu a avaliação?
   *
   * Passa por uma função `SECURITY DEFINER` porque a resposta é cruzada entre
   * organizações e o papel de runtime **não** enxerga linha de outro
   * inquilino. A função devolve um booleano e nada mais: nem organização, nem
   * data, nem quem — o suficiente para decidir, insuficiente para virar
   * oráculo sobre a base de clientes.
   */
  async fingerprintConsumed(fingerprint: string): Promise<boolean> {
    /**
     * Sem contexto de inquilino, de propósito.
     *
     * A pergunta é da plataforma, não de uma organização — ela é feita no
     * cadastro, antes de a organização existir. Quem limita a resposta é a
     * própria função: `SECURITY DEFINER`, devolvendo um booleano e nada mais.
     * Exigir contexto aqui tornaria impossível perguntar na hora em que a
     * pergunta importa.
     */
    const linhas = await this.prisma.$queryRaw<{ consumed: boolean }[]>`
      SELECT app_trial_fingerprint_consumed(${fingerprint}) AS consumed
    `;
    return linhas[0]?.consumed === true;
  }

  findTrialGrant(organizationId: string) {
    return this.rls.run((tx) =>
      tx.subscriptionTrialGrant.findFirst({
        where: { organizationId },
        orderBy: { grantedAt: 'desc' },
      }),
    );
  }

  markTrialConverted(id: string, subscriptionId: string) {
    return this.rls.run((tx) =>
      tx.subscriptionTrialGrant.update({
        where: { id },
        data: { status: 'CONVERTED', convertedSubscriptionId: subscriptionId },
      }),
    );
  }
}
