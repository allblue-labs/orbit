import { ChecklistRepository } from './checklist.repository';
import { ChecklistTemplateQueryDto } from './checklist.dto';

describe('modelos disponíveis para seleção', () => {
  it('filtra versões atuais sem ressuscitar versões antigas de um modelo inativo/excluído', async () => {
    const tx = {
      checklistTemplate: {
        groupBy: jest.fn().mockResolvedValue([
          { key: 'GERAL', _max: { version: 3 } },
          { key: 'RETIRADO', _max: { version: 5 } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const repository = new ChecklistRepository({
      run: (work: (value: typeof tx) => unknown) => work(tx),
    } as never);
    const query = Object.assign(new ChecklistTemplateQueryDto(), {
      latestOnly: true,
      isActive: true,
    });
    await repository.listTemplates('org', query);
    expect(tx.checklistTemplate.groupBy).toHaveBeenCalledWith({
      by: ['key'],
      where: { organizationId: 'org' },
      _max: { version: true },
    });
    expect(tx.checklistTemplate.findMany.mock.calls[0]).toMatchObject([
      {
        where: {
          organizationId: 'org',
          deletedAt: null,
          isActive: true,
          AND: [
            {
              OR: [
                { key: 'GERAL', version: 3 },
                { key: 'RETIRADO', version: 5 },
              ],
            },
          ],
        },
      },
    ]);
  });
});
