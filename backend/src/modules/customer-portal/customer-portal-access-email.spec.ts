import {
  composeAccessEmail,
  organizationEmailDomain,
  sanitizeLocalPart,
  suggestCustomerLocalPart,
} from './customer-portal-access-email';

/**
 * O cliente usa o mesmo domínio da equipe. Os casos de domínio são os mesmos de
 * `frontend/src/components/workforce/member-email.test.ts`: se um mudar sem o
 * outro, o técnico e o cliente da mesma empresa entram por domínios diferentes.
 */
describe('e-mail de acesso do cliente', () => {
  it('monta o domínio da organização como o cadastro da equipe', () => {
    expect(organizationEmailDomain('clima-norte')).toBe('clima-norte.com');
    expect(organizationEmailDomain('Clímã Nórte')).toBe('clima-norte.com');
    expect(organizationEmailDomain('clima  norte')).toBe('clima-norte.com');
    expect(organizationEmailDomain('-clima-')).toBe('clima.com');
    expect(organizationEmailDomain('clima--norte')).toBe('clima-norte.com');
    expect(organizationEmailDomain('')).toBeNull();
    expect(organizationEmailDomain('---')).toBeNull();
    const longo = organizationEmailDomain('a'.repeat(62) + '-b');
    expect(longo).toBe('a'.repeat(62) + '.com');
  });

  it('o domínio é do servidor: o que vier depois do @ é descartado', () => {
    expect(composeAccessEmail('joao@outra-empresa.com', 'clima-norte')).toBe(
      'joao@clima-norte.com',
    );
    expect(sanitizeLocalPart(' Maria  Clara ')).toBe('maria.clara');
    expect(composeAccessEmail('Clínica Sol', 'clima-norte')).toBe(
      'clinica.sol@clima-norte.com',
    );
    expect(composeAccessEmail('!!!', 'clima-norte')).toBeNull();
    expect(composeAccessEmail('sol', '')).toBeNull();
  });

  it('sugere a parte local pelo nome do cliente, sem razão social', () => {
    expect(suggestCustomerLocalPart('Clínica Sol LTDA')).toBe('clinica.sol');
    expect(suggestCustomerLocalPart('Padaria do João ME')).toBe('padaria.joao');
    expect(suggestCustomerLocalPart('Hospital São Lucas de Recife S/A')).toBe(
      'hospital.sao.lucas',
    );
  });
});
