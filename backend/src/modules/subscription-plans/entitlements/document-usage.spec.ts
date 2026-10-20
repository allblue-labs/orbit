import { UsageResource } from '../catalog/plan-catalog.types';
import { documentUsageResource } from './document-usage';

describe('classificação documental', () => {
  it('PMOC e RVT têm cada um o seu balde', () => {
    expect(documentUsageResource('PMOC')).toBe(
      UsageResource.PMOC_DOCUMENTS_ISSUED,
    );
    expect(documentUsageResource('RELATORIO_VISITA')).toBe(
      UsageResource.RVT_DOCUMENTS_ISSUED,
    );
  });

  it('o documento da ordem de serviço não consome cota documental', () => {
    // A ordem já foi cobrada ao ser criada; cobrar o papel dela seria contar
    // o mesmo atendimento duas vezes com nomes diferentes.
    expect(documentUsageResource('ORDEM_SERVICO')).toBeNull();
  });

  it('o resto cai em outros documentos, inclusive o que ainda não conhecemos', () => {
    for (const tipo of [
      'RELATORIO_TECNICO',
      'QUALIDADE_AR',
      'RECIBO',
      'ORCAMENTO',
      'TEMPLATE_QUE_AINDA_NAO_EXISTE',
    ]) {
      expect(documentUsageResource(tipo)).toBe(
        UsageResource.OTHER_DOCUMENTS_ISSUED,
      );
    }
  });

  it('nenhum tipo pertence a dois baldes', () => {
    const tipos = [
      'PMOC',
      'RELATORIO_VISITA',
      'ORDEM_SERVICO',
      'RELATORIO_TECNICO',
      'RECIBO',
    ];
    for (const tipo of tipos) {
      const baldes = [
        UsageResource.PMOC_DOCUMENTS_ISSUED,
        UsageResource.RVT_DOCUMENTS_ISSUED,
        UsageResource.OTHER_DOCUMENTS_ISSUED,
      ].filter((balde) => documentUsageResource(tipo) === balde);
      expect(baldes.length).toBeLessThanOrEqual(1);
    }
  });
});
