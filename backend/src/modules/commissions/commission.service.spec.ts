/**
 * O que acontece quando comissão vira pagamento.
 *
 * Aqui mora o dinheiro, e três propriedades não aparecem em inspeção de código:
 *
 * 1. **O valor é do servidor.** A requisição escolhe quais comissões pagar;
 *    quanto é, quem decide é a política.
 * 2. **Não paga duas vezes.** O índice único do banco é a garantia final, mas se
 *    o serviço não descartar o já pago, o fechamento inteiro falha por causa de
 *    uma linha — e quem clicou não sabe o que foi pago.
 * 3. **O histórico não recalcula.** Comissão paga vale o que foi pago, mesmo
 *    depois de a política mudar.
 */
import { CommissionService } from './commission.service';
import { ConflictException, ValidationException } from '../../exceptions';
import type { CommissionActor } from './commission.service';

const ATOR: CommissionActor = { organizationId: 'org-1', actorId: 'user-1' };

const POLITICA = {
  id: 'pol-1',
  organizationId: 'org-1',
  period: 'MONTHLY',
  mode: 'FIXED',
  primaryValue: 50,
  assistantValue: 20,
  eligibleKinds: [] as string[],
  requiresConfirmedRevenue: true,
  active: true,
  createdById: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function operacao(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    code: 'OP-000001',
    title: 'Split sem gelar',
    kind: 'CORRECTIVE',
    status: 'COMPLETED',
    completedAt: new Date('2026-03-10T15:00:00Z'),
    responsibleFieldTechnicianId: 'tec-1',
    customer: { tradeName: 'Edifício Aurora', legalName: null },
    auxiliaryTechnicians: [{ userId: 'aux-1' }],
    financialEntries: [{ amount: 1000 }],
    ...overrides,
  };
}

function montar(
  options: {
    policy?: typeof POLITICA | null;
    operations?: ReturnType<typeof operacao>[];
    paid?: {
      operationId: string;
      userId: string;
      role: string;
      amount: number;
      paymentId: string;
      payment: { paidAt: Date } | null;
    }[];
    cancelled?: {
      operationId: string;
      userId: string;
      role: string;
      reason: string | null;
      cancelledAt: Date;
    }[];
  } = {},
) {
  const criados: Record<string, unknown>[] = [];

  const repository = {
    findPolicy: jest
      .fn()
      .mockResolvedValue(
        options.policy === undefined ? POLITICA : options.policy,
      ),
    upsertPolicy: jest.fn().mockResolvedValue(POLITICA),
    findCompletedOperations: jest
      .fn()
      .mockResolvedValue(options.operations ?? [operacao()]),
    findPaidItems: jest.fn().mockResolvedValue(options.paid ?? []),
    findCancellations: jest.fn().mockResolvedValue(options.cancelled ?? []),
    findCompletionDate: jest
      .fn()
      .mockResolvedValue(new Date('2026-03-10T15:00:00Z')),
    createCancellation: jest.fn().mockResolvedValue({ id: 'canc-1' }),
    revokeCancellation: jest.fn().mockResolvedValue(1),
    findTechnicians: jest.fn().mockResolvedValue([
      {
        userId: 'tec-1',
        status: 'ACTIVE',
        role: { name: 'Técnico' },
        user: { displayName: 'Eduardo Silva', email: 'eduardo@orbit.local' },
      },
      {
        userId: 'aux-1',
        status: 'ACTIVE',
        role: { name: 'Auxiliar' },
        user: { displayName: 'Rafael Nunes', email: 'rafael@orbit.local' },
      },
    ]),
    findFieldTechnicianIds: jest.fn().mockResolvedValue(['tec-1', 'aux-1']),
    findWorkload: jest.fn().mockResolvedValue(new Map()),
    listPayments: jest.fn().mockResolvedValue([]),
    createPayment: jest
      .fn()
      .mockImplementation((input: Record<string, unknown>) => {
        criados.push(input);
        return Promise.resolve({
          id: 'pay-1',
          userId: input.userId,
          amount: input.amount,
          currency: 'BRL',
          method: input.method ?? null,
          notes: input.notes ?? null,
          periodStart: null,
          periodEnd: null,
          paidAt: new Date('2026-03-31T12:00:00Z'),
          createdBy: { id: 'user-1', displayName: 'Dono' },
          items: [],
        });
      }),
  };

  return {
    service: new CommissionService(repository as never),
    repository,
    criados,
  };
}

