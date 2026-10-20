/**
 * O extenso é a defesa do recibo contra adulteração, então ele tem que estar
 * certo em português — não em inglês traduzido.
 *
 * Os casos aqui são os que as bibliotecas genéricas erram: as regras do "e",
 * "cem" contra "cento", "mil" sem "um" na frente, e o arredondamento dos
 * centavos que em ponto flutuante vira um centavo a menos.
 */
import { inteiroPorExtenso, moeda, valorPorExtenso } from './amount-in-words';

describe('inteiroPorExtenso', () => {
  it('escreve as unidades e a faixa irregular até dezenove', () => {
    expect(inteiroPorExtenso(0)).toBe('zero');
    expect(inteiroPorExtenso(1)).toBe('um');
    expect(inteiroPorExtenso(11)).toBe('onze');
    expect(inteiroPorExtenso(19)).toBe('dezenove');
  });

  it('liga dezena e unidade com "e"', () => {
    expect(inteiroPorExtenso(20)).toBe('vinte');
    expect(inteiroPorExtenso(21)).toBe('vinte e um');
    expect(inteiroPorExtenso(99)).toBe('noventa e nove');
  });

  it('distingue "cem" de "cento"', () => {
    expect(inteiroPorExtenso(100)).toBe('cem');
    expect(inteiroPorExtenso(101)).toBe('cento e um');
    expect(inteiroPorExtenso(120)).toBe('cento e vinte');
    expect(inteiroPorExtenso(199)).toBe('cento e noventa e nove');
    expect(inteiroPorExtenso(200)).toBe('duzentos');
    expect(inteiroPorExtenso(999)).toBe('novecentos e noventa e nove');
  });

  it('não escreve "um mil"', () => {
    expect(inteiroPorExtenso(1000)).toBe('mil');
    expect(inteiroPorExtenso(2000)).toBe('dois mil');
  });

  it('aplica a regra do "e" entre as classes', () => {
    /* Menos de cem no último grupo: liga com "e". */
    expect(inteiroPorExtenso(1002)).toBe('mil e dois');
    /* Centena redonda: liga com "e". */
    expect(inteiroPorExtenso(1200)).toBe('mil e duzentos');
    /* Nem uma coisa nem outra: sem "e". */
    expect(inteiroPorExtenso(1234)).toBe('mil duzentos e trinta e quatro');
    expect(inteiroPorExtenso(1101)).toBe('mil cento e um');
  });

  it('escreve milhão no singular e no plural', () => {
    expect(inteiroPorExtenso(1000000)).toBe('um milhão');
    expect(inteiroPorExtenso(2000000)).toBe('dois milhões');
    expect(inteiroPorExtenso(1000500)).toBe('um milhão e quinhentos');
  });

  it('recusa o que não sabe escrever em vez de inventar', () => {
    expect(inteiroPorExtenso(-1)).toBe('');
    expect(inteiroPorExtenso(Number.NaN)).toBe('');
    expect(inteiroPorExtenso(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('valorPorExtenso', () => {
  it('escreve o valor do modelo de recibo que recebemos', () => {
    expect(valorPorExtenso(120)).toBe('cento e vinte reais');
  });

  it('usa o singular de real', () => {
    expect(valorPorExtenso(1)).toBe('um real');
    expect(valorPorExtenso(1.01)).toBe('um real e um centavo');
  });

  it('junta reais e centavos com "e"', () => {
    expect(valorPorExtenso(1234.56)).toBe(
      'mil duzentos e trinta e quatro reais e cinquenta e seis centavos',
    );
  });

  it('escreve só os centavos quando não há reais', () => {
    expect(valorPorExtenso(0.5)).toBe('cinquenta centavos');
    expect(valorPorExtenso(0.01)).toBe('um centavo');
  });

  it('arredonda os centavos em vez de truncar', () => {
    /* 0.1 + 0.2 é 0.30000000000000004 em ponto flutuante; truncar daria
       "vinte e nove centavos" num recibo de trinta. */
    expect(valorPorExtenso(0.1 + 0.2)).toBe('trinta centavos');
    /* Uma casa decimal é meio-dez centavos, não dez. */
    expect(valorPorExtenso(12.3)).toBe('doze reais e trinta centavos');
    /* 2.9 * 3 é 8.700000000000001; truncar daria sessenta e nove centavos. */
    expect(valorPorExtenso(2.9 * 3)).toBe('oito reais e setenta centavos');
  });

  it('escreve o recibo de cortesia em vez de deixar o campo vazio', () => {
    expect(valorPorExtenso(0)).toBe('zero reais');
  });

  it('recusa valor inválido', () => {
    expect(valorPorExtenso(-5)).toBe('');
    expect(valorPorExtenso(Number.NaN)).toBe('');
  });
});

/**
 * `Intl` separa o símbolo do número com espaço inquebrável, que é o certo para
 * impressão e ruim para comparar em teste.
 */
const espacoNormal = (texto: string): string => texto.replace(/\s/g, ' ');

describe('moeda', () => {
  it('formata em real brasileiro', () => {
    expect(espacoNormal(moeda(120))).toBe('R$ 120,00');
    expect(espacoNormal(moeda(1234.5))).toBe('R$ 1.234,50');
  });
});
