import {
  documentCategoryOf,
  documentTypesFilter,
} from './customer-portal-document-category';

describe('categoria do documento no portal', () => {
  it('agrupa os tipos de cada modelo no que o cliente reconhece', () => {
    expect(documentCategoryOf('RECIBO')).toBe('receipt');
    expect(documentCategoryOf('receipt')).toBe('receipt');
    expect(documentCategoryOf('ORCAMENTO')).toBe('quote');
    expect(documentCategoryOf('PMOC')).toBe('pmoc');
    expect(documentCategoryOf('ORDEM_SERVICO')).toBe('service');
    expect(documentCategoryOf('RELATORIO_VISITA')).toBe('service');
  });

  it('um tipo novo cai em atendimento — e o filtro concorda com o rótulo', () => {
    expect(documentCategoryOf('TIPO_NOVO')).toBe('service');
    const filtro = documentTypesFilter('service');
    expect('notIn' in filtro && filtro.notIn).toEqual(
      expect.arrayContaining(['RECIBO', 'ORCAMENTO', 'PMOC']),
    );
    expect(documentTypesFilter('receipt')).toEqual({
      in: ['RECIBO', 'RECEIPT'],
    });
  });
});
