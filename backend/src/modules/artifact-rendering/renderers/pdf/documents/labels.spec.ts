import { roleLabel } from './labels';

describe('papel de quem assina', () => {
  it('traduz os papéis do catálogo e esconde código desconhecido', () => {
    expect(roleLabel('TECHNICAL_MANAGER')).toBe('Responsável técnico');
    expect(roleLabel('ALGUM_PAPEL_NOVO')).toBeUndefined();
    expect(roleLabel('Síndico')).toBe('Síndico');
  });
});