describe('CommissionService.policy', () => {
  it('devolve política desligada e não configurada quando não existe', async () => {
    const { service } = montar({ policy: null });

    await expect(service.policy(ATOR)).resolves.toMatchObject({
      configured: false,
      active: false,
      primaryValue: 0,
    });
  });

  it('recusa percentual acima de cem', async () => {
    const { service } = montar();

    await expect(
      service.savePolicy(ATOR, {
        period: 'MONTHLY',
        mode: 'PERCENTAGE',
        primaryValue: 120,
        assistantValue: 10,
        requiresConfirmedRevenue: true,
        active: true,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('recusa ligar a política sem valor para nenhum papel', async () => {
    /* Ativa e sem valor, a tela mostraria "comissão ativa" e nenhuma comissão —
       e alguém passaria o mês esperando o fechamento. */
    const { service } = montar();

    await expect(
      service.savePolicy(ATOR, {
        period: 'MONTHLY',
        mode: 'FIXED',
        primaryValue: 0,
        assistantValue: 0,
        requiresConfirmedRevenue: true,
        active: true,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});

describe('CommissionService.list', () => {
  it('não calcula nada com a política desligada', async () => {
    const { service, repository } = montar({
      policy: { ...POLITICA, active: false },
    });

    const resultado = await service.list(ATOR, {});

    expect(resultado.commissions).toEqual([]);
    expect(repository.findCompletedOperations).not.toHaveBeenCalled();
  });

  it('marca como paga a comissão já coberta, com o valor congelado', async () => {
    /* A política mudou de 50 para 80 depois do pagamento. O histórico tem de
       continuar dizendo 50 — senão o relatório de um mês fechado muda sozinho. */
    const { service } = montar({
      policy: { ...POLITICA, primaryValue: 80 },
      paid: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          amount: 50,
          paymentId: 'pay-0',
          payment: { paidAt: new Date('2026-03-20T10:00:00Z') },
        },
      ],
    });

    const { commissions } = await service.list(ATOR, {});
    const paga = commissions.find((item) => item.userId === 'tec-1');

    expect(paga).toMatchObject({ status: 'PAID', amount: 50 });
    expect(commissions.find((item) => item.userId === 'aux-1')).toMatchObject({
      status: 'PENDING',
    });
  });

  it('recusa recorte com fim antes do início', async () => {
    const { service } = montar();

    await expect(
      service.list(ATOR, { from: '2026-03-31', to: '2026-03-01' }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('mostra só a comissão da pessoa consultada', async () => {
    /* O atendimento vem inteiro do banco, com responsável e auxiliares: sem o
       filtro, consultar um técnico mostraria a comissão dos colegas. */
    const { service } = montar();

    const { commissions } = await service.list(ATOR, { userId: 'aux-1' });

    expect(commissions.map((item) => item.userId)).toEqual(['aux-1']);
  });
});

describe('CommissionService.pay', () => {
  it('soma o valor no servidor, a partir da política', async () => {
    const { service, criados } = montar();

    await service.pay(ATOR, { userId: 'tec-1' });

    expect(criados[0]).toMatchObject({ userId: 'tec-1', amount: 50 });
    expect((criados[0]!.lines as unknown[]).length).toBe(1);
  });

  it('paga só as comissões escolhidas', async () => {
    const { service, criados } = montar({
      operations: [
        operacao(),
        operacao({ id: 'op-2', code: 'OP-000002', auxiliaryTechnicians: [] }),
      ],
    });

    await service.pay(ATOR, {
      userId: 'tec-1',
      selection: [{ operationId: 'op-2', role: 'PRIMARY' }],
    });

    expect(criados[0]).toMatchObject({ amount: 50 });
    const linhas = criados[0]!.lines as { operationId: string }[];
    expect(linhas.map((linha) => linha.operationId)).toEqual(['op-2']);
  });

  it('descarta em silêncio o que já foi pago, e paga o resto', async () => {
    /* Entre abrir a tela e clicar, alguém pode ter fechado uma das comissões.
       Recusar o lote inteiro obrigaria a recarregar e tentar de novo. */
    const { service, criados } = montar({
      operations: [
        operacao(),
        operacao({ id: 'op-2', code: 'OP-000002', auxiliaryTechnicians: [] }),
      ],
      paid: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          amount: 50,
          paymentId: 'pay-0',
          payment: { paidAt: new Date('2026-03-20T10:00:00Z') },
        },
      ],
    });

    await service.pay(ATOR, { userId: 'tec-1' });

    const linhas = criados[0]!.lines as { operationId: string }[];
    expect(linhas.map((linha) => linha.operationId)).toEqual(['op-2']);
  });

  it('recusa quando não há nada pendente', async () => {
    const { service } = montar({
      paid: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          amount: 50,
          paymentId: 'pay-0',
          payment: null,
        },
      ],
    });

    await expect(service.pay(ATOR, { userId: 'tec-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa pagar com a política desligada, e diz que é a política', async () => {
    /* A mensagem importa: "nada pendente" mandaria a pessoa procurar
       atendimentos concluídos, quando o que falta é ligar a comissão. */
    const { service } = montar({ policy: { ...POLITICA, active: false } });

    await expect(service.pay(ATOR, { userId: 'tec-1' })).rejects.toThrow(
      /desligada/,
    );
  });

  it('paga só a pessoa pedida, e pede ao banco só o dela', async () => {
    /* O atendimento tem responsável e auxiliar. O recorte por pessoa é do
       banco — se a consulta viesse aberta, a comissão do colega entraria no
       pagamento de quem foi escolhido. */
    const { service, criados, repository } = montar();

    await service.pay(ATOR, { userId: 'aux-1' });

    expect(repository.findCompletedOperations).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'aux-1' }),
    );
    const linhas = criados[0]!.lines as { userId: string; amount: number }[];
    expect(linhas).toEqual([
      expect.objectContaining({ userId: 'aux-1', amount: 20 }),
    ]);
  });
});

describe('CommissionService.overview', () => {
  it('lista o técnico sem comissão na janela, com o motivo quando desligada', async () => {
    const { service } = montar({ policy: { ...POLITICA, active: false } });

    const resumo = await service.overview(ATOR, {});

    expect(resumo.inactiveReason).toContain('desligada');
    /* Sem comissão, todos empatam em zero e a ordem é alfabética pelo nome:
       Eduardo antes de Rafael. Uma tabela que esconde o técnico sem comissão
       faria a pessoa procurar por alguém que "desapareceu". */
    expect(resumo.technicians.map((linha) => linha.userName)).toEqual([
      'Eduardo Silva',
      'Rafael Nunes',
    ]);
    expect(resumo.pendingTotal).toBe(0);
  });

  it('ordena por quem tem mais a receber', async () => {
    const { service } = montar();

    const resumo = await service.overview(ATOR, {});

    expect(resumo.technicians[0]).toMatchObject({
      userId: 'tec-1',
      pendingAmount: 50,
      pendingCount: 1,
    });
    expect(resumo.technicians[1]).toMatchObject({
      userId: 'aux-1',
      pendingAmount: 20,
    });
    expect(resumo.pendingTotal).toBe(70);
  });
});

describe('CommissionService.cancel', () => {
  const alvo = { operationId: 'op-1', userId: 'tec-1', role: 'PRIMARY' };

  it('registra a decisão e a comissão passa a CANCELLED', async () => {
    const { service, repository } = montar();

    /* Antes de gravar não há cancelação; depois, há. É a sequência do banco, e
       sem ela o próprio guarda de "já está cancelada" recusaria o primeiro
       cancelamento. */
    repository.createCancellation.mockImplementation(() => {
      repository.findCancellations.mockResolvedValue([
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: 'serviço refeito sem custo',
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ]);
      return Promise.resolve({ id: 'canc-1' });
    });

    const resultado = await service.cancel(ATOR, {
      ...alvo,
      reason: 'serviço refeito sem custo',
    });

    expect(repository.createCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ ...alvo, reason: 'serviço refeito sem custo' }),
    );
    expect(resultado.status).toBe('CANCELLED');
    expect(resultado.cancelReason).toBe('serviço refeito sem custo');
  });

  it('recusa cancelar o que já foi pago', async () => {
    /* Dinheiro que saiu não se cancela, se estorna — e estorno é lançamento
       financeiro, não linha de comissão. */
    const { service, repository } = montar({
      paid: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          amount: 50,
          paymentId: 'pay-0',
          payment: { paidAt: new Date('2026-03-18T10:00:00Z') },
        },
      ],
    });

    await expect(service.cancel(ATOR, alvo)).rejects.toThrow(/estornar/);
    expect(repository.createCancellation).not.toHaveBeenCalled();
  });

  it('recusa cancelar duas vezes', async () => {
    const { service } = montar({
      cancelled: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: null,
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ],
    });

    await expect(service.cancel(ATOR, alvo)).rejects.toThrow(/já está/);
  });

  it('recusa cancelar comissão que não existe no atendimento', async () => {
    /* `operationId` digitado errado criaria uma decisão sobre nada. */
    const { service } = montar();

    await expect(
      service.cancel(ATOR, { ...alvo, role: 'ASSISTANT' }),
    ).rejects.toThrow();
  });
});

describe('CommissionService.restore', () => {
  const alvo = { operationId: 'op-1', userId: 'tec-1', role: 'PRIMARY' };

  it('desfaz a decisão e a comissão volta a pendente', async () => {
    const { service, repository } = montar({
      cancelled: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: null,
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ],
    });
    /* Depois de revogar, a consulta não vê mais cancelação em vigor. */
    repository.revokeCancellation.mockImplementation(() => {
      repository.findCancellations.mockResolvedValue([]);
      return Promise.resolve(1);
    });

    const resultado = await service.restore(ATOR, alvo);

    expect(resultado.status).toBe('PENDING');
  });

  it('recusa desfazer o que não está cancelado', async () => {
    /* Zero linhas mudadas é diferente de "desfeito": quem pediu precisa saber. */
    const { service, repository } = montar();
    repository.revokeCancellation.mockResolvedValue(0);

    await expect(service.restore(ATOR, alvo)).rejects.toThrow(/não está/);
  });
});

describe('comissão cancelada e o pagamento', () => {
  it('não paga o que foi cancelado, nem quando vem selecionada', async () => {
    /* A seleção da tela pode ter sido feita antes de alguém cancelar. */
    const { service } = montar({
      cancelled: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: null,
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ],
    });

    await expect(
      service.pay(ATOR, {
        userId: 'tec-1',
        selection: [{ operationId: 'op-1', role: 'PRIMARY' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('soma a cancelada em coluna própria no resumo', async () => {
    const { service } = montar({
      cancelled: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: null,
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ],
    });

    const resumo = await service.overview(ATOR, {});
    const linha = resumo.technicians.find((item) => item.userId === 'tec-1');

    expect(linha).toMatchObject({
      pendingAmount: 0,
      cancelledAmount: 50,
      cancelledCount: 1,
    });
    expect(resumo.pendingTotal).toBe(20);
  });

  it('pago vence cancelado, se as duas linhas existirem', async () => {
    /* O serviço impede chegar aqui: cancelar recusa o que foi pago, e pagar
       ignora o cancelado. Mas são duas tabelas, e nenhum `CHECK` do banco
       relaciona as duas — um conserto manual ou um caminho futuro pode criar o
       par. Quando criar, o fato mais forte é o dinheiro que saiu: dizer
       "cancelada" sobre uma comissão paga faria alguém pagar de novo. */
    const { service } = montar({
      paid: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          amount: 50,
          paymentId: 'pay-0',
          payment: { paidAt: new Date('2026-03-18T10:00:00Z') },
        },
      ],
      cancelled: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: 'cancelada por engano depois de paga',
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ],
    });

    const { commissions } = await service.list(ATOR, {});
    const linha = commissions.find((item) => item.userId === 'tec-1');

    expect(linha?.status).toBe('PAID');
    expect(linha?.cancelReason).toBeNull();
  });

  it('a lista filtra por situação quando pedido', async () => {
    const { service } = montar({
      cancelled: [
        {
          operationId: 'op-1',
          userId: 'tec-1',
          role: 'PRIMARY',
          reason: null,
          cancelledAt: new Date('2026-03-20T10:00:00Z'),
        },
      ],
    });

    const canceladas = await service.list(ATOR, { status: 'CANCELLED' });
    const pendentes = await service.list(ATOR, { status: 'PENDING' });

    expect(canceladas.commissions.map((item) => item.userId)).toEqual([
      'tec-1',
    ]);
    expect(pendentes.commissions.map((item) => item.userId)).toEqual(['aux-1']);
  });
});
