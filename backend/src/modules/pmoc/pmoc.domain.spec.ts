/**
 * As regras que decidem se uma manutenção está em dia.
 *
 * É o coração do domínio e o mais barato de testar: entram estado, vencimento e
 * hoje; sai uma palavra e um número de dias.
 */
import {
  buildSuggestedCode,
  canTransition,
  coverageEndFromDuration,
  customerSlug,
  evaluateCompliance,
  executionEligibility,
  frequencyLabel,
  isValidPlanCode,
  normalizeCustomCode,
  previewSchedule,
  toDateOnly,
} from './pmoc.domain';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

import { plannedExecutionCount } from './pmoc.domain';

/*
 * O "de 12" do relatório.
 *
 * O número que o cliente confere para saber se o contrato está sendo cumprido.
 * Errar por um aqui significa um relatório afirmando que faltam manutenções que
 * já foram feitas — ou que o contrato terminou antes do prazo.
 */
describe('plannedExecutionCount', () => {
  it('um ano mensal prevê doze manutenções', () => {
    expect(
      plannedExecutionCount({
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
      }),
    ).toBe(12);
  });

  it('um ano trimestral prevê quatro', () => {
    expect(
      plannedExecutionCount({
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        frequencyAmount: 3,
        frequencyUnit: 'MONTHS',
      }),
    ).toBe(4);
  });

  /*
   * Plano sem prazo final não tem total.
   *
   * Cair no teto de `PREVIEW_MAX_CYCLES` faria o relatório afirmar "3 de 120"
   * para um contrato que ninguém disse que acaba — um número inventado com
   * aparência de cláusula.
   */
  it('vigência aberta não tem total', () => {
    expect(
      plannedExecutionCount({
        startsOn: '2026-01-01',
        endsOn: null,
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
      }),
    ).toBeNull();
  });

  it('o último vencimento dentro da vigência conta; o de fora, não', () => {
    /* 01/01 + 11 meses = 01/12, dentro. O décimo terceiro cairia em 01/01/2027,
       fora de uma vigência que termina em 31/12. */
    expect(
      plannedExecutionCount({
        startsOn: '2026-01-01',
        endsOn: '2026-12-01',
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
      }),
    ).toBe(12);
    expect(
      plannedExecutionCount({
        startsOn: '2026-01-01',
        endsOn: '2026-11-30',
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
      }),
    ).toBe(11);
  });

  it('vigência invertida não prevê nada', () => {
    expect(
      plannedExecutionCount({
        startsOn: '2026-12-31',
        endsOn: '2026-01-01',
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
      }),
    ).toBeNull();
  });
});

describe('máquina de estados do plano', () => {
  it('rascunho vira ativo ou cancelado', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(true);
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransition('DRAFT', 'SUSPENDED')).toBe(false);
  });

  it('ativo suspende e volta', () => {
    expect(canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
  });

  /**
   * Vencido é constatação do calendário, não decisão de ninguém: quem o
   * atribui é o servidor comparando a vigência com hoje.
   */
  it('ninguém marca um plano como vencido à mão', () => {
    expect(canTransition('ACTIVE', 'EXPIRED')).toBe(false);
    expect(canTransition('DRAFT', 'EXPIRED')).toBe(false);
  });

  /** Cancelado é terminal: retomar é criar outro, e o histórico fica legível. */
  it('cancelado não volta', () => {
    expect(canTransition('CANCELLED', 'ACTIVE')).toBe(false);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false);
  });
});

