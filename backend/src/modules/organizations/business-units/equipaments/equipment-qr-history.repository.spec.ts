import { EquipmentQrRepository } from './equipment-qr.repository';

describe('Histórico de atendimentos do equipamento', () => {
  it('consulta apenas concluídos vinculados ao equipamento, tenant e unidade, com paginação', async () => {
    const tx = {
      equipmentServiceHistory: {
        count: jest.fn().mockResolvedValue(11),
        findMany: jest
          .fn()
          .mockResolvedValue([{ operationId: 'operation-rvt' }]),
      },
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
      assetId: 'equipment',
    };
    expect(tx.equipmentServiceHistory.count).toHaveBeenCalledWith({ where });
    expect(tx.equipmentServiceHistory.findMany).toHaveBeenCalledWith({
      where,
      skip: 10,
      take: 10,
      orderBy: [{ completedAt: 'desc' }, { operationId: 'desc' }],
    });
    expect(result.total).toBe(11);
  });
});
