import { issuerLogo } from './issuer-brand';

const MARCA_UNIDADE = 'data:image/png;base64,dW5pZGFkZQ==';
const MARCA_EMPRESA = 'data:image/png;base64,ZW1wcmVzYQ==';

describe('issuerLogo', () => {
  it('usa a marca da unidade quando ela tem uma', () => {
    expect(
      issuerLogo({
        logoUrl: MARCA_UNIDADE,
        organization: { logoUrl: MARCA_EMPRESA },
      }),
    ).toBe(MARCA_UNIDADE);
  });

  it('cai para a marca da empresa quando a unidade não tem', () => {
    expect(
      issuerLogo({ logoUrl: null, organization: { logoUrl: MARCA_EMPRESA } }),
    ).toBe(MARCA_EMPRESA);
  });

  /* O caso de quem nunca abriu o cadastro de unidade: é o comum, e é o que
     justifica a coluna na empresa. */
  it('cai para a empresa quando a unidade não traz o campo', () => {
    expect(issuerLogo({ organization: { logoUrl: MARCA_EMPRESA } })).toBe(
      MARCA_EMPRESA,
    );
  });

  it('responde nulo quando nenhuma das duas tem marca', () => {
    expect(
      issuerLogo({ logoUrl: null, organization: { logoUrl: null } }),
    ).toBeNull();
    expect(issuerLogo({ logoUrl: null, organization: null })).toBeNull();
    expect(issuerLogo(null)).toBeNull();
    expect(issuerLogo(undefined)).toBeNull();
  });
});