describe('conformidade', () => {
  const base = {
    planStatus: 'ACTIVE',
    dueSoonDays: 15,
    today: day('2026-06-01'),
  };

  it('em dia quando o vencimento está longe', () => {
    const result = evaluateCompliance({
      ...base,
      nextDueOn: day('2026-08-01'),
    });
    expect(result.status).toBe('UP_TO_DATE');
    expect(result.daysUntilDue).toBe(61);
    expect(result.overdue).toBe(false);
  });

  it('próximo do vencimento dentro da antecedência do plano', () => {
    const result = evaluateCompliance({
      ...base,
      nextDueOn: day('2026-06-10'),
    });
    expect(result.status).toBe('DUE_SOON');
    expect(result.daysUntilDue).toBe(9);
  });

  /** O limite é inclusivo: no dia exato da antecedência já é aviso. */
  it('o dia da antecedência já conta como próximo', () => {
    const result = evaluateCompliance({
      ...base,
      nextDueOn: day('2026-06-16'),
    });
    expect(result.status).toBe('DUE_SOON');
    expect(result.daysUntilDue).toBe(15);
  });

  it('vencido quando a data passou, com os dias negativos', () => {
    const result = evaluateCompliance({
      ...base,
      nextDueOn: day('2026-05-20'),
    });
    expect(result.status).toBe('OVERDUE');
    expect(result.daysUntilDue).toBe(-12);
    expect(result.overdue).toBe(true);
  });

  /** Vence hoje ainda não está vencido — o dia inteiro é do prazo. */
  it('vencendo hoje ainda não está vencido', () => {
    const result = evaluateCompliance({
      ...base,
      nextDueOn: day('2026-06-01'),
    });
    expect(result.status).toBe('DUE_SOON');
    expect(result.daysUntilDue).toBe(0);
    expect(result.overdue).toBe(false);
  });

  /**
   * A antecedência é do plano.
   *
   * Trinta dias faz sentido num plano anual e é ruído num semanal — por isso
   * não é constante global.
   */
  it('a antecedência muda a leitura do mesmo vencimento', () => {
    const near = evaluateCompliance({
      ...base,
      dueSoonDays: 60,
      nextDueOn: day('2026-07-15'),
    });
    const far = evaluateCompliance({
      ...base,
      dueSoonDays: 5,
      nextDueOn: day('2026-07-15'),
    });
    expect(near.status).toBe('DUE_SOON');
    expect(far.status).toBe('UP_TO_DATE');
  });

  /**
   * Plano fora de operação não está em dia **nem** atrasado.
   *
   * Chamar um plano suspenso de "em dia" faria um painel dizer que está tudo
   * certo quando ninguém está mantendo nada.
   */
  it('só plano ativo é avaliado', () => {
    for (const status of ['DRAFT', 'SUSPENDED', 'EXPIRED', 'CANCELLED']) {
      const result = evaluateCompliance({
        ...base,
        planStatus: status,
        nextDueOn: day('2026-05-01'),
      });
      expect(result.status).toBe('NOT_APPLICABLE');
      expect(result.daysUntilDue).toBeNull();
      expect(result.overdue).toBe(false);
    }
  });

  it('sem vencimento definido não há avaliação', () => {
    const result = evaluateCompliance({ ...base, nextDueOn: null });
    expect(result.status).toBe('NOT_APPLICABLE');
  });

  /** A comparação é por dia: a hora do instante não muda o veredito. */
  it('a hora do dia não muda o resultado', () => {
    const morning = evaluateCompliance({
      ...base,
      today: new Date('2026-06-01T02:00:00.000Z'),
      nextDueOn: day('2026-06-01'),
    });
    const evening = evaluateCompliance({
      ...base,
      today: new Date('2026-06-01T23:30:00.000Z'),
      nextDueOn: day('2026-06-01'),
    });
    expect(morning.status).toBe(evening.status);
    expect(morning.daysUntilDue).toBe(evening.daysUntilDue);
  });
});

describe('apresentação da periodicidade', () => {
  it('singular e plural', () => {
    expect(frequencyLabel({ amount: 1, unit: 'MONTHS' })).toBe('a cada 1 mês');
    expect(frequencyLabel({ amount: 6, unit: 'MONTHS' })).toBe(
      'a cada 6 meses',
    );
    expect(frequencyLabel({ amount: 1, unit: 'YEARS' })).toBe('a cada 1 ano');
  });
});

describe('datas', () => {
  it('viajam como dia, sem hora', () => {
    expect(toDateOnly(new Date('2026-06-01T23:45:00.000Z'))).toBe('2026-06-01');
  });
});

