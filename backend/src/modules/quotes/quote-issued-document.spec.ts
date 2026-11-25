/**
 * O documento emitido da proposta, publicado para baixar e compartilhar.
 *
 * Não há chave estrangeira entre proposta e execução: a emissão usa o código da
 * proposta como código da execução, único por organização. Estes testes provam
 * que a leitura segue esse vínculo — e só entrega o que já está emitido.
 */
import { QuoteMapper } from './quote.mapper';
import { QuoteRepository } from './quote.repository';

const decimal = (value: string) => ({ toString: () => value });

const quote = (overrides: Record<string, unknown> = {}) => ({
  id: 'quote-id',
  number: 1,
  code: 'ORC-000001',
  status: 'SENT',
  mobileVisible: false,
  title: 'Manutenção preventiva anual',
  notes: null,
  validUntil: null,
  currency: 'BRL',
  subtotal: decimal('1000.00'),
  discount: decimal('0.00'),
  discountReason: null,
  total: decimal('1000.00'),
  operationId: null,
  operation: null,
  convertedAt: null,
  sentAt: null,
  decidedAt: null,
  closingReason: null,
  expiredAt: null,
  cancelledAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  introText: null,
  customer: { id: 'customer-id', legalName: 'Cliente', tradeName: null },
  businessUnit: { id: 'unit-id', legalName: 'Matriz', tradeName: null },
  createdBy: { id: 'user-id', displayName: 'Vendedor' },
  sentBy: null,
  decidedBy: null,
  responsible: null,
  serviceAddress: null,
  assets: [],
  items: [],
  _count: { items: 1 },
  ...overrides,
});

function repositorio(documentos: unknown[]) {
  const findMany = jest
    .fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue(documentos);
  const tx = {
    quote: {
      findMany: jest
        .fn()
        .mockResolvedValue([quote(), quote({ id: 'q2', code: 'ORC-000002' })]),
      count: jest.fn().mockResolvedValue(2),
      findFirst: jest.fn().mockResolvedValue(quote()),
    },
    artifactExecution: { findMany },
  };
  const rls = { run: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const repo = new QuoteRepository(rls as never, {} as never, {} as never);
  jest
    .spyOn(
      repo as unknown as { expireStale: () => Promise<void> },
      'expireStale',
    )
    .mockResolvedValue(undefined);
  return { repo, findMany };
}

describe('documento emitido da proposta', () => {
  it('o mapeador publica o documento quando a leitura o trouxe', () => {
    const mapper = new QuoteMapper();

    const comDocumento = mapper.summary(
      quote({
        issuedDocument: {
          id: 'exec-1',
          code: 'ORC-000001',
          title: 'Orçamento ORC-000001',
          renderStatus: 'READY',
        },
      }) as never,
    );

    expect(comDocumento.document).toEqual({
      executionId: 'exec-1',
      code: 'ORC-000001',
      title: 'Orçamento ORC-000001',
      renderStatus: 'READY',
    });
    expect(mapper.summary(quote() as never).document).toBeNull();
  });

  it('a listagem procura pelo código da proposta, só entre os emitidos, numa consulta', async () => {
    const { repo, findMany } = repositorio([
      {
        id: 'exec-2',
        code: 'ORC-000002',
        title: 'Orçamento ORC-000002',
        renderStatus: 'READY',
      },
    ]);

    const page = await repo.list('org-1', {} as never);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          deletedAt: null,
          renderStatus: 'READY',
          code: { in: ['ORC-000001', 'ORC-000002'] },
        },
      }),
    );
    expect(page.data.map((q) => q.issuedDocument?.id ?? null)).toEqual([
      null,
      'exec-2',
    ]);
  });

  it('o detalhe também traz o documento', async () => {
    const { repo } = repositorio([
      {
        id: 'exec-1',
        code: 'ORC-000001',
        title: 'Orçamento ORC-000001',
        renderStatus: 'READY',
      },
    ]);

    const detalhe = await repo.find('quote-id', 'org-1');

    expect(detalhe?.issuedDocument?.id).toBe('exec-1');
  });
});
