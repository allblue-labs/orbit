/**
 * O endereço de atendimento semeado a partir do cadastro.
 *
 * O dono preenchia o endereço ao criar o cliente, abria a aba Endereços e a
 * encontrava vazia — porque o formulário gravava o endereço **fiscal**, e a
 * aba lista os de atendimento. Tinha de digitar tudo de novo para que uma
 * operação tivesse destino.
 */
import {
  PRIMEIRO_ENDERECO,
  enderecoDeAtendimento,
} from './customer-address-seed';

const completo = {
  street: 'Rua do Sol',
  number: '210',
  complement: 'Sala 2',
  district: 'Santo Antônio',
  city: 'Recife',
  stateCode: 'pe',
  postalCode: '50030-230',
  state: 'Pernambuco',
  country: 'Brasil',
};

describe('endereço de atendimento a partir do cadastro', () => {
  it('aproveita o que o formulário mandou', () => {
    expect(enderecoDeAtendimento(completo)).toEqual({
      label: PRIMEIRO_ENDERECO,
      street: 'Rua do Sol',
      number: '210',
      complement: 'Sala 2',
      district: 'Santo Antônio',
      city: 'Recife',
      /* Em maiúsculas: a coluna tem duas posições e o resto do produto compara
         com `PE`, não com `pe`. */
      stateCode: 'PE',
      postalCode: '50030-230',
    });
  });

  it('sem logradouro não semeia', () => {
    /*
     * Um CEP solto ou uma UF não levam ninguém a lugar nenhum, e
     * `CustomerAddress` exige logradouro e cidade. Criar a linha assim mesmo
     * produziria um endereço de atendimento vazio, que é pior que nenhum: a
     * aba deixaria de parecer vazia sem passar a ser útil.
     */
    expect(
      enderecoDeAtendimento({ postalCode: '50030-230', city: 'Recife' }),
    ).toBeUndefined();
  });

  it('sem cidade não semeia', () => {
    expect(enderecoDeAtendimento({ street: 'Rua do Sol' })).toBeUndefined();
  });

  it('sem endereço nenhum não semeia', () => {
    expect(enderecoDeAtendimento(undefined)).toBeUndefined();
  });

  it('campo em branco conta como ausente', () => {
    /* O formulário manda string vazia no que não foi preenchido; tratá-la como
       valor gravaria um complemento em branco. */
    const semeado = enderecoDeAtendimento({
      ...completo,
      complement: '   ',
      number: '',
    });

    expect(semeado?.complement).toBeUndefined();
    expect(semeado?.number).toBeUndefined();
  });

  it('espaço em volta não vira parte do endereço', () => {
    const semeado = enderecoDeAtendimento({
      street: '  Rua do Sol  ',
      city: ' Recife ',
    });

    expect(semeado?.street).toBe('Rua do Sol');
    expect(semeado?.city).toBe('Recife');
  });
});
