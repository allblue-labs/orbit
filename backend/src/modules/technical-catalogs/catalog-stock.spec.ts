import { ValidationPipe } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { AuthenticatedIdentity } from '../identity/domain/identity.types';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { CreateProductDto, UpdateProductDto } from './catalog.dto';

const org = generateUuidV7();
const unit = generateUuidV7();
const otherUnit = generateUuidV7();
const actor: AuthenticatedIdentity = {
  id: generateUuidV7(),
  sessionId: generateUuidV7(),
  organizationId: org,
  businessUnitId: unit,
  businessUnitIds: [unit],
  roles: ['ADMINISTRATOR'],
  permissions: ['catalog.products.create', 'inventory.manage'],
  allowedSurfaces: ['WEB'],
  isOrganizationOwner: false,
};

interface State {
  products: Record<string, unknown>[];
  movements: Record<string, unknown>[];
}

function setup() {
  let committed: State = { products: [], movements: [] };
  let failMovement = false;
  const transactions = jest.fn(
    async (work: (tx: unknown) => Promise<unknown>) => {
      const state = structuredClone(committed);
      const tx = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        product: {
          create: ({ data }: { data: Record<string, unknown> }) => {
            const product = { id: generateUuidV7(), ...data };
            state.products.push(product);
            return Promise.resolve({ ...product, inventoryBalances: [] });
          },
          findFirst: ({ where }: { where: { id: string } }) => {
            const product = state.products.find((item) => item.id === where.id);
            return Promise.resolve(
              product
                ? {
                    ...product,
                    inventoryBalances: state.movements
                      .filter((m) => m.catalogItemId === product.id)
                      .map((m) => ({
                        businessUnitId: m.businessUnitId,
                        onHand: m.quantity,
                        reserved: 0,
                      })),
                  }
                : null,
            );
          },
        },
        businessUnit: { findFirst: () => Promise.resolve({ id: unit }) },
        inventoryMovement: {
          create: ({ data }: { data: Record<string, unknown> }) => {
            state.movements.push(data);
            if (failMovement)
              return Promise.reject(new Error('Falha ao gravar movimento'));
            return Promise.resolve(data);
          },
        },
      };
      const result = await work(tx);
      committed = state;
      return result;
    },
  );
  // Real ambient transaction orchestration; nested repository calls must
  // participate in the same transaction instead of committing half the work.
  const rls = new RlsTransaction(
    { $transaction: transactions } as never,
    { get: () => ({}) } as never,
  );
  const repository = new CatalogRepository(rls);
  const entry = jest.fn(
    async (
      _org: string,
      _fallback: string,
      userId: string,
      input: Record<string, unknown>,
    ) =>
      rls.run((tx) =>
        tx.inventoryMovement.create({
          data: { ...input, createdById: userId },
        } as never),
      ),
  );
  const plans = { assertCapabilities: jest.fn().mockResolvedValue(undefined) };
  const service = new CatalogService(
    repository,
    { entry } as never,
    rls,
    plans as never,
  );
  return {
    service,
    entry,
    transactions,
    plans,
    state: () => committed,
    fail: () => {
      failMovement = true;
    },
  };
}

