/**
 * Regras do Commercial Engine, sem banco.
 *
 * Prova decisão de domínio: o que cada estado aceita, o que congela um item, o
 * que impede enviar uma proposta vazia. **Não** prova idempotência,
 * concorrência nem isolamento — essas são garantias do banco, e um mock delas
 * provaria apenas que o mock funciona. Ver o E2E.
 */
import { ConflictException, ValidationException } from '../../exceptions';
import type { QuoteRepository } from './quote.repository';
import { QuoteService } from './quote.service';
import type { QuoteDocumentService } from '../artifact-rendering/quote-document.service';
import type { StorageProvider } from '../storage/storage.types';

const decimal = (value: string) => ({ toString: () => value });

const quote = (overrides: Record<string, unknown> = {}) => ({
  id: 'quote-id',
  number: 1,
  code: 'ORC-000001',
  status: 'DRAFT',
  title: 'Manutenção preventiva anual',
  notes: null,
  validUntil: new Date('2099-12-31T00:00:00.000Z'),
  currency: 'BRL',
  subtotal: decimal('1000.00'),
  discount: decimal('0.00'),
  total: decimal('1000.00'),
  operationId: null,
  operation: null,
  convertedAt: null,
  sentAt: null,
  decidedAt: null,
  closingReason: null,
  expiredAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  introText: null,
  customer: { id: 'customer-id', legalName: 'Cliente', tradeName: null },
  businessUnit: { id: 'unit-id', legalName: 'Matriz', tradeName: null },
  createdBy: { id: 'user-id', displayName: 'Vendedor' },
  sentBy: null,
  decidedBy: null,
  responsible: { id: 'user-id', displayName: 'Vendedor' },
  serviceAddress: null,
  assets: [],
  items: [],
  _count: { items: 1 },
  ...overrides,
});