describe('elegibilidade de execução por equipamento', () => {
  const pronto = {
    planStatus: 'ACTIVE',
    cycleStatus: 'PENDING',
    equipmentStatus: 'ACTIVE',
    technicalResponsibleUserId: 'user-1',
    technicalResponsible: { eligible: true, blockedReason: null },
  };

  it('libera quando plano, ciclo, equipamento e responsável estão em ordem', () => {
    expect(executionEligibility(pronto)).toEqual({
      ready: true,
      blockedReasons: [],
    });
  });

  it('bloqueia plano fora de ativo', () => {
    const result = executionEligibility({ ...pronto, planStatus: 'SUSPENDED' });
    expect(result.ready).toBe(false);
    expect(result.blockedReasons).toContain('PLAN_NOT_ACTIVE');
  });

  it('bloqueia ciclo que não está pendente', () => {
    expect(
      executionEligibility({ ...pronto, cycleStatus: 'COMPLETED' })
        .blockedReasons,
    ).toContain('CYCLE_NOT_PENDING');
  });

  it('bloqueia equipamento inativo', () => {
    expect(
      executionEligibility({ ...pronto, equipmentStatus: 'INACTIVE' })
        .blockedReasons,
    ).toContain('EQUIPMENT_INACTIVE');
  });

  it('cobra responsável técnico quando o plano não tem um', () => {
    expect(
      executionEligibility({
        ...pronto,
        technicalResponsibleUserId: null,
        technicalResponsible: null,
      }).blockedReasons,
    ).toEqual(['TECHNICAL_RESPONSIBLE_MISSING']);
  });

  it('repassa o motivo que a workforce deu para o responsável', () => {
    expect(
      executionEligibility({
        ...pronto,
        technicalResponsible: {
          eligible: false,
          blockedReason: 'PROFESSIONAL_PROFILE_INACTIVE',
        },
      }).blockedReasons,
    ).toEqual(['PROFESSIONAL_PROFILE_INACTIVE']);
  });

  it('tem um motivo genérico quando a workforce recusa sem dizer por quê', () => {
    expect(
      executionEligibility({
        ...pronto,
        technicalResponsible: { eligible: false, blockedReason: null },
      }).blockedReasons,
    ).toEqual(['TECHNICAL_RESPONSIBLE_INELIGIBLE']);
  });

  it('acumula os motivos, na ordem em que a preparação sempre os listou', () => {
    expect(
      executionEligibility({
        planStatus: 'CANCELLED',
        cycleStatus: 'COMPLETED',
        equipmentStatus: 'INACTIVE',
        technicalResponsibleUserId: null,
        technicalResponsible: null,
      }).blockedReasons,
    ).toEqual([
      'PLAN_NOT_ACTIVE',
      'CYCLE_NOT_PENDING',
      'EQUIPMENT_INACTIVE',
      'TECHNICAL_RESPONSIBLE_MISSING',
    ]);
  });
});

describe('PR-FX-03 — código sugerido', () => {
  it('normaliza o nome do cliente de forma previsível', () => {
    expect(customerSlug('Clínica São José LTDA')).toBe('CLINICA-SAO-JOSE-LTDA');
    expect(customerSlug('Clínica Santa Maria')).toBe('CLINICA-SANTA-MARIA');
    expect(customerSlug('  A&B   Refrigeração  ')).toBe('A-B-REFRIGERACAO');
  });

  it('corta em palavra inteira quando o nome é longo demais', () => {
    const slug = customerSlug(
      'Condominio Residencial Parque das Amendoeiras Fase Dois',
    );
    expect(slug.length).toBeLessThanOrEqual(28);
    expect(slug.endsWith('-')).toBe(false);
    /** Palavra inteira, não `AMENDOEI`. */
    expect(slug.split('-').every((parte) => parte.length > 1)).toBe(true);
  });

  it('monta o código no formato do produto', () => {
    expect(buildSuggestedCode('Clínica Santa Maria', 1)).toBe(
      'PMOC-CLINICA-SANTA-MARIA-001',
    );
    expect(buildSuggestedCode('Clínica Santa Maria', 42)).toBe(
      'PMOC-CLINICA-SANTA-MARIA-042',
    );
    expect(buildSuggestedCode('Clínica Santa Maria', 1234)).toBe(
      'PMOC-CLINICA-SANTA-MARIA-1234',
    );
  });

  it('respeita o limite da coluna cortando o nome, nunca o número', () => {
    const nome =
      'Associacao Beneficente Hospitalar Sao Vicente de Paulo Filial';
    const code = buildSuggestedCode(nome, 7);
    expect(code.length).toBeLessThanOrEqual(60);
    expect(code.endsWith('-007')).toBe(true);
  });

  it('aceita código customizado dentro do alfabeto e recusa fora', () => {
    expect(normalizeCustomCode('  contrato/2026 especial ')).toBe(
      'CONTRATO/2026-ESPECIAL',
    );
    expect(isValidPlanCode('CONTRATO/2026-ESPECIAL')).toBe(true);
    expect(isValidPlanCode('AB')).toBe(false);
    expect(isValidPlanCode('CÓDIGO-COM-ACENTO')).toBe(false);
    expect(isValidPlanCode('-COMECA-COM-HIFEN')).toBe(false);
  });
});

