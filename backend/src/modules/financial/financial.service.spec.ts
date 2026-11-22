/**
 * Regras do Financeiro, sem banco.
 *
 * O que se prova aqui é decisão de domínio: o que pode ser editado, o que
 * precisa de motivo, o que não pode ser somado junto. A idempotência de origem
 * e o isolamento por tenant **não** estão aqui de propósito — são garantias do
 * banco, e um mock delas provaria apenas que o mock funciona. Ver o E2E.
 */
import { ConflictException, ValidationException } from '../../exceptions';
import { FinancialMapper } from './financial.mapper';
import type { FinancialRepository } from './financial.repository';
import { FinancialService } from './financial.service';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry-id',
  type: 'INCOME',
  status: 'PENDING',
  source: 'MANUAL',
  sourceEntityId: null,
  amount: '150.00',
  currency: 'BRL',
  description: 'Manutenção preventiva',
  notes: null,
  competenceDate: new Date('2026-08-01T00:00:00.000Z'),
  dueDate: null,
  confirmedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  category: null,
  businessUnit: { id: 'unit-id', legalName: 'Matriz', tradeName: null },
  customer: null,
  operation: null,
  createdBy: { id: 'user-id', displayName: 'Técnico' },
  confirmedBy: null,
  cancelledBy: null,
  ...overrides,
});

