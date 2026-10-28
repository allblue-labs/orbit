import { Prisma } from '@prisma/client';
import { PublicErrorMapper } from '../../common/public-errors/public-error.mapper';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import { MobileWalkInRepository } from './mobile-walk-in.repository';
import { MobileWalkInService } from './mobile-walk-in.service';

const org = generateUuidV7(),
  unit = generateUuidV7(),
  actorId = generateUuidV7();
const actor = {
  id: actorId,
  organizationId: org,
  businessUnitIds: [unit],
  permissions: ['operations.walk_in.create'],
};
const command = {
  customer: { legalName: 'Cliente novo', documentNumber: '19.131.243/0001-97' },
  equipment: [{ name: 'Split' }],
};

type Row = Record<string, unknown>;
interface State {
  customers: Row[];
  assets: Row[];
  operations: Row[];
  receipts: Row[];
}
function setup(seed: Partial<State> = {}) {
  let committed: State = {
    customers: [],
    assets: [],
    operations: [],
    receipts: [],
    ...seed,
  };
  const createOperation = jest.fn((tx: { state: State }, data: Row) => {
    if (tx.state.operations.some((row) => row.code === data.code))
      return Promise.reject(new Error('Duplicated operation code'));
    const row = { ...data, id: generateUuidV7() };
    tx.state.operations.push(row);
    return Promise.resolve(row);
  });
  const customerQueries: Row[] = [];
  const transactions = jest.fn(
    async (work: (tx: unknown) => Promise<unknown>) => {
      const state = structuredClone(committed);
      const tx = {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ settings: null }),
        },
        state,
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(0),
        operationWalkInCommand: {
          findUnique: () => Promise.resolve(null),
          create: ({ data }: { data: Row }) => {
            state.receipts.push(data);
            return Promise.resolve(data);
          },
        },
        businessUnit: { findFirst: () => Promise.resolve({ id: unit }) },
        customer: {
          findFirst: ({ where }: { where: Row }) => {
            customerQueries.push(where);
            return Promise.resolve(
              state.customers.find((row) =>
                Object.entries(where).every(
                  ([key, value]) => row[key] === value,
                ),
              ) ?? null,
            );
          },
          create: ({ data }: { data: Row }) => {
            const row = { ...data, id: generateUuidV7(), deletedAt: null };
            state.customers.push(row);
            return Promise.resolve(row);
          },
        },
        asset: {
          findFirst: ({
            where,
          }: {
            where: { organizationId: string; OR: Row[] };
          }) =>
            Promise.resolve(
              state.assets.find(
                (row) =>
                  row.organizationId === where.organizationId &&
                  row.deletedAt == null &&
                  where.OR.some((term) =>
                    Object.entries(term).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ),
              ) ?? null,
            ),
          create: ({ data }: { data: Row }) => {
            const row = { ...data, id: generateUuidV7(), deletedAt: null };
            state.assets.push(row);
            return Promise.resolve(row);
          },
        },
        auditLog: { create: () => Promise.resolve({}) },
      };
      const result = await work(tx);
      committed = state;
      return result;
    },
  );
  const rls = new RlsTransaction(
    { $transaction: transactions } as never,
    { get: () => ({}) } as never,
  );
  const repo = new MobileWalkInRepository(rls, {
    createWithin: createOperation,
  } as never);
  return {
    service: new MobileWalkInService(repo),
    state: () => committed,
    customerQueries,
  };
}