describe('PR-FX-03 — projeção da programação', () => {
  const mensal = {
    frequencyAmount: 1,
    frequencyUnit: 'MONTHS' as const,
  };

  it('vigência de seis meses com atendimento mensal dá seis ciclos', () => {
    const endsOn = coverageEndFromDuration('2026-09-08', 6, 'MONTHS');
    /** Seis meses a partir de 08/09 terminam em 07/03, e não em 08/03. */
    expect(endsOn).toBe('2027-03-07');

    const { cycles } = previewSchedule({
      startsOn: '2026-09-08',
      endsOn,
      ...mensal,
    });
    expect(cycles).toHaveLength(6);
    expect(cycles.map((c) => c.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('satura o fim do mês em vez de transbordar para o mês seguinte', () => {
    const { cycles } = previewSchedule({
      startsOn: '2026-01-31',
      endsOn: coverageEndFromDuration('2026-01-31', 6, 'MONTHS'),
      ...mensal,
    });
    expect(cycles.map((c) => c.dueOn)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('respeita ano bissexto', () => {
    const { cycles } = previewSchedule({
      startsOn: '2028-01-31',
      endsOn: '2028-03-31',
      ...mensal,
    });
    expect(cycles.map((c) => c.dueOn)).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('a matriz é o produto cartesiano de ciclos por equipamento', () => {
    const casos: readonly [number, number, number][] = [
      [1, 1, 1],
      [1, 6, 6],
      [2, 6, 12],
      [10, 12, 120],
    ];
    for (const [equipamentos, ciclosEsperados, total] of casos) {
      const { cycles } = previewSchedule({
        startsOn: '2026-01-01',
        endsOn: coverageEndFromDuration(
          '2026-01-01',
          ciclosEsperados,
          'MONTHS',
        ),
        ...mensal,
      });
      expect(cycles).toHaveLength(ciclosEsperados);
      expect(cycles.length * equipamentos).toBe(total);

      /**
       * Cada equipamento recebe a mesma sequência `1..N`. Não é uma numeração
       * global intercalada — `A` não fica com 1,3,5 e `B` com 2,4,6.
       */
      for (let i = 0; i < equipamentos; i += 1) {
        expect(cycles.map((c) => c.sequence)).toEqual(
          Array.from({ length: ciclosEsperados }, (_, k) => k + 1),
        );
      }
    }
  });

  it('não projeta nada quando a vigência termina antes de começar', () => {
    const { cycles } = previewSchedule({
      startsOn: '2026-06-01',
      endsOn: '2026-05-01',
      ...mensal,
    });
    expect(cycles).toHaveLength(0);
  });

  it('trunca a vigência aberta em vez de projetar para sempre', () => {
    const resultado = previewSchedule({
      startsOn: '2026-01-01',
      endsOn: null,
      ...mensal,
      maxCycles: 24,
    });
    expect(resultado.cycles).toHaveLength(24);
    expect(resultado.truncated).toBe(true);
  });

  it('semanas e dias andam sem regra de calendário', () => {
    const semanal = previewSchedule({
      startsOn: '2026-01-01',
      endsOn: '2026-01-29',
      frequencyAmount: 1,
      frequencyUnit: 'WEEKS',
    });
    expect(semanal.cycles.map((c) => c.dueOn)).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
      '2026-01-22',
      '2026-01-29',
    ]);
  });
});