describe('QuoteService', () => {
  const repository = {
    list: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
    findItem: jest.fn(),
    transition: jest.fn(),
    convert: jest.fn(),
    expire: jest.fn(),
    findBusinessUnit: jest.fn(),
    findCustomer: jest.fn(),
    findCatalogItem: jest.fn(),
    nextOperationCode: jest.fn(),
    findCustomerAddress: jest.fn(),
    findAssetIds: jest.fn(),
    findMember: jest.fn(),
    findOperationSource: jest.fn(),
    findOperationConsumption: jest.fn(),
  };

  /* Nenhum caminho exercitado aqui imprime documento; o stub existe para o
     construtor, não para o teste. Tipado de propósito: se a classe ganhar
     outro método, o stub para de compilar em vez de passar mudo. */
  const documents: QuoteDocumentService = { render: jest.fn() };

  /* Nem o caminho de impressão é exercitado aqui, então o armazenamento também
     é stub de construtor. `get` recusa de propósito: se algum teste passar a
     imprimir, ele falha em vez de ler um buffer inventado. */
  const storage = {
    get: jest.fn(() => Promise.reject(new Error('sem armazenamento no teste'))),
  };

  const service = new QuoteService(
    repository as unknown as QuoteRepository,
    documents,
    storage as unknown as StorageProvider,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findBusinessUnit.mockResolvedValue({ id: 'unit-id' });
    repository.findCustomer.mockResolvedValue({ id: 'customer-id' });
    repository.findCustomerAddress.mockResolvedValue({ id: 'address-id' });
    repository.findMember.mockResolvedValue({ userId: 'other-user' });
    repository.findAssetIds.mockImplementation((ids: string[]) =>
      Promise.resolve([...ids]),
    );
    repository.create.mockImplementation(() => quote());
    repository.addItem.mockImplementation(() => quote());
    repository.expire.mockResolvedValue(undefined);
    repository.transition.mockImplementation((input: { to: string }) =>
      quote({ status: input.to }),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Criação                                                           */
  /* ---------------------------------------------------------------- */

  it('recusa validade no passado — proposta não nasce vencida', async () => {
    await expect(
      service.create('org-id', 'unit-id', 'user-id', {
        customerId: 'customer-id',
        title: 'Proposta',
        validUntil: new Date('2020-01-01'),
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('recusa moeda fora das suportadas', async () => {
    await expect(
      service.create('org-id', 'unit-id', 'user-id', {
        customerId: 'customer-id',
        title: 'Proposta',
        currency: 'XYZ',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('exige unidade de negócio', async () => {
    await expect(
      service.create('org-id', null, 'user-id', {
        customerId: 'customer-id',
        title: 'Proposta',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  /* ---------------------------------------------------------------- */
  /* Itens e snapshot                                                  */
  /* ---------------------------------------------------------------- */

  it('congela descrição, SKU, unidade e preço do Catálogo', async () => {
    repository.find.mockResolvedValue(quote());
    repository.findCatalogItem.mockResolvedValue({
      id: 'product-id',
      kind: 'PART',
      name: 'Filtro G4 620x620',
      sku: 'FLT-620',
      unit: 'UN',
      salePrice: decimal('89.90'),
      status: 'ACTIVE',
    });
    repository.addItem.mockResolvedValue(quote());

    await service.addItem('quote-id', 'org-id', 'user-id', {
      catalogItemId: 'product-id',
      quantity: 4,
    });

    const [, , , , snapshot] = repository.addItem.mock.calls[0] as [
      string,
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(snapshot).toMatchObject({
      catalogItemId: 'product-id',
      kind: 'PART',
      description: 'Filtro G4 620x620',
      sku: 'FLT-620',
      unit: 'UN',
      quantity: '4.000',
      unitPrice: '89.90',
    });
  });

  it('o preço informado sobrepõe o do Catálogo — negociar é o que se faz', async () => {
    repository.find.mockResolvedValue(quote());
    repository.findCatalogItem.mockResolvedValue({
      id: 'product-id',
      kind: 'SERVICE',
      name: 'Limpeza de evaporadora',
      sku: null,
      unit: 'H',
      salePrice: decimal('120.00'),
      status: 'ACTIVE',
    });
    repository.addItem.mockResolvedValue(quote());

    await service.addItem('quote-id', 'org-id', 'user-id', {
      catalogItemId: 'product-id',
      quantity: 2.5,
      unitPrice: 99,
    });

    const [, , , , snapshot] = repository.addItem.mock.calls[0] as [
      string,
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(snapshot.unitPrice).toBe('99.00');
    expect(snapshot.quantity).toBe('2.500');
  });

  it('recusa item de catálogo indisponível', async () => {
    repository.find.mockResolvedValue(quote());
    repository.findCatalogItem.mockResolvedValue({
      id: 'product-id',
      kind: 'PRODUCT',
      name: 'Descontinuado',
      sku: null,
      unit: 'UN',
      salePrice: decimal('10.00'),
      status: 'INACTIVE',
    });

    await expect(
      service.addItem('quote-id', 'org-id', 'user-id', {
        catalogItemId: 'product-id',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('item livre exige descrição e preço', async () => {
    repository.find.mockResolvedValue(quote());
    await expect(
      service.addItem('quote-id', 'org-id', 'user-id', { quantity: 1 }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('não aceita item em orçamento já enviado', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    await expect(
      service.addItem('quote-id', 'org-id', 'user-id', {
        description: 'Serviço',
        unitPrice: 10,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ---------------------------------------------------------------- */
  /* Máquina de estados                                                */
  /* ---------------------------------------------------------------- */

  it('não envia orçamento sem itens', async () => {
    repository.find.mockResolvedValue(quote({ _count: { items: 0 } }));
    await expect(
      service.send('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não envia orçamento de valor zero', async () => {
    repository.find.mockResolvedValue(quote({ total: decimal('0.00') }));
    await expect(
      service.send('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não envia orçamento sem validade', async () => {
    repository.find.mockResolvedValue(quote({ validUntil: null }));
    await expect(
      service.send('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('envia rascunho completo, registrando o autor', async () => {
    repository.find.mockResolvedValue(quote());
    await service.send('quote-id', 'org-id', 'user-id');

    const [input] = repository.transition.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(input.to).toBe('SENT');
    expect(input.from).toEqual(['DRAFT']);
    expect((input.data as Record<string, unknown>).sentById).toBe('user-id');
    /** Enviar não é evento financeiro: nada foi decidido ainda. */
    expect(input.event).toBeUndefined();
  });

  it('aprova apenas o que foi enviado', async () => {
    repository.find.mockResolvedValue(quote({ status: 'DRAFT' }));
    await expect(
      service.approve('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('aprovação dispara o evento financeiro', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    await service.approve('quote-id', 'org-id', 'user-id');

    const [input] = repository.transition.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(input.to).toBe('APPROVED');
    expect(input.event).toBe(true);
  });

  it('expira antes de decidir qualquer transição', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    await service.approve('quote-id', 'org-id', 'user-id');
    expect(repository.expire).toHaveBeenCalledWith('org-id');
  });

  it('não aprova orçamento expirado', async () => {
    repository.find.mockResolvedValue(quote({ status: 'EXPIRED' }));
    await expect(
      service.approve('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancela também depois de aprovado, disparando o evento', async () => {
    repository.find.mockResolvedValue(quote({ status: 'APPROVED' }));
    await service.cancel('quote-id', 'org-id', 'user-id', {
      reason: 'Cliente desistiu',
    });

    const [input] = repository.transition.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(input.to).toBe('CANCELLED');
    expect(input.event).toBe(true);
    expect((input.data as Record<string, unknown>).closingReason).toBe(
      'Cliente desistiu',
    );
  });

  it('não cancela o que já é terminal', async () => {
    repository.find.mockResolvedValue(quote({ status: 'REJECTED' }));
    await expect(
      service.cancel('quote-id', 'org-id', 'user-id', { reason: 'tarde' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa a transição quando outra requisição já mudou o estado', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    repository.transition.mockResolvedValue(null);
    await expect(
      service.approve('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ---------------------------------------------------------------- */
  /* Edição                                                            */
  /* ---------------------------------------------------------------- */

  it('recusa desconto maior que o subtotal', async () => {
    repository.find.mockResolvedValue(quote());
    await expect(
      service.update('quote-id', 'org-id', 'user-id', { discount: 2000 }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('não edita orçamento enviado', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    await expect(
      service.update('quote-id', 'org-id', 'user-id', { title: 'Outro' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não apaga orçamento enviado — cancela', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    await expect(
      service.remove('quote-id', 'org-id', 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ---------------------------------------------------------------- */
  /* Conversão                                                         */
  /* ---------------------------------------------------------------- */

  it('converte apenas orçamento aprovado', async () => {
    repository.find.mockResolvedValue(quote({ status: 'SENT' }));
    await expect(
      service.convert('quote-id', 'org-id', 'user-id', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('já convertido devolve o mesmo, sem criar nada', async () => {
    const converted = quote({
      status: 'APPROVED',
      operationId: 'operation-id',
      operation: { id: 'operation-id', code: 'OS-1', title: 'Serviço' },
    });
    repository.find.mockResolvedValue(converted);

    const result = await service.convert('quote-id', 'org-id', 'user-id', {});
    expect(repository.convert).not.toHaveBeenCalled();
    expect(result.operationId).toBe('operation-id');
  });

  it('deriva o código da operação do código do orçamento', async () => {
    repository.find.mockResolvedValue(quote({ status: 'APPROVED' }));
    repository.nextOperationCode.mockResolvedValue('OS-ORC-000001');
    repository.convert.mockResolvedValue(quote({ status: 'APPROVED' }));

    await service.convert('quote-id', 'org-id', 'user-id', {});

    const [input] = repository.convert.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(input.code).toBe('OS-ORC-000001');
    expect(input.kind).toBe('MAINTENANCE');
    expect(input.customerId).toBe('customer-id');
  });

  it('recusa agendamento invertido na conversão', async () => {
    repository.find.mockResolvedValue(quote({ status: 'APPROVED' }));
    await expect(
      service.convert('quote-id', 'org-id', 'user-id', {
        scheduledStart: new Date('2026-09-10T10:00:00Z'),
        scheduledEnd: new Date('2026-09-10T08:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('quem perde a corrida da conversão recebe o resultado existente', async () => {
    repository.find.mockResolvedValue(quote({ status: 'APPROVED' }));
    repository.nextOperationCode.mockResolvedValue('OS-ORC-000001');
    /** `null` = outra transação ocupou `operationId` primeiro. */
    repository.convert.mockResolvedValue(null);

    const result = await service.convert('quote-id', 'org-id', 'user-id', {});
    expect(result).toBeDefined();
    expect(repository.find).toHaveBeenCalledTimes(2);
  });

  /* ---------------------------------------------------------------- */
  /* Consulta                                                          */
  /* ---------------------------------------------------------------- */

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
  /* Escopo: endereço, equipamentos e responsável                      */
  /* ---------------------------------------------------------------- */

  const novaProposta = {
    customerId: 'customer-id',
    title: 'Manutenção preventiva anual',
  };

  it('recusa endereço que não é do cliente da proposta', async () => {
    /* O `where` do repositório cruza `customerId`; nulo aqui é um endereço de
       outro cliente do mesmo inquilino — que passaria por uma checagem só de
       organização e sairia impresso na proposta de terceiro. */
    repository.findCustomerAddress.mockResolvedValue(null);

    await expect(
      service.create('org-id', 'unit-id', 'user-id', {
        ...novaProposta,
        serviceAddressId: 'address-de-outro-cliente',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('confere o endereço contra o cliente, não só contra a organização', async () => {
    await service.create('org-id', 'unit-id', 'user-id', {
      ...novaProposta,
      serviceAddressId: 'address-id',
    });

    expect(repository.findCustomerAddress).toHaveBeenCalledWith(
      'address-id',
      'org-id',
      'customer-id',
    );
  });

  it('diz qual equipamento não existe, em vez de "algum é inválido"', async () => {
    repository.findAssetIds.mockResolvedValue(['asset-1']);

    await expect(
      service.create('org-id', 'unit-id', 'user-id', {
        ...novaProposta,
        assetIds: ['asset-1', 'asset-fantasma'],
      }),
    ).rejects.toThrow(/asset-fantasma/);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('não conta o mesmo equipamento duas vezes', async () => {
    await service.create('org-id', 'unit-id', 'user-id', {
      ...novaProposta,
      assetIds: ['asset-1', 'asset-1'],
    });

    expect(repository.findAssetIds).toHaveBeenCalledWith(['asset-1'], 'org-id');
  });

  it('recusa responsável que não é membro da organização', async () => {
    repository.findMember.mockResolvedValue(null);

    await expect(
      service.create('org-id', 'unit-id', 'user-id', {
        ...novaProposta,
        responsibleUserId: 'user-de-outro-inquilino',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('quem cria assina, quando ninguém disse outro', async () => {
    await service.create('org-id', 'unit-id', 'user-id', novaProposta);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleUserId: 'user-id' }),
    );
  });

  it('o responsável informado vence quem digitou', async () => {
    await service.create('org-id', 'unit-id', 'user-id', {
      ...novaProposta,
      responsibleUserId: 'outro-user',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleUserId: 'outro-user' }),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Origem: cópia de atendimento concluído                            */
  /* ---------------------------------------------------------------- */

  const atendimento = (overrides: Record<string, unknown> = {}) => ({
    id: 'operation-id',
    code: 'OS-000010',
    title: 'Manutenção corretiva',
    description: 'Troca de compressor',
    status: 'COMPLETED',
    businessUnitId: 'unit-id',
    customerId: 'customer-id',
    customerAddressId: 'address-id',
    completedAt: new Date('2026-09-01T12:00:00.000Z'),
    assets: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
    ...overrides,
  });

  it('copia cliente, endereço e equipamentos do atendimento', async () => {
    repository.findOperationSource.mockResolvedValue(atendimento());
    repository.findOperationConsumption.mockResolvedValue([]);

    await service.createFromOperation('org-id', 'unit-id', 'user-id', {
      operationId: 'operation-id',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-id',
        serviceAddressId: 'address-id',
        assetIds: ['asset-1', 'asset-2'],
      }),
    );
  });

  it('recusa copiar de atendimento que não está concluído', async () => {
    /* Escopo de atendimento em andamento ainda vai mudar; copiá-lo produziria
       uma proposta sobre algo que o técnico nem terminou. */
    for (const status of ['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'CANCELLED']) {
      repository.findOperationSource.mockResolvedValue(atendimento({ status }));
      await expect(
        service.createFromOperation('org-id', 'unit-id', 'user-id', {
          operationId: 'operation-id',
        }),
      ).rejects.toBeInstanceOf(ValidationException);
    }
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('recusa atendimento sem cliente — proposta precisa de destinatário', async () => {
    repository.findOperationSource.mockResolvedValue(
      atendimento({ customerId: null }),
    );

    await expect(
      service.createFromOperation('org-id', 'unit-id', 'user-id', {
        operationId: 'operation-id',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('traz os materiais consumidos como itens, com preço do Catálogo', async () => {
    repository.findOperationSource.mockResolvedValue(atendimento());
    repository.findOperationConsumption.mockResolvedValue([
      { catalogItemId: 'produto-1', quantity: '3.000' },
    ]);
    repository.findCatalogItem.mockResolvedValue({
      id: 'produto-1',
      kind: 'PRODUCT',
      name: 'Gás R-410A',
      sku: 'GAS-410',
      unit: 'KG',
      salePrice: decimal('120.00'),
      status: 'ACTIVE',
    });

    await service.createFromOperation('org-id', 'unit-id', 'user-id', {
      operationId: 'operation-id',
    });

    /* O preço vem do Catálogo, e não do movimento de estoque: o movimento
       registra custo, e uma proposta cobra preço de venda. */
    expect(repository.addItem).toHaveBeenCalledWith(
      'quote-id',
      'org-id',
      'unit-id',
      'user-id',
      expect.objectContaining({
        catalogItemId: 'produto-1',
        quantity: '3.000',
        unitPrice: '120.00',
      }),
    );
  });

  it('pula material cujo item saiu do Catálogo, em vez de perder a proposta', async () => {
    repository.findOperationSource.mockResolvedValue(atendimento());
    repository.findOperationConsumption.mockResolvedValue([
      { catalogItemId: 'produto-vivo', quantity: '1.000' },
      { catalogItemId: 'produto-morto', quantity: '2.000' },
    ]);
    repository.findCatalogItem.mockImplementation((id: string) =>
      id === 'produto-vivo'
        ? Promise.resolve({
            id,
            kind: 'PRODUCT',
            name: 'Filtro',
            sku: 'FLT',
            unit: 'UN',
            salePrice: decimal('50.00'),
            status: 'ACTIVE',
          })
        : Promise.resolve({
            id,
            kind: 'PRODUCT',
            name: 'Descontinuado',
            sku: null,
            unit: 'UN',
            salePrice: decimal('10.00'),
            status: 'ARCHIVED',
          }),
    );

    const resultado = await service.createFromOperation(
      'org-id',
      'unit-id',
      'user-id',
      { operationId: 'operation-id' },
    );

    /* A proposta existe, com o material que ainda é oferecido. Derrubar a
       criação inteira obrigaria a pessoa a recomeçar sem saber qual item era. */
    expect(resultado).toBeDefined();
    expect(repository.addItem).toHaveBeenCalledTimes(1);
    expect(repository.addItem).toHaveBeenCalledWith(
      'quote-id',
      'org-id',
      'unit-id',
      'user-id',
      expect.objectContaining({ catalogItemId: 'produto-vivo' }),
    );
  });
});
