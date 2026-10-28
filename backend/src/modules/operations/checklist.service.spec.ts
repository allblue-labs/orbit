import { ValidationException } from '../../exceptions';
import { ChecklistItemType } from './checklist.dto';
import { ChecklistService } from './checklist.service';

describe('ChecklistService', () => {
  const repository = {
    createTemplate: jest.fn(),
    findTemplate: jest.fn(),
    updateTemplate: jest.fn(),
  };
  const service = new ChecklistService(repository as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('normalizes template keys and item keys', async () => {
    repository.createTemplate.mockResolvedValue({ id: 'template' });
    await service.createTemplate('org', {
      key: ' preventive ',
      name: 'Preventive',
      items: [
        {
          key: ' Pressure ',
          label: 'Pressure',
          type: ChecklistItemType.NUMBER,
          required: true,
        },
      ],
    });
    expect(repository.createTemplate).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({
        key: 'PREVENTIVE',
        items: [expect.objectContaining({ key: 'pressure' })],
      }),
    );
  });

  it('rejects a select item without options', () => {
    expect(() =>
      service.createTemplate('org', {
        key: 'inspection',
        name: 'Inspection',
        items: [
          {
            key: 'result',
            label: 'Result',
            type: ChecklistItemType.SELECT,
          },
        ],
      }),
    ).toThrow(ValidationException);
  });

  it('um modelo geral serve para qualquer tipo e não muda o conteúdo dos itens', async () => {
    const items = [
      { key: 'epi', label: 'Conferir EPIs', type: ChecklistItemType.BOOLEAN },
    ];
    await service.createTemplate('org', {
      key: 'geral',
      name: 'Geral',
      operationKind: 'MAINTENANCE',
      isGeneral: true,
      items,
    });
    expect(repository.createTemplate).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({ isGeneral: true, operationKind: null }),
    );
  });

  it('nova versão herda a opção geral e permite desmarcar e limpar o tipo explicitamente', async () => {
    const items = [
      { key: 'epi', label: 'Conferir EPIs', type: ChecklistItemType.BOOLEAN },
    ];
    repository.findTemplate.mockResolvedValue({
      id: 'template',
      key: 'GERAL',
      name: 'Geral',
      version: 1,
      isGeneral: true,
      operationKind: null,
      isActive: true,
      items,
    });
    await service.updateTemplate('template', 'org', { items });
    expect(repository.createTemplate).toHaveBeenLastCalledWith(
      'org',
      expect.objectContaining({ isGeneral: true, operationKind: null }),
    );
    await service.updateTemplate('template', 'org', {
      items,
      isGeneral: false,
      operationKind: null,
    });
    expect(repository.createTemplate).toHaveBeenLastCalledWith(
      'org',
      expect.objectContaining({ isGeneral: false, operationKind: null }),
    );
  });
});
