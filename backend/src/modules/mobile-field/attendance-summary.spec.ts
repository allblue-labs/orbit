import { attendanceSummary } from './attendance-summary';

describe('resumo que o cliente confirma', () => {
  it('inclui checklist, exceções, serviço, materiais e evidências sem revelar notas internas', () => {
    const summary = attendanceSummary({
      title: 'Manutenção preventiva',
      checklistExecutions: [
        {
          templateSnapshot: {
            name: 'Visita trimestral',
            items: [
              { key: 'filter', label: 'Filtro' },
              { key: 'drain', label: 'Dreno' },
            ],
          },
          answers: { filter: true, drain: false },
        },
      ],
      history: [
        { details: { visibility: 'INTERNAL', note: 'Informação interna' } },
        {
          details: {
            visibility: 'CUSTOMER_VISIBLE',
            note: 'Filtro substituído',
          },
        },
      ],
      materials: [
        { description: 'Filtro novo', quantity: 2, unit: 'UN', notes: null },
      ],
      fieldEvidence: [
        { caption: 'Após manutenção', storageFile: { fileName: 'foto.png' } },
      ],
    });
    expect(summary).toContain('Filtro: Realizado');
    expect(summary).toContain('Dreno: Não realizado');
    expect(summary).toContain('Filtro substituído');
    expect(summary).toContain('Filtro novo: 2 UN');
    expect(summary).toContain('Após manutenção');
    expect(summary).not.toContain('Informação interna');
  });
  it('usa as unidades do PMOC e preserva itens explicitamente desmarcados', () => {
    const summary = attendanceSummary({
      title: 'PMOC',
      data: { pmocChecklistAnswers: { '0:0': false, '0:1': true } },
      pmocEquipmentExecution: {
        procedureSnapshot: { Evaporadora: ['Limpeza', 'Inspeção'] },
        notes: 'Correia ajustada',
      },
    });
    expect(summary).toContain('Evaporadora — Limpeza: Não realizado');
    expect(summary).toContain('Evaporadora — Inspeção: Realizado');
    expect(summary).toContain('Correia ajustada');
  });
});
