/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { WorkforceRepository } from './workforce.repository';

/**
 * Quem pode acompanhar um atendimento como auxiliar.
 *
 * ## Por que o teste é do repositório
 *
 * Porque é aqui que a regra é aplicada, e de propósito: há dois chamadores — o
 * seletor do formulário e a validação da atribuição — e um deles confiando na
 * lista crua enquanto o outro filtra seria um portão aberto. Um teste de serviço
 * com repositório dublado não veria nem o `where` nem o recorte.
 */
describe('candidatos a auxiliar de campo', () => {
  const vinculo = (
    userId: string,
    role: { permissions: string[]; allowedSurfaces: string[] },
    override?: {
      usesCustomAccess: boolean;
      customPermissions: string[];
      customAllowedSurfaces: string[];
    },
  ) => ({
    userId,
    usesCustomAccess: override?.usesCustomAccess ?? false,
    customPermissions: override?.customPermissions ?? [],
    customAllowedSurfaces: override?.customAllowedSurfaces ?? [],
    role,
    user: { displayName: `Pessoa ${userId}` },
  });

  const campo = {
    permissions: ['operations.read', 'operations.status.update'],
    allowedSurfaces: ['MOBILE'],
  };
  const auxiliar = {
    permissions: ['operations.read'],
    allowedSurfaces: ['MOBILE'],
  };
  const painel = {
    permissions: ['operations.read', 'operations.update'],
    allowedSurfaces: ['WEB'],
  };

  const consultar = async (
    vinculos: ReturnType<typeof vinculo>[],
    businessUnitId?: string,
  ) => {
    const tx = {
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue(vinculos),
      },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new WorkforceRepository(rls as never);
    const resultado = await repository.listFieldAssistantCandidates(
      'org',
      businessUnitId,
    );
    return { tx, resultado };
  };

  /** O caso que motivou tudo: o papel auxiliar precisa poder ser auxiliar. */
  it('traz o auxiliar técnico, que não tem perfil profissional', async () => {
    const { resultado } = await consultar([vinculo('aux', auxiliar)]);
    expect(resultado.map((item) => item.userId)).toEqual(['aux']);
  });

  it('traz também o técnico de campo — ele lê tudo o que o auxiliar lê', async () => {
    const { resultado } = await consultar([
      vinculo('aux', auxiliar),
      vinculo('tec', campo),
    ]);
    expect(resultado.map((item) => item.userId)).toEqual(['aux', 'tec']);
  });

  /** Sem o aplicativo de campo não há como acompanhar em campo. */
  it('deixa de fora quem só tem o painel', async () => {
    const { resultado } = await consultar([vinculo('gestor', painel)]);
    expect(resultado).toEqual([]);
  });

  it('deixa de fora quem não lê atendimento', async () => {
    const { resultado } = await consultar([
      vinculo('estoque', {
        permissions: ['inventory.read'],
        allowedSurfaces: ['MOBILE'],
      }),
    ]);
    expect(resultado).toEqual([]);
  });

  /**
   * O override do membro substitui o papel.
   *
   * Recortar o acesso de alguém para fora do aplicativo tira-o da lista mesmo
   * que o papel de origem o incluísse — ler o papel aqui devolveria à pessoa uma
   * autoridade que o dono tirou dela.
   */
  it('respeita o recorte de acesso do membro', async () => {
    const { resultado } = await consultar([
      vinculo('recortado', campo, {
        usesCustomAccess: true,
        customPermissions: ['operations.read'],
        customAllowedSurfaces: ['WEB'],
      }),
    ]);
    expect(resultado).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* O que a consulta pede ao banco                                    */
  /* ---------------------------------------------------------------- */

  it('pede só vínculo e pessoa ativos', async () => {
    const { tx } = await consultar([]);
    const [[query]] = tx.organizationMembership.findMany.mock.calls;
    expect(query.where).toMatchObject({
      organizationId: 'org',
      status: 'ACTIVE',
      deletedAt: null,
      user: { status: 'ACTIVE', deletedAt: null },
    });
  });

  /**
   * A unidade do atendimento entra na consulta.
   *
   * `validateTechnicianAssignments` confere a elegibilidade na unidade do
   * atendimento; sem este recorte, a lista ofereceria o elenco da organização
   * inteira e o servidor recusaria a escolha no envio.
   */
  it('recorta pela unidade quando ela é informada', async () => {
    const { tx } = await consultar([], 'unidade');
    const [[query]] = tx.organizationMembership.findMany.mock.calls;
    expect(query.where.user.businessUnitMemberships).toEqual({
      some: {
        organizationId: 'org',
        businessUnitId: 'unidade',
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
  });

  /** Sem unidade, a pergunta é da organização — e não um recorte vazio. */
  it('sem unidade, não inventa recorte de unidade', async () => {
    const { tx } = await consultar([]);
    const [[query]] = tx.organizationMembership.findMany.mock.calls;
    expect(query.where.user.businessUnitMemberships).toBeUndefined();
  });

  /** O acesso efetivo precisa vir do banco, ou a regra decide sobre nada. */
  it('seleciona o acesso do papel e o override do membro', async () => {
    const { tx } = await consultar([]);
    const [[query]] = tx.organizationMembership.findMany.mock.calls;
    expect(query.select).toMatchObject({
      userId: true,
      usesCustomAccess: true,
      customPermissions: true,
      customAllowedSurfaces: true,
      role: { select: { permissions: true, allowedSurfaces: true } },
    });
  });
});
