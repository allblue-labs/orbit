/**
 * Autorização da atribuição — a regra, isolada.
 *
 * A chave era gravada e **ninguém a lia**: ligar não escondia nada. Estes
 * testes prendem as duas metades — ler a preferência de um campo livre, e
 * traduzi-la em visibilidade.
 */
import {
  fieldVisibilityFilter,
  requiresAssignmentAuthorization,
  visibleToField,
} from './operation-authorization';

describe('requiresAssignmentAuthorization', () => {
  it('lê a chave quando ela está lá', () => {
    expect(
      requiresAssignmentAuthorization({
        operations: { requireAssignmentAuthorization: true },
      }),
    ).toBe(true);
  });

  it('desligada é o padrão', () => {
    expect(
      requiresAssignmentAuthorization({
        operations: { requireAssignmentAuthorization: false },
      }),
    ).toBe(false);
    expect(requiresAssignmentAuthorization({ operations: {} })).toBe(false);
    expect(requiresAssignmentAuthorization({})).toBe(false);
  });

  /**
   * `settings` é `Json?` livre: não há esquema nem validação, e o que está
   * gravado pode vir de uma versão anterior. Só o booleano `true` liga — a
   * string `"true"` não, porque adivinhar intenção de um campo sem contrato é
   * como uma organização acaba com uma regra que ninguém pediu.
   */
  it('só o booleano verdadeiro liga', () => {
    for (const valor of ['true', 1, {}, [], 'sim']) {
      expect(
        requiresAssignmentAuthorization({
          operations: { requireAssignmentAuthorization: valor },
        }),
      ).toBe(false);
    }
  });

  it('nada, nulo ou forma inesperada não ligam', () => {
    expect(requiresAssignmentAuthorization(null)).toBe(false);
    expect(requiresAssignmentAuthorization(undefined)).toBe(false);
    expect(requiresAssignmentAuthorization('operations')).toBe(false);
    expect(requiresAssignmentAuthorization({ operations: 'sim' })).toBe(false);
  });
});

describe('visibleToField', () => {
  const carimbo = new Date('2026-09-14T12:00:00.000Z');

  it('sem exigência, tudo chega ao técnico', () => {
    expect(visibleToField(false, null)).toBe(true);
    expect(visibleToField(false, carimbo)).toBe(true);
  });

  it('com exigência, só o autorizado chega', () => {
    expect(visibleToField(true, carimbo)).toBe(true);
    expect(visibleToField(true, null)).toBe(false);
  });
});

describe('fieldVisibilityFilter', () => {
  /**
   * Sem exigência, a consulta fica **idêntica** à de antes.
   *
   * Uma cláusula a mais que sempre casa não muda o resultado e muda o plano de
   * execução — a organização que não usa o recurso não deveria pagar por ele.
   */
  it('não acrescenta cláusula quando a organização não exige', () => {
    expect(fieldVisibilityFilter(false)).toEqual({});
  });

  it('exige carimbo quando a organização pede', () => {
    expect(fieldVisibilityFilter(true)).toEqual({
      authorizedAt: { not: null },
    });
  });
});