describe('conflitos do atendimento avulso', () => {
  it('abre cliente e equipamento mínimos, atomicamente, sem exigir dados opcionais', async () => {
    const env = setup();
    await env.service.create(actor, 'walkin-minimal', {
      customer: { legalName: 'Cliente sem documento' },
      equipment: [{ name: 'Split' }],
    });
    expect(env.state().customers).toHaveLength(1);
    expect(env.state().assets).toHaveLength(1);
    expect(env.state().operations).toHaveLength(1);
    expect(env.state().receipts).toHaveLength(1);
  });

  it('explica documento já cadastrado antes de criar qualquer registro', async () => {
    const env = setup({
      customers: [
        {
          id: generateUuidV7(),
          organizationId: org,
          documentType: 'CNPJ',
          documentNumber: '19131243000197',
          deletedAt: null,
        },
      ],
    });
    await expect(
      env.service.create(actor, 'walkin-conflict', command),
    ).rejects.toMatchObject({ code: 'WALK_IN_CUSTOMER_DOCUMENT_EXISTS' });
    expect(env.state().customers).toHaveLength(1);
    expect(env.state().assets).toHaveLength(0);
    expect(env.state().operations).toHaveLength(0);
    expect(env.customerQueries[0]).toMatchObject({
      organizationId: org,
      documentType: 'CNPJ',
      documentNumber: '19131243000197',
      deletedAt: null,
    });
  });

  it('não consulta nem reaproveita cliente de outro tenant com o mesmo documento', async () => {
    const env = setup({
      customers: [
        {
          organizationId: generateUuidV7(),
          documentType: 'CNPJ',
          documentNumber: '19131243000197',
          deletedAt: null,
        },
      ],
    });
    await env.service.create(actor, 'walkin-other-tenant', command);
    expect(env.state().customers).toHaveLength(2);
  });

  it.each([
    ['serialNumber', 'WALK_IN_ASSET_SERIAL_EXISTS'],
    ['identifier', 'WALK_IN_ASSET_IDENTIFIER_EXISTS'],
  ])(
    'equipamentos repetidos por %s desfazem cliente, equipamentos e ordem',
    async (field, code) => {
      const env = setup();
      await expect(
        env.service.create(actor, 'walkin-duplicates', {
          ...command,
          equipment: [
            { name: 'Split 1', [field]: 'ABC-1' },
            { name: 'Split 2', [field]: 'ABC-1' },
          ],
        }),
      ).rejects.toMatchObject({ code });
      expect(env.state()).toEqual({
        customers: [],
        assets: [],
        operations: [],
        receipts: [],
      });
    },
  );

  it('duas aberturas no mesmo milissegundo recebem códigos diferentes', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_793_120_000_000);
    try {
      const env = setup();
      for (const key of ['walkin-first', 'walkin-second'])
        await env.service.create(actor, key, {
          customer: { legalName: 'Cliente' },
        });
      expect(new Set(env.state().operations.map((row) => row.code)).size).toBe(
        2,
      );
    } finally {
      now.mockRestore();
    }
  });

  it.each([
    [
      { target: ['organization_id', 'document_number'] },
      'WALK_IN_CUSTOMER_DOCUMENT_EXISTS',
    ],
    [
      { target: 'assets_identifier_unique_active' },
      'WALK_IN_ASSET_IDENTIFIER_EXISTS',
    ],
    [
      {
        driverAdapterError: {
          cause: { constraint: { fields: ['serial_number'] } },
        },
      },
      'WALK_IN_ASSET_SERIAL_EXISTS',
    ],
    [{ target: ['unknown_key'] }, 'WALK_IN_CONFLICT'],
  ])(
    'traduz conflito concorrente do Prisma em 409 público: %j',
    async (meta, code) => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Internal SQL secret',
        { code: 'P2002', clientVersion: 'test', meta },
      );
      const repo = { create: jest.fn().mockRejectedValue(error) };
      const service = new MobileWalkInService(repo as never);
      try {
        await service.create(actor, 'walkin-race', {
          ...command,
          businessUnitId: unit,
        });
        throw new Error('Expected conflict');
      } catch (caught) {
        const result = new PublicErrorMapper().map(caught);
        expect(result).toMatchObject({ code, status: 409 });
        expect(JSON.stringify(result)).not.toMatch(/SQL|Prisma|P2002|secret/);
        expect(result.message).toMatch(/CPF|identificador|série/);
      }
    },
  );
});