describe('Estoque inicial no cadastro do catálogo', () => {
  const input = { name: 'Compressor', kind: 'PRODUCT' as const, sku: 'COMP-1' };

  it.each([undefined, 0])(
    'quantidade %s cadastra sem inventar saldo',
    async (initialStock) => {
      const env = setup();
      const item = await env.service.createProduct(
        org,
        { ...input, initialStock },
        actor,
      );
      expect(item.stockAvailable).toBe(false);
      expect(env.state().products).toHaveLength(1);
      expect(env.state().movements).toHaveLength(0);
      expect(env.entry).not.toHaveBeenCalled();
    },
  );

  it('cria produto e entrada fracionada na mesma transação, com unidade e autor', async () => {
    const env = setup();
    const item = await env.service.createProduct(
      org,
      { ...input, initialStock: 2.375 },
      actor,
    );
    expect(item.stockAvailable).toBe(true);
    expect(item).not.toHaveProperty('inventoryBalances');
    expect(env.transactions).toHaveBeenCalledTimes(1);
    expect(env.state().movements).toEqual([
      expect.objectContaining({
        catalogItemId: item.id,
        sourceEntityId: item.id,
        quantity: 2.375,
        businessUnitId: unit,
        createdById: actor.id,
        reason: 'Estoque inicial do cadastro',
      }),
    ]);
    expect(env.plans.assertCapabilities).toHaveBeenCalledWith(org, [
      'inventory.manage',
    ]);
  });

  it('uma falha na entrada desfaz também o cadastro, permitindo uma nova tentativa', async () => {
    const env = setup();
    env.fail();
    await expect(
      env.service.createProduct(org, { ...input, initialStock: 3 }, actor),
    ).rejects.toThrow('Falha ao gravar movimento');
    expect(env.state()).toEqual({ products: [], movements: [] });
  });

  it('serviços não recebem estoque inicial', async () => {
    const env = setup();
    await expect(
      env.service.createProduct(
        org,
        { ...input, kind: 'SERVICE', initialStock: 2 },
        actor,
      ),
    ).rejects.toThrow('Serviços não possuem estoque');
    const item = await env.service.createProduct(
      org,
      { ...input, kind: 'SERVICE' },
      actor,
    );
    expect(item.stockAvailable).toBeNull();
  });

  it('não concede gestão de estoque junto com a permissão de criar produtos', async () => {
    const env = setup();
    await expect(
      env.service.createProduct(
        org,
        { ...input, initialStock: 2 },
        { ...actor, permissions: ['catalog.products.create'] },
      ),
    ).rejects.toThrow('Você não possui permissão');
    expect(env.state().products).toHaveLength(0);
  });

  it('recusa plano sem estoque e unidade fora do acesso antes de gravar', async () => {
    const env = setup();
    await expect(
      env.service.createProduct(
        org,
        { ...input, initialStock: 2, initialStockBusinessUnitId: otherUnit },
        actor,
      ),
    ).rejects.toThrow('fora do seu acesso');
    env.plans.assertCapabilities.mockRejectedValueOnce(
      new Error('Plano sem estoque'),
    );
    await expect(
      env.service.createProduct(org, { ...input, initialStock: 2 }, actor),
    ).rejects.toThrow('Plano sem estoque');
    expect(env.state().products).toHaveLength(0);
  });

  it.each([-1, 1.1234, 10_000_000])(
    'valida a quantidade %s na fronteira HTTP',
    async (initialStock) => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      await expect(
        pipe.transform(
          { ...input, initialStock },
          { type: 'body', metatype: CreateProductDto },
        ),
      ).rejects.toThrow();
    },
  );

  it('não permite aplicar estoque inicial novamente pela edição do produto', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { initialStock: 2 },
        { type: 'body', metatype: UpdateProductDto },
      ),
    ).rejects.toThrow();
  });
});

describe('Leitura do catálogo com disponibilidade real', () => {
  it('considera reservas e a unidade consultada sem publicar os saldos brutos', async () => {
    const products = [
      { id: 'empty', kind: 'PRODUCT', inventoryBalances: [] },
      {
        id: 'reserved',
        kind: 'PRODUCT',
        inventoryBalances: [
          { businessUnitId: unit, onHand: '5', reserved: '5' },
        ],
      },
      {
        id: 'other-unit',
        kind: 'PART',
        inventoryBalances: [
          { businessUnitId: otherUnit, onHand: '5', reserved: '0' },
        ],
      },
      {
        id: 'in-stock',
        kind: 'PRODUCT',
        inventoryBalances: [
          { businessUnitId: unit, onHand: '5', reserved: '1' },
        ],
      },
      { id: 'service', kind: 'SERVICE', inventoryBalances: [] },
    ];
    const repository = {
      listProducts: jest
        .fn()
        .mockResolvedValue({ data: products, meta: { total: 5 } }),
    };
    const service = new CatalogService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.listProducts(org, {
      businessUnitId: unit,
      page: 1,
      limit: 20,
    });
    expect(result.data.map((item) => item.stockAvailable)).toEqual([
      false,
      false,
      false,
      true,
      null,
    ]);
    expect(result.data.every((item) => !('inventoryBalances' in item))).toBe(
      true,
    );
  });

  it.each(['PRODUCT', 'SERVICE'] as const)(
    'o filtro %s mantém itens globais junto aos da unidade e à busca',
    async (kind) => {
      const tx = {
        product: {
          findMany: jest
            .fn<Promise<unknown[]>, [unknown]>()
            .mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      };
      const repository = new CatalogRepository({
        run: (work: (client: typeof tx) => unknown) => work(tx),
      } as never);
      await repository.listProducts(org, {
        kind,
        businessUnitId: unit,
        search: 'Filtro',
        page: 1,
        limit: 20,
      });
      const args = tx.product.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toMatchObject({
        organizationId: org,
        kind,
        deletedAt: null,
      });
      expect(args.where.AND).toEqual([
        { OR: [{ businessUnitId: null }, { businessUnitId: unit }] },
        {
          OR: [
            { name: { contains: 'Filtro', mode: 'insensitive' } },
            { sku: { contains: 'Filtro', mode: 'insensitive' } },
            { description: { contains: 'Filtro', mode: 'insensitive' } },
          ],
        },
      ]);
      expect(tx.product.count).toHaveBeenCalledWith({ where: args.where });
    },
  );
});
