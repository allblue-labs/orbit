import { CustomerRepository } from './customer.repository';
import { CustomerStatus } from '../../../../contracts';
import type { Prisma } from '@prisma/client';

describe('customer search', () => {
  const findMany = jest
    .fn<Promise<unknown[]>, [Prisma.CustomerFindManyArgs]>()
    .mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const transaction = { customer: { findMany, count } };
  const repository = new CustomerRepository({
    run: (work: (tx: typeof transaction) => unknown) => work(transaction),
  } as never);
  beforeEach(() => jest.clearAllMocks());

  it.each(['Zênite Serviços', 'Empresa 24', '  Maria Silva  '])(
    'does not match unrelated documents when searching a name: %s',
    async (search) => {
      await repository.list('org-a', { search, page: 1, limit: 20 });
      const where = {
        organizationId: 'org-a',
        deletedAt: null,
        OR: [
          { legalName: { contains: search.trim(), mode: 'insensitive' } },
          { tradeName: { contains: search.trim(), mode: 'insensitive' } },
          { email: { contains: search.trim(), mode: 'insensitive' } },
          { phone: { contains: search.trim() } },
        ],
      };
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect(count).toHaveBeenCalledWith({ where });
    },
  );

  it.each([
    ['11.222.333/0001-81', '11222333000181'],
    ['11222333000181', '11222333000181'],
    ['529.982.247-25', '52998224725'],
    ['52998224725', '52998224725'],
  ])(
    'searches formatted or unformatted CPF/CNPJ: %s',
    async (search, document) => {
      await repository.list('org-a', { search, page: 1, limit: 20 });
      const where = findMany.mock.calls[0][0].where;
      expect(where?.organizationId).toBe('org-a');
      expect(where?.deletedAt).toBeNull();
      expect(where?.OR).toContainEqual({
        documentNumber: { contains: document },
      });
    },
  );

  it('keeps blank searches unfiltered and preserves tenant, status and pagination', async () => {
    await repository.list('org-b', {
      search: '   ',
      page: 6,
      limit: 20,
      status: CustomerStatus.ACTIVE,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-b', deletedAt: null, status: 'ACTIVE' },
        skip: 100,
        take: 20,
        orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});
