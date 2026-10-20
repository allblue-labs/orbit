/**
 * Os referenciais da qualidade do ar.
 *
 * Aqui se testa o que, se sair errado, faz o documento mentir sobre norma: o
 * limite no valor errado, a borda tratada como violação, e o parâmetro não
 * medido saindo como se estivesse dentro do referencial.
 */
import {
  AIR_QUALITY_LIMITS,
  evaluateLimit,
  limitFor,
  verdictLabel,
} from './air-quality-limits';

describe('referenciais da RE 9/2003', () => {
  it('guarda os valores máximos recomendáveis da norma', () => {
    expect(limitFor('fungos')?.max).toBe(750);
    expect(limitFor('particulas')?.max).toBe(80);
    expect(limitFor('co2')?.max).toBe(1000);
    expect(limitFor('velocidade_ar')?.max).toBe(0.25);
  });

  it('usa a envoltória sazonal para temperatura e umidade', () => {
    const temperatura = limitFor('temperatura');
    expect(temperatura?.min).toBe(20);
    expect(temperatura?.rangeMax).toBe(26);
    /* Marcado como sazonal para o documento imprimir a ressalva: dentro da
       envoltória ainda pode estar fora da faixa da estação. */
    expect(temperatura?.seasonal).toBe(true);

    const umidade = limitFor('umidade');
    expect(umidade?.min).toBe(35);
    expect(umidade?.rangeMax).toBe(65);
    expect(umidade?.seasonal).toBe(true);
  });

  it('cobre os seis parâmetros que o template mede', () => {
    expect(AIR_QUALITY_LIMITS.map((limite) => limite.field).sort()).toEqual([
      'co2',
      'fungos',
      'particulas',
      'temperatura',
      'umidade',
      'velocidade_ar',
    ]);
  });
});

describe('evaluateLimit', () => {
  const fungos = limitFor('fungos')!;
  const temperatura = limitFor('temperatura')!;

  it('aponta o que passa do máximo', () => {
    expect(evaluateLimit(fungos, 820)).toBe('ABOVE');
    expect(evaluateLimit(fungos, 300)).toBe('WITHIN');
  });

  it('trata o valor exatamente no limite como dentro', () => {
    /* "até 750" inclui 750. Marcar a borda como violação acusaria um
       ambiente que atende à norma. */
    expect(evaluateLimit(fungos, 750)).toBe('WITHIN');
    expect(evaluateLimit(fungos, 750.1)).toBe('ABOVE');
  });

  it('distingue abaixo da faixa de acima dela', () => {
    expect(evaluateLimit(temperatura, 18)).toBe('BELOW');
    expect(evaluateLimit(temperatura, 24)).toBe('WITHIN');
    expect(evaluateLimit(temperatura, 28)).toBe('ABOVE');
    /* As duas bordas da envoltória contam como dentro. */
    expect(evaluateLimit(temperatura, 20)).toBe('WITHIN');
    expect(evaluateLimit(temperatura, 26)).toBe('WITHIN');
  });

  it('não confunde não medido com dentro do referencial', () => {
    /* Um parâmetro que ninguém mediu impresso como "dentro do VMR"
       afirmaria uma conformidade que não foi verificada. */
    expect(evaluateLimit(fungos, undefined)).toBe('UNKNOWN');
    expect(evaluateLimit(fungos, Number.NaN)).toBe('UNKNOWN');
  });
});

describe('verdictLabel', () => {
  it('fala de referencial, e nunca de conformidade', () => {
    expect(verdictLabel('WITHIN')).toBe('Dentro do VMR');
    expect(verdictLabel('ABOVE')).toBe('Acima do VMR');
    expect(verdictLabel('UNKNOWN')).toBe('Não medido');
    /* Conformidade é juízo de quem assina o laudo, não do gerador de PDF. */
    for (const veredito of ['WITHIN', 'ABOVE', 'BELOW', 'UNKNOWN'] as const) {
      expect(verdictLabel(veredito).toLowerCase()).not.toContain('conforme');
    }
  });
});
