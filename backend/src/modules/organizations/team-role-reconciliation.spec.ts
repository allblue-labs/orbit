/**
 * Papéis de sistema acompanham o catálogo — acrescentando, nunca retirando.
 *
 * O caso que motivou: `pmoc.execute` entrou no papel de técnico de campo em
 * 29/09, e nenhuma organização criada antes recebeu. O técnico abria o PMOC
 * atribuído a ele e era barrado no fim.
 */
import { reconcileRole } from './team-role-reconciliation';
import { ASSIGNABLE_TEAM_ROLES, FIELD_TECHNICIAN_ROLE_KEY } from './team-roles';

const tecnicoNoCatalogo = ASSIGNABLE_TEAM_ROLES.find(
  (role) => role.key === FIELD_TECHNICIAN_ROLE_KEY,
)!;

describe('reconciliação de papéis de sistema', () => {
  it('o técnico de antes de 29/09 recebe pmoc.execute', () => {
    const gravadoAntes = {
      key: FIELD_TECHNICIAN_ROLE_KEY,
      permissions: tecnicoNoCatalogo.permissions.filter(
        (permission) => permission !== 'pmoc.execute',
      ),
      allowedSurfaces: [...tecnicoNoCatalogo.allowedSurfaces],
    };

    const ajuste = reconcileRole(tecnicoNoCatalogo, gravadoAntes);

    expect(ajuste.permissions).toContain('pmoc.execute');
  });

  it('papel em dia não gera escrita', () => {
    const ajuste = reconcileRole(tecnicoNoCatalogo, {
      key: FIELD_TECHNICIAN_ROLE_KEY,
      permissions: [...tecnicoNoCatalogo.permissions],
      allowedSurfaces: [...tecnicoNoCatalogo.allowedSurfaces],
    });

    expect(ajuste.permissions).toBeNull();
    expect(ajuste.allowedSurfaces).toBeNull();
  });

  /**
   * Nada é retirado.
   *
   * Uma permissão renomeada no catálogo apareceria aqui como sobra; retirá-la
   * no deploy tiraria acesso de quem está trabalhando naquele instante.
   */
  it('o que o catálogo não tem mais é relatado e mantido', () => {
    const ajuste = reconcileRole(
      { key: 'X', permissions: ['a', 'b'], allowedSurfaces: ['MOBILE'] },
      { key: 'X', permissions: ['a', 'legado'], allowedSurfaces: ['MOBILE'] },
    );

    expect(ajuste.extraPermissions).toEqual(['legado']);
    expect(ajuste.permissions).toEqual(['a', 'legado', 'b']);
  });

  /** A ordem do gravado fica; o que falta vai ao fim. */
  it('preserva a ordem gravada', () => {
    const ajuste = reconcileRole(
      { key: 'X', permissions: ['a', 'b', 'c'], allowedSurfaces: ['MOBILE'] },
      { key: 'X', permissions: ['c', 'a'], allowedSurfaces: ['MOBILE'] },
    );

    expect(ajuste.permissions).toEqual(['c', 'a', 'b']);
  });

  it('acrescenta superfície que faltar', () => {
    const ajuste = reconcileRole(
      { key: 'X', permissions: ['a'], allowedSurfaces: ['MOBILE', 'WEB'] },
      { key: 'X', permissions: ['a'], allowedSurfaces: ['MOBILE'] },
    );

    expect(ajuste.allowedSurfaces).toEqual(['MOBILE', 'WEB']);
    expect(ajuste.permissions).toBeNull();
  });
});
