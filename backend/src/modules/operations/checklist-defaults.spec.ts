import { checklistDefaults } from './checklist-defaults';

describe('seleção inicial de checklists', () => {
  it('seleciona os itens de execução sem inventar texto ou medições', () => {
    expect(
      checklistDefaults([
        { key: 'clean', type: 'BOOLEAN' },
        { key: 'temperature', type: 'NUMBER' },
        { key: 'note', type: 'TEXT' },
      ]),
    ).toEqual({ clean: true });
  });
});
