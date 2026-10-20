/**
 * O cálculo da comissão.
 *
 * Todo defeito aqui sai como um número plausível — ninguém desconfia de
 * R$ 240,00 —, e o erro só aparece quando o técnico reclama do pagamento. Cada
 * caso abaixo é uma regra que alguém combinou com a equipe.
 */
import {
  currentWindow,
  isCommissionable,
  linesFor,
  sumAmounts,
  type CommissionOperationSource,
  type CommissionPolicySource,
} from './commission.calculator';

const POLITICA: CommissionPolicySource = {
  period: 'MONTHLY',
  mode: 'FIXED',
  primaryValue: 50,
  assistantValue: 20,
  eligibleKinds: [],
  requiresConfirmedRevenue: true,
  active: true,
};

const ATENDIMENTO: CommissionOperationSource = {
  id: 'op-1',
  code: 'OP-000001',
  title: 'Split sem gelar',
  kind: 'CORRECTIVE',
  status: 'COMPLETED',
  completedAt: new Date('2026-03-10T15:00:00Z'),
  customerName: 'Edifício Aurora',
  primaryUserId: 'tec-1',
  assistantUserIds: ['aux-1'],
  confirmedRevenue: 1000,
};

describe('isCommissionable', () => {
  it('não gera comissão com a política desligada', () => {
    expect(isCommissionable(ATENDIMENTO, { ...POLITICA, active: false })).toBe(
      false,
    );
  });

  it('só gera com o atendimento concluído', () => {
    /* Em andamento o serviço ainda pode não acontecer. Pagar antes é adiantar
       sobre um fato que não existe. */
    for (const status of ['OPEN', 'IN_PROGRESS', 'PAUSED', 'CANCELLED']) {
      expect(isCommissionable({ ...ATENDIMENTO, status }, POLITICA)).toBe(
        false,
      );
    }
    expect(isCommissionable(ATENDIMENTO, POLITICA)).toBe(true);
  });

  it('respeita os tipos elegíveis, e lista vazia significa todos', () => {
    expect(
      isCommissionable(ATENDIMENTO, {
        ...POLITICA,
        eligibleKinds: ['PREVENTIVE'],
      }),
    ).toBe(false);
    expect(
      isCommissionable(ATENDIMENTO, {
        ...POLITICA,
        eligibleKinds: ['CORRECTIVE', 'PREVENTIVE'],
      }),
    ).toBe(true);
    expect(isCommissionable(ATENDIMENTO, POLITICA)).toBe(true);
  });

  it('paga pelo serviço feito quando a política dispensa receita', () => {
    const semReceita = { ...ATENDIMENTO, confirmedRevenue: 0 };

    expect(isCommissionable(semReceita, POLITICA)).toBe(false);
    expect(
      isCommissionable(semReceita, {
        ...POLITICA,
        requiresConfirmedRevenue: false,
      }),
    ).toBe(true);
  });

  it('percentual sem receita não gera comissão, mesmo dispensando a exigência', () => {
    /* Percentual de zero é zero: a linha existiria valendo nada, e uma lista de
       comissões com R$ 0,00 pede conferência a cada fechamento. */
    expect(
      isCommissionable(
        { ...ATENDIMENTO, confirmedRevenue: 0 },
        { ...POLITICA, mode: 'PERCENTAGE', requiresConfirmedRevenue: false },
      ),
    ).toBe(false);
  });
});