describe('FinancialService', () => {
  const repository = {
    ensureSettings: jest.fn(),
    updateSettings: jest.fn(),
    listCategories: jest.fn(),
    findCategory: jest.fn(),
    createCategory: jest.fn(),
    softDeleteCategory: jest.fn(),
    list: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    createFromSource: jest.fn(),
    totals: jest.fn(),
    overdue: jest.fn(),
    timeline: jest.fn(),
    findBusinessUnit: jest.fn(),
    findCustomer: jest.fn(),
    findOperation: jest.fn(),
  };

  const service = new FinancialService(
    repository as unknown as FinancialRepository,
    new FinancialMapper(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.ensureSettings.mockResolvedValue({
      autoRecordReceipts: true,
      defaultCurrency: 'BRL',
      updatedAt: new Date(),
    });
    repository.findBusinessUnit.mockResolvedValue({ id: 'unit-id' });
    repository.listCategories.mockResolvedValue([]);
  });

  /* ---------------------------------------------------------------- */
  /* Criação                                                           */
  /* ---------------------------------------------------------------- */

  it('exige unidade de negócio: dinheiro é contado por unidade', async () => {
    await expect(
      service.create('org-id', null, 'user-id', {
        type: 'EXPENSE',
        amount: 100,
        description: 'Peça',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('grava o valor como decimal de duas casas, e não como número', async () => {
    repository.create.mockResolvedValue(entry());
    await service.create('org-id', 'unit-id', 'user-id', {
      type: 'INCOME',
      amount: 1250.5,
      description: 'Serviço',
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '1250.50', source: 'MANUAL' }),
      'user-id',
    );
  });

  it('recusa categoria do lado oposto ao do lançamento', async () => {
    repository.findCategory.mockResolvedValue({
      id: 'category-id',
      type: 'EXPENSE',
    });
    await expect(
      service.create('org-id', 'unit-id', 'user-id', {
        type: 'INCOME',
        amount: 10,
        description: 'Serviço',
        categoryId: 'category-id',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('nasce confirmado apenas quando pedido, com autor e carimbo', async () => {
    repository.create.mockResolvedValue(entry({ status: 'CONFIRMED' }));
    await service.create('org-id', 'unit-id', 'user-id', {
      type: 'INCOME',
      amount: 10,
      description: 'Serviço',
      status: 'CONFIRMED',
    });
    const [data] = repository.create.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(data.status).toBe('CONFIRMED');
    expect(data.confirmedById).toBe('user-id');
    expect(data.confirmedAt).toBeInstanceOf(Date);
  });

  /* ---------------------------------------------------------------- */
  /* Origem                                                            */
  /* ---------------------------------------------------------------- */

  it('recusa editar lançamento de origem automática', async () => {
    repository.find.mockResolvedValue(
      entry({ source: 'RECEIPT', sourceEntityId: 'manifest-id' }),
    );
    await expect(
      service.update('entry-id', 'org-id', 'user-id', { amount: 999 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('permite cancelar lançamento de recibo — estorno é fato financeiro', async () => {
    repository.find.mockResolvedValue(
      entry({ source: 'RECEIPT', status: 'CONFIRMED' }),
    );
    repository.update.mockResolvedValue(entry({ status: 'CANCELLED' }));
    await service.cancel('entry-id', 'org-id', 'user-id', {
      reason: 'Pagamento estornado pelo banco',
    });
    const [, , , data] = repository.update.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(data.status).toBe('CANCELLED');
    expect(data.cancelReason).toBe('Pagamento estornado pelo banco');
  });

  it('não reabre lançamento cancelado por edição', async () => {
    repository.find.mockResolvedValue(entry({ status: 'CANCELLED' }));
    await expect(
      service.update('entry-id', 'org-id', 'user-id', { amount: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirma somente o que está pendente', async () => {
    repository.find.mockResolvedValue(entry({ status: 'CONFIRMED' }));
    await expect(
      service.confirm('entry-id', 'org-id', 'user-id', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ---------------------------------------------------------------- */
  /* Categorias                                                        */
  /* ---------------------------------------------------------------- */

  it('não remove categoria ainda usada por lançamentos', async () => {
    repository.findCategory.mockResolvedValue({
      id: 'category-id',
      isSystem: false,
      _count: { entries: 3 },
    });
    await expect(
      service.removeCategory('category-id', 'org-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não remove categoria do sistema', async () => {
    repository.findCategory.mockResolvedValue({
      id: 'category-id',
      isSystem: true,
      _count: { entries: 0 },
    });
    await expect(
      service.removeCategory('category-id', 'org-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ---------------------------------------------------------------- */
  /* Consultas                                                         */
  /* ---------------------------------------------------------------- */

  it('recusa filtro contraditório entre vencido e situação', async () => {
    await expect(
      service.list('org-id', {
        overdue: true,
        status: 'CONFIRMED',
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('recusa período invertido', async () => {
    await expect(
      service.list('org-id', {
        from: new Date('2026-08-31'),
        to: new Date('2026-08-01'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  it('separa realizado de previsto e nunca os soma', async () => {
    repository.totals.mockResolvedValue([
      {
        type: 'INCOME',
        status: 'CONFIRMED',
        _sum: { amount: '1000.00' },
        _count: { _all: 2 },
      },
      {
        type: 'INCOME',
        status: 'PENDING',
        _sum: { amount: '500.00' },
        _count: { _all: 1 },
      },
      {
        type: 'EXPENSE',
        status: 'CONFIRMED',
        _sum: { amount: '250.00' },
        _count: { _all: 1 },
      },
      {
        type: 'EXPENSE',
        status: 'PENDING',
        _sum: { amount: '100.00' },
        _count: { _all: 1 },
      },
    ]);
    repository.overdue.mockResolvedValue([
      { type: 'INCOME', _sum: { amount: '60.00' }, _count: { _all: 1 } },
      { type: 'EXPENSE', _sum: { amount: '40.00' }, _count: { _all: 2 } },
    ]);

    const summary = await service.summary('org-id', {});

    expect(summary.income.confirmed).toBe('1000.00');
    expect(summary.income.pending).toBe('500.00');
    expect(summary.expense.confirmed).toBe('250.00');
    /** Realizado menos realizado — a previsão não entra na conta do caixa. */
    expect(summary.netConfirmed).toBe('750.00');
    expect(summary.netPending).toBe('400.00');
    expect(summary.overdue.pending).toBe('100.00');
    /* Receita vencida é cobrança; despesa vencida é conta atrasada. */
    expect(summary.overdueIncome).toMatchObject({ pending: '60.00', count: 1 });
    expect(summary.overdueExpense).toMatchObject({
      pending: '40.00',
      count: 2,
    });
  });

  it('a série agrupa por mês ou por dia, conforme pedido', async () => {
    const rows = [
      {
        month: new Date('2026-11-03T00:00:00Z'),
        type: 'INCOME',
        status: 'CONFIRMED',
        total: '300.00',
      },
      {
        month: new Date('2026-11-03T00:00:00Z'),
        type: 'EXPENSE',
        status: 'CONFIRMED',
        total: '120.00',
      },
      {
        month: new Date('2026-11-05T00:00:00Z'),
        type: 'INCOME',
        status: 'PENDING',
        total: '50.00',
      },
    ];
    repository.timeline.mockResolvedValue(rows);

    const daily = await service.timeline('org-id', {
      from: new Date('2026-11-01'),
      to: new Date('2026-11-07'),
      granularity: 'DAY',
    });
    expect(repository.timeline).toHaveBeenLastCalledWith(
      expect.anything(),
      'DAY',
    );
    expect(daily.map((point) => point.period)).toEqual([
      '2026-11-03',
      '2026-11-05',
    ]);
    expect(daily[0]).toMatchObject({
      month: '2026-11',
      incomeConfirmed: '300.00',
      expenseConfirmed: '120.00',
      netConfirmed: '180.00',
    });
    expect(daily[1]!.incomePending).toBe('50.00');

    const monthly = await service.timeline('org-id', {});
    expect(repository.timeline).toHaveBeenLastCalledWith(
      expect.anything(),
      'MONTH',
    );
    expect(monthly).toHaveLength(1);
    expect(monthly[0]).toMatchObject({ period: '2026-11', month: '2026-11' });
  });

  it('devolve zeros, e não ausência, quando o período não tem movimento', async () => {
    repository.totals.mockResolvedValue([]);
    repository.overdue.mockResolvedValue([]);
    const summary = await service.summary('org-id', {});
    expect(summary.income.confirmed).toBe('0.00');
    expect(summary.netConfirmed).toBe('0.00');
  });

  /* ---------------------------------------------------------------- */
  /* Configuração                                                      */
  /* ---------------------------------------------------------------- */

  it('recusa moeda fora das suportadas', async () => {
    await expect(
      service.updateSettings('org-id', 'user-id', { defaultCurrency: 'XYZ' }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('registra o valor anterior ao alterar a configuração', async () => {
    repository.updateSettings.mockResolvedValue({
      autoRecordReceipts: false,
      defaultCurrency: 'BRL',
      updatedAt: new Date(),
    });
    await service.updateSettings('org-id', 'user-id', {
      autoRecordReceipts: false,
    });
    expect(repository.updateSettings).toHaveBeenCalledWith(
      'org-id',
      expect.objectContaining({ autoRecordReceipts: false }),
      'user-id',
      expect.objectContaining({ autoRecordReceipts: true }),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Origem automática                                                 */
  /* ---------------------------------------------------------------- */

  it('trata "já existe" como sucesso ao lançar a partir de documento', async () => {
    repository.createFromSource.mockResolvedValue(null);
    const result = await service.recordFromSource({
      organizationId: 'org-id',
      businessUnitId: 'unit-id',
      source: 'RECEIPT',
      sourceEntityId: 'manifest-id',
      amount: '300.00',
      currency: 'BRL',
      description: 'Recibo',
      competenceDate: new Date('2026-08-05T12:00:00.000Z'),
      actorId: 'user-id',
    });
    expect(result).toBeNull();
  });

  it('lança recibo já confirmado — o dinheiro entrou', async () => {
    repository.createFromSource.mockResolvedValue(entry({ source: 'RECEIPT' }));
    await service.recordFromSource({
      organizationId: 'org-id',
      businessUnitId: 'unit-id',
      source: 'RECEIPT',
      sourceEntityId: 'manifest-id',
      amount: '300.00',
      currency: 'BRL',
      description: 'Recibo',
      competenceDate: new Date('2026-08-05T12:00:00.000Z'),
      actorId: 'user-id',
    });
    const [data] = repository.createFromSource.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(data.status).toBe('CONFIRMED');
    expect(data.type).toBe('INCOME');
    expect(data.sourceEntityId).toBe('manifest-id');
    /** Competência preserva o dia do documento, sem deslocamento por fuso. */
    expect((data.competenceDate as Date).toISOString()).toBe(
      '2026-08-05T00:00:00.000Z',
    );
  });
});
