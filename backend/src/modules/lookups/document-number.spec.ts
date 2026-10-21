/**
 * CPF e CNPJ: os dígitos verificadores.
 *
 * ## Por que verificar antes de consultar
 *
 * Um número malformado é erro de digitação. Dizer isso na hora é melhor que
 * gastar uma consulta a um terceiro para receber "não encontrado" — que a
 * pessoa leria como "esta empresa não existe".
 *
 * A verificação é dos dígitos, **não** da existência: um número bem formado
 * pode nunca ter sido emitido. Quem sabe disso é a Receita.
 */
import { isValidCnpj, isValidCpf, onlyDigits } from './document-number';

describe('CNPJ', () => {
  it('aceita um número com verificadores corretos', () => {
    expect(isValidCnpj('19.131.243/0001-97')).toBe(true);
    expect(isValidCnpj('19131243000197')).toBe(true);
  });

  it('recusa quando um verificador não fecha', () => {
    expect(isValidCnpj('19131243000198')).toBe(false);
    expect(isValidCnpj('19131243000196')).toBe(false);
  });

  it('recusa comprimento diferente de quatorze', () => {
    expect(isValidCnpj('1913124300019')).toBe(false);
    expect(isValidCnpj('191312430001977')).toBe(false);
  });

  /**
   * Todos os dígitos iguais passam na conta e não existem na prática.
   *
   * `11111111111111` fecha os dois verificadores. Sem este corte, a tela
   * aceitaria o número de teste que todo mundo digita e consultaria por nada.
   */
  it('recusa todos os dígitos iguais', () => {
    const repetidos = Array.from({ length: 10 }, (_, digito) =>
      String(digito).repeat(14),
    );

    expect(repetidos.filter(isValidCnpj)).toEqual([]);
  });
});

describe('CPF', () => {
  it('aceita um número com verificadores corretos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });

  it('recusa quando um verificador não fecha', () => {
    expect(isValidCpf('52998224726')).toBe(false);
  });

  it('recusa todos os dígitos iguais', () => {
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('recusa comprimento diferente de onze', () => {
    expect(isValidCpf('5299822472')).toBe(false);
  });
});

describe('normalização', () => {
  it('guarda só os dígitos', () => {
    expect(onlyDigits('19.131.243/0001-97')).toBe('19131243000197');
    expect(onlyDigits(' 50030-230 ')).toBe('50030230');
    expect(onlyDigits('sem número')).toBe('');
  });
});
