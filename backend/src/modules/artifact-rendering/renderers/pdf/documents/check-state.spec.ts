/**
 * A regra dos três estados do item de verificação.
 *
 * O que este teste protege é a distinção entre "respondeu não" e "não
 * respondeu". Se alguém simplificar para `Boolean(value)` — o que parece
 * inofensivo — todo item em branco passa a sair impresso como não executado,
 * num documento assinado, e ninguém percebe até o cliente reclamar.
 */
import { checkState } from './check-state';

describe('checkState', () => {
  it('lê o booleano como ele veio', () => {
    expect(checkState(true)).toBe(true);
    expect(checkState(false)).toBe(false);
  });

  it('trata ausência de resposta como ausência, não como recusa', () => {
    expect(checkState(undefined)).toBeNull();
    expect(checkState(null)).toBeNull();
    expect(checkState('')).toBeNull();
    expect(checkState('   ')).toBeNull();
  });

  it('normaliza as formas que os produtores usam de fato', () => {
    for (const verdadeiro of ['true', 'Sim', 'SIM', ' yes ', '1', 'ok', 'X']) {
      expect(checkState(verdadeiro)).toBe(true);
    }
    for (const falso of ['false', 'Não', 'nao', 'no', '0', '-']) {
      expect(checkState(falso)).toBe(false);
    }
  });

  it('não adivinha o que não reconhece', () => {
    expect(checkState('parcial')).toBeNull();
    expect(checkState({})).toBeNull();
    expect(checkState([])).toBeNull();
  });

  it('lê número como marcação, e NaN como ausência', () => {
    expect(checkState(1)).toBe(true);
    expect(checkState(0)).toBe(false);
    /* Um número que não chegou não é um item recusado. */
    expect(checkState(Number.NaN)).toBeNull();
  });
});
