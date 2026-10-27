import { EquipmentQrRepository } from './equipment-qr.repository';

describe('Histórico de atendimentos do equipamento', () => {
  it('consulta apenas concluídos vinculados ao equipamento, tenant e unidade, com paginação', async () => {
    const tx = {
      operation: {
        count: jest.fn().mockResolvedValue(11),
        findMany: jest.fn().mockResolvedValue([{ id: 'operation-rvt' }]),
      },
      rvtExecution: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repository = new EquipmentQrRepository({
      run: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never);
    const result = await repository.serviceHistory({
      organizationId: 'org',
      businessUnitId: 'unit',
      equipmentId: 'equipment',
      page: 2,
      limit: 10,
    });
    const where = {
      organizationId: 'org',
      businessUnitId: 'unit',
      deletedAt: null,
      status: 'COMPLETED',
      assets: { some: { assetId: 'equipment' } },
    };
    expect(tx.operation.count).toHaveBeenCalledWith({ where });
    expect(tx.operation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 10, take: 10 }),
    );
    expect(tx.rvtExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org',
          businessUnitId: 'unit',
          status: 'COMPLETED',
          operationId: { in: ['operation-rvt'] },
          equipment: { some: { assetId: 'equipment' } },
        },
      }),
    );
    expect(result.total).toBe(11);
  });
});
