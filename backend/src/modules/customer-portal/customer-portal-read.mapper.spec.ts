import { CustomerPortalReadMapper } from './customer-portal-read.mapper';
import type {
  CustomerPortalAssetRecord,
  CustomerPortalOperationRecord,
} from './customer-portal-read.repository';

describe('CustomerPortalReadMapper', () => {
  const mapper = new CustomerPortalReadMapper();
  const unit = {
    id: 'unit-id',
    legalName: 'Unidade Recife',
    tradeName: 'Orbit Recife',
    timezone: 'America/Recife',
  };

  it('maps an operation to a stable customer vocabulary without internals', () => {
    const value = {
      id: 'operation-id',
      organizationId: 'organization-id',
      customerId: 'customer-id',
      code: 'OS-001',
      kind: 'SERVICE_ORDER',
      title: 'Manutenção preventiva',
      description: 'internal detail not part of list',
      status: 'IN_PROGRESS',
      scheduledStart: new Date('2026-09-04T12:00:00.000Z'),
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      location: { street: 'Rua Azul', city: 'Recife', internalNote: 'secret' },
      businessUnit: unit,
      assets: [{ asset: { id: 'asset-id', name: 'Ar-condicionado' } }],
      responsibleFieldTechnician: { displayName: 'Técnico Orbit' },
      _count: { artifactExecutions: 1 },
    } satisfies CustomerPortalOperationRecord;

    const result = mapper.operation(value);
    expect(result.status).toEqual({
      code: 'inProgress',
      label: 'Em andamento',
    });
    expect(result.type).toBe('Ordem de serviço');
    expect(result.documentAvailable).toBe(true);
    expect(result.location).toBe('Rua Azul, Recife');
    expect(JSON.stringify(result)).not.toMatch(
      /organizationId|customerId|internalNote|cost|margin|capabilit|role/i,
    );
  });

  it('publishes only the explicitly selected asset fields', () => {
    const value = {
      id: 'asset-id',
      organizationId: 'organization-id',
      customerId: 'customer-id',
      category: 'AIR_CONDITIONER',
      name: 'Split recepção',
      manufacturer: 'Orbit',
      model: 'X1',
      serialNumber: 'SERIAL-1',
      identifier: 'EQ-1',
      installationAt: new Date('2026-01-02T00:00:00.000Z'),
      warrantyUntil: null,
      location: 'Recepção',
      status: 'ACTIVE',
      businessUnit: unit,
      _count: { operationLinks: 2, pmocCoverages: 1, artifactExecutions: 1 },
      rvtConfigurations: 1,
    } satisfies CustomerPortalAssetRecord;

    const result = mapper.assetDetails(value);
    expect(result.status.label).toBe('Ativo');
    expect(result.installedOn).toBe('2026-01-02');
    expect(result.related).toEqual({
      operations: 2,
      pmocPlans: 1,
      rvtConfigurations: 1,
      documents: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /specifications|depreciation|cost|margin/i,
    );
  });

  it('enforces stable bounded page metadata', () => {
    const result = mapper.page(
      { data: [1, 2], total: 5, page: 2, limit: 2 },
      (value) => String(value),
    );
    expect(result).toEqual({
      data: ['1', '2'],
      meta: {
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
  });
});
