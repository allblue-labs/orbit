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
  it('não transforma objetos técnicos em texto para o cliente', () => {
    const summary = attendanceSummary({
      title: 'Atendimento',
      checklistExecutions: [
        {
          templateSnapshot: {
            name: { internal: true },
            items: [
              { key: 'reading', label: { internal: 'sensor' } },
              { key: 'list', label: 'Medições' },
            ],
          },
          answers: {
            reading: { secret: 'raw' },
            list: [12, 'OK', { internal: true }],
          },
        },
      ],
    });
    expect(summary).toContain('Checklist: Atendimento');
    expect(summary).toContain('Item: Não informado');
    expect(summary).toContain('Medições: 12, OK, Não informado');
    expect(summary).not.toContain('[object Object]');
    expect(summary).not.toContain('internal');
  });

  it('descreve respostas compostas sem expor referências internas', () => {
    const id = '01a15e84-fad4-7218-a0ae-a0dec9273012';
    const summary = attendanceSummary({
      title: 'Revisão',
      checklistExecutions: [
        {
          templateSnapshot: {
            name: 'Inspeção técnica',
            items: [
              { key: 'pressao', label: 'Pressão' },
              { key: 'componentes', label: 'Componentes' },
              { key: 'registro', label: 'Registro', type: 'PHOTO' },
              { key: 'comprovante', label: 'Comprovante', type: 'SIGNATURE' },
              { key: 'observacao_interna' },
            ],
          },
          answers: {
            pressao: {
              value: 0,
              unit: 'bar',
              note: 'Equipamento desligado',
              id,
            },
            componentes: [{ label: 'Filtro', value: id }, { checked: false }],
            registro: id,
            comprovante: id,
            observacao_interna: id,
          },
        },
      ],
    });
    expect(summary).toContain(
      'Pressão: 0 bar — Observação: Equipamento desligado',
    );
    expect(summary).toContain('Componentes: Filtro, Não realizado');
    expect(summary).toContain('Registro: Foto registrada');
    expect(summary).toContain('Comprovante: Assinatura registrada');
    expect(summary).toContain('Item: Não informado');
    expect(summary).not.toMatch(/observacao_interna|\[object Object\]/);
    expect(summary).not.toContain(id);
  });
});
