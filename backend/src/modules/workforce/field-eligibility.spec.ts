import {
  ASSIGNABLE_TEAM_ROLES,
  ASSISTANT_TECHNICIAN_ROLE_KEY,
  ADMINISTRATOR_ROLE_KEY,
  FIELD_TECHNICIAN_ROLE_KEY,
  TECHNICAL_RESPONSIBLE_ROLE_KEY,
  CUSTOMER_SERVICE_ROLE_KEY,
} from '../organizations/team-roles';
import {
  assistsFieldWork,
  executesFieldWork,
  grantedAccessOf,
} from './field-eligibility';

/**
 * A regra é lida contra o catálogo real de papéis, e não contra acessos
 * inventados no teste: é o catálogo que o cadastro usa, e é nele que a próxima
 * mudança de permissão acontece.
 */
const roleAccess = (key: string) => {
  const seed = ASSIGNABLE_TEAM_ROLES.find((item) => item.key === key);
  if (!seed) throw new Error(`papel ausente do catálogo: ${key}`);
  return {
    permissions: seed.permissions,
    allowedSurfaces: seed.allowedSurfaces,
  };
};

describe('elegibilidade de campo', () => {
  describe('quem executa', () => {
    it('o técnico operador executa', () => {
      expect(executesFieldWork(roleAccess(FIELD_TECHNICIAN_ROLE_KEY))).toBe(
        true,
      );
    });

    it('o auxiliar técnico não executa', () => {
      expect(executesFieldWork(roleAccess(ASSISTANT_TECHNICIAN_ROLE_KEY))).toBe(
        false,
      );
    });

    it('o responsável técnico não executa — a designação dele é outra', () => {
      expect(
        executesFieldWork(roleAccess(TECHNICAL_RESPONSIBLE_ROLE_KEY)),
      ).toBe(false);
    });

    /**
     * Quem administra com acesso ao aplicativo executa.
     *
     * Não é concessão: o RBAC dele concede alterar etapa de atendimento e a
     * superfície móvel. Numa empresa de poucas pessoas é o dono que vai à casa
     * de máquinas, e deixá-lo fora do seletor obrigaria a cadastrar um segundo
     * usuário para a mesma pessoa.
     */
    it('quem administra com acesso móvel executa', () => {
      expect(executesFieldWork(roleAccess(ADMINISTRATOR_ROLE_KEY))).toBe(true);
    });

    /**
     * Atendimento edita atendimento, mas só pelo painel. Sem superfície móvel
     * não há execução em campo — e é a superfície que separa os dois casos,
     * não a permissão.
     */
    it('quem só tem o painel não executa, mesmo podendo editar atendimento', () => {
      const atendimento = roleAccess(CUSTOMER_SERVICE_ROLE_KEY);
      expect(atendimento.allowedSurfaces).not.toContain('MOBILE');
      expect(executesFieldWork(atendimento)).toBe(false);
    });

    it('a permissão sem a superfície não basta', () => {
      expect(
        executesFieldWork({
          permissions: ['operations.status.update'],
          allowedSurfaces: ['WEB'],
        }),
      ).toBe(false);
    });

    it('a superfície sem a permissão não basta', () => {
      expect(
        executesFieldWork({
          permissions: ['operations.read'],
          allowedSurfaces: ['MOBILE'],
        }),
      ).toBe(false);
    });

    it('a superfície é comparada sem diferenciar caixa', () => {
      expect(
        executesFieldWork({
          permissions: ['operations.status.update'],
          allowedSurfaces: ['mobile'],
        }),
      ).toBe(true);
    });
  });

  describe('quem acompanha', () => {
    /** O caso que motivou tudo: o papel auxiliar precisa poder ser auxiliar. */
    it('o auxiliar técnico acompanha', () => {
      expect(assistsFieldWork(roleAccess(ASSISTANT_TECHNICIAN_ROLE_KEY))).toBe(
        true,
      );
    });

    it('o técnico operador também acompanha — ele lê tudo o que o auxiliar lê', () => {
      expect(assistsFieldWork(roleAccess(FIELD_TECHNICIAN_ROLE_KEY))).toBe(
        true,
      );
    });

    it('quem só tem o painel não acompanha em campo', () => {
      expect(assistsFieldWork(roleAccess(CUSTOMER_SERVICE_ROLE_KEY))).toBe(
        false,
      );
    });

    it('sem ler atendimento não acompanha', () => {
      expect(
        assistsFieldWork({
          permissions: ['customers.read'],
          allowedSurfaces: ['MOBILE'],
        }),
      ).toBe(false);
    });
  });

  describe('o acesso efetivo do vínculo', () => {
    const papel = {
      permissions: ['operations.read', 'operations.status.update'],
      allowedSurfaces: ['MOBILE'],
    };

    it('sem override, vale o papel', () => {
      const acesso = grantedAccessOf({
        usesCustomAccess: false,
        customPermissions: [],
        customAllowedSurfaces: [],
        role: papel,
      });
      expect(executesFieldWork(acesso)).toBe(true);
    });

    /**
     * O override **substitui** o papel, não se soma a ele.
     *
     * Um membro com acesso recortado para leitura deixa de ser atribuível como
     * responsável, mesmo que o papel de origem permitisse — ler o papel aqui
     * daria à pessoa uma autoridade que o dono tirou dela.
     */
    it('com override, o papel não vaza por baixo', () => {
      const acesso = grantedAccessOf({
        usesCustomAccess: true,
        customPermissions: ['operations.read'],
        customAllowedSurfaces: ['MOBILE'],
        role: papel,
      });
      expect(executesFieldWork(acesso)).toBe(false);
      expect(assistsFieldWork(acesso)).toBe(true);
    });

    it('o override também vale para a superfície', () => {
      const acesso = grantedAccessOf({
        usesCustomAccess: true,
        customPermissions: papel.permissions,
        customAllowedSurfaces: ['WEB'],
        role: papel,
      });
      expect(executesFieldWork(acesso)).toBe(false);
      expect(assistsFieldWork(acesso)).toBe(false);
    });
  });
});
