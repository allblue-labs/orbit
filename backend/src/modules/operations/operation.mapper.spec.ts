import { OperationReadModelMapper } from './operation.mapper';

describe('OperationReadModelMapper', () => {
  it('publishes operation details without attachment storage keys', () => {
    const mapper = new OperationReadModelMapper();
    const attachment = {
      id: 'file-1',
      operationId: 'op-1',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      size: 10,
      checksum: 'hash',
      uploadedById: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      storageKey: '/private/file',
    };
    const result = mapper.details({
      id: 'op-1',
      organizationId: 'org-1',
      businessUnitId: 'unit-1',
      customerId: null,
      customerAddressId: null,
      sector: null,
      amountVisibleInField: false,
      code: 'ORB-1',
      serviceOrderNumber: 87,
      kind: 'MAINTENANCE',
      title: 'Preventiva',
      description: null,
      status: 'OPEN',
      priority: 'NORMAL',
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      location: {},
      data: {},
      createdById: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      businessUnit: { id: 'unit-1', legalName: 'Orbit', tradeName: null },
      customer: null,
      customerAddress: null,
      assets: [],
      users: [],
      checklistExecutions: [],
      attachments: [attachment],
    });

    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.transitions).toEqual([
      'SCHEDULED',
      'IN_PROGRESS',
      'CANCELLED',
    ]);
    expect(result.attachments[0]).not.toHaveProperty('storageKey');
  });

  /**
   * O número da OS sai formatado do servidor.
   *
   * Duas telas e um PDF mostram o mesmo número. Se cada um preenchesse os zeros,
   * a OS 87 apareceria como `OS-000087` no documento, `OS-87` na web e `87` no
   * celular — e o cliente que liga citando um deles não seria encontrado pelo
   * outro.
   */
  it('publica o número da OS pronto para ler, além do inteiro', () => {
    const mapper = new OperationReadModelMapper();

    const result = mapper.details(fonte({ serviceOrderNumber: 87 }));

    expect(result.serviceOrderNumber).toBe(87);
    expect(result.serviceOrderCode).toBe('OS-000087');
  });

  /**
   * Operação que não é ordem de serviço não ganha número inventado.
   *
   * PMOC e RVT criam operação, e a contagem delas é outra. Um `0` ou um
   * `OS-000000` aqui viraria um documento com número falso.
   */
  it('operação sem número de OS não publica código', () => {
    const mapper = new OperationReadModelMapper();

    const result = mapper.details(fonte({ serviceOrderNumber: null }));

    expect(result.serviceOrderNumber).toBeNull();
    expect(result.serviceOrderCode).toBeNull();
  });
});

/** A operação mínima que o mapeador aceita, com o que o teste quer variar. */
function fonte(overrides: { serviceOrderNumber: number | null }) {
  return {
    id: 'op-1',
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    customerId: null,
    customerAddressId: null,
    sector: null,
    amountVisibleInField: false,
    code: 'ORB-1',
    kind: 'MAINTENANCE',
    title: 'Preventiva',
    description: null,
    status: 'OPEN',
    priority: 'NORMAL',
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    location: {},
    data: {},
    createdById: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    businessUnit: { id: 'unit-1', legalName: 'Orbit', tradeName: null },
    customer: null,
    customerAddress: null,
    assets: [],
    users: [],
    checklistExecutions: [],
    attachments: [],
    ...overrides,
  };
}
