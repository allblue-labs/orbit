import { documentValue } from './document-value';

describe('business values in customer documents', () => {
  it('formats nested equipment with readable labels and preserves custom specifications', () => {
    const text = documentValue([
      {
        id: 'internal-id',
        name: 'Split Freeze',
        manufacturer: 'LG',
        model: '18K',
        serialNumber: '892389d',
        location: 'Sala 20',
        specifications: { capacidade_btu: 18000, filtro_lavavel: true },
        notes: 'Conferir em 48 horas',
      },
    ]);
    expect(text).toContain('Nome: Split Freeze');
    expect(text).toContain('Fabricante: LG');
    expect(text).toContain('Número de série: 892389d');
    expect(text).toContain('Capacidade btu: 18000');
    expect(text).toContain('Filtro lavavel: Sim');
    expect(text).toContain('Conferir em 48 horas');
    expect(text).not.toMatch(/internal-id|\{|\}|\[object Object\]/);
  });
  it('omits storage and signature internals recursively while retaining business identifiers', () => {
    const text = documentValue({
      identifier: 'EQP-001',
      technicalResponsible: {
        displayName: 'Responsável',
        userId: 'private-user',
        signature: {
          sha256: 'private-hash',
          storageObjectId: 'private-object',
        },
        credential: {
          credentialType: 'CREA',
          credentialNumber: '12345',
          credentialRegion: 'PE',
        },
      },
    });
    expect(text).toContain('EQP-001');
    expect(text).toContain('Responsável');
    expect(text).toContain('CREA');
    expect(text).toContain('12345');
    expect(text).not.toMatch(/private-|sha256|storageObjectId|userId/);
  });
  it('keeps explicit false, zero and lists of user-written text', () => {
    expect(documentValue({ quantidade: 0, executado: false })).toBe(
      'Quantidade: 0\nExecutado: Não',
    );
    expect(documentValue(['Reaperto', 'Limpeza'])).toBe('Reaperto, Limpeza');
    expect(documentValue(null)).toBe('—');
  });
});