describe('linesFor', () => {
  it('paga o responsável e o auxiliar com valores diferentes', () => {
    const linhas = linesFor(ATENDIMENTO, POLITICA);

    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.role === 'PRIMARY')).toMatchObject({
      userId: 'tec-1',
      amount: 50,
      baseAmount: null,
    });
    expect(linhas.find((l) => l.role === 'ASSISTANT')).toMatchObject({
      userId: 'aux-1',
      amount: 20,
    });
  });

  it('calcula o percentual sobre a receita confirmada', () => {
    const linhas = linesFor(ATENDIMENTO, {
      ...POLITICA,
      mode: 'PERCENTAGE',
      primaryValue: 7.5,
      assistantValue: 2.5,
    });

    expect(linhas.find((l) => l.role === 'PRIMARY')).toMatchObject({
      amount: 75,
      baseAmount: 1000,
    });
    expect(linhas.find((l) => l.role === 'ASSISTANT')?.amount).toBe(25);
  });

  it('arredonda para centavo, e não para o que o ponto flutuante devolve', () => {
    const linhas = linesFor(
      { ...ATENDIMENTO, confirmedRevenue: 333.33, assistantUserIds: [] },
      { ...POLITICA, mode: 'PERCENTAGE', primaryValue: 10 },
    );

    expect(linhas[0]!.amount).toBe(33.33);
  });

  it('omite o papel sem valor configurado, em vez de listar zero', () => {
    const linhas = linesFor(ATENDIMENTO, { ...POLITICA, assistantValue: 0 });

    expect(linhas.map((linha) => linha.role)).toEqual(['PRIMARY']);
  });

  it('não paga duas vezes quem é responsável e também consta como auxiliar', () => {
    /* O índice único do pagamento recusaria a segunda linha — depois de o valor
       já ter aparecido somado na tela. */
    const linhas = linesFor(
      { ...ATENDIMENTO, assistantUserIds: ['tec-1', 'aux-1'] },
      POLITICA,
    );

    expect(linhas.filter((linha) => linha.userId === 'tec-1')).toHaveLength(1);
    expect(linhas.find((linha) => linha.userId === 'tec-1')?.role).toBe(
      'PRIMARY',
    );
  });

  it('conta o auxiliar repetido uma vez só', () => {
    const linhas = linesFor(
      {
        ...ATENDIMENTO,
        primaryUserId: null,
        assistantUserIds: ['aux-1', 'aux-1'],
      },
      POLITICA,
    );

    expect(linhas).toHaveLength(1);
  });

  it('não gera nada para atendimento sem técnico', () => {
    expect(
      linesFor(
        { ...ATENDIMENTO, primaryUserId: null, assistantUserIds: [] },
        POLITICA,
      ),
    ).toEqual([]);
  });
});

describe('currentWindow', () => {
  it('mensal é o mês civil inteiro', () => {
    const janela = currentWindow('MONTHLY', new Date('2026-02-10T12:00:00Z'));

    expect(janela.from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(janela.to.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('quinzenal é a quinzena brasileira, não quinze dias para trás', () => {
    /* "Quinze dias para trás" faria o fechamento andar de lugar a cada mês, e
       ninguém saberia dizer quando a quinzena começa. */
    const primeira = currentWindow(
      'BIWEEKLY',
      new Date('2026-03-10T12:00:00Z'),
    );
    expect(primeira.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(primeira.to.toISOString()).toBe('2026-03-15T23:59:59.999Z');

    const segunda = currentWindow('BIWEEKLY', new Date('2026-03-20T12:00:00Z'));
    expect(segunda.from.toISOString()).toBe('2026-03-16T00:00:00.000Z');
    expect(segunda.to.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('semanal começa na segunda, inclusive quando hoje é domingo', () => {
    /* `getUTCDay` devolve 0 no domingo: sem tratar, a semana começaria no dia
       seguinte e o domingo cairia numa janela que ainda não existe. */
    const domingo = currentWindow('WEEKLY', new Date('2026-03-15T12:00:00Z'));
    expect(domingo.from.toISOString()).toBe('2026-03-09T00:00:00.000Z');
    expect(domingo.to.toISOString()).toBe('2026-03-15T23:59:59.999Z');

    const segunda = currentWindow('WEEKLY', new Date('2026-03-09T00:30:00Z'));
    expect(segunda.from.toISOString()).toBe('2026-03-09T00:00:00.000Z');
  });

  it('a janela semanal tem sete dias, e atravessa o mês', () => {
    const janela = currentWindow('WEEKLY', new Date('2026-04-01T12:00:00Z'));

    expect(janela.from.toISOString()).toBe('2026-03-30T00:00:00.000Z');
    expect(janela.to.toISOString()).toBe('2026-04-05T23:59:59.999Z');
  });
});

describe('sumAmounts', () => {
  it('soma sem arrastar erro de ponto flutuante', () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(sumAmounts([])).toBe(0);
  });
});
