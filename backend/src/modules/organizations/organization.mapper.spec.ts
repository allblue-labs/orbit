import { OrganizationReadModelMapper } from './organization.mapper';

describe('OrganizationReadModelMapper', () => {
  it('maps organization context and removes persistence-only fields', () => {
    const mapper = new OrganizationReadModelMapper();
    const unit = {
      id: 'unit-1',
      organizationId: 'org-1',
      parentId: null,
      slug: 'main',
      code: null,
      type: 'HEADQUARTERS' as const,
      isPrimary: true,
      legalName: 'Orbit Ltda',
      tradeName: 'Orbit',
      documentType: 'CNPJ',
      documentNumber: '11222333000181',
      city: 'Recife',
      street: 'Rua A',
      number: null,
      stateCode: 'PE',
      postalCode: null,
      email: null,
      phone: null,
      timezone: 'America/Recife',
      locale: 'pt-BR',
      currency: 'BRL',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    };
    const result = mapper.context({
      id: 'org-1',
      ownerUserId: 'user-1',
      planId: 'plan-1',
      slug: 'orbit',
      displayName: 'Orbit',
      primarySegment: 'SERVICES',
      status: 'ACTIVE',
      subscriptionStatus: 'TRIALING',
      subscriptionStartedAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      settings: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      plan: {
        id: 'plan-1',
        key: 'STARTER',
        name: 'Starter',
        description: null,
        monthlyPrice: { toString: () => '99.90' },
        annualPrice: null,
        currency: 'BRL',
        capabilities: ['operations.read'],
        limits: { users: 5 },
        isActive: true,
      },
      businessUnits: [unit],
    });

    expect(result.plan.monthlyPrice).toBe('99.90');
    expect(result.businessUnits[0]).not.toHaveProperty('deletedAt');
  });

  /*
   * `GET current` é pedido em cada navegação e a marca chega a meio megabyte.
   * O Read Model publica o fato — há marca ou não — e a imagem se pede em
   * `current/logo`. Se o data URI escapar para cá, toda tela paga por ele.
   */
  it('publica se há marca, nunca a imagem', () => {
    const mapper = new OrganizationReadModelMapper();
    const marca = 'data:image/png;base64,ZW1wcmVzYQ==';

    const comMarca = mapper.context(organizacao({ logoUrl: marca }));
    expect(comMarca.hasLogo).toBe(true);
    expect(comMarca).not.toHaveProperty('logoUrl');
    expect(JSON.stringify(comMarca)).not.toContain(marca);

    expect(mapper.context(organizacao({ logoUrl: null })).hasLogo).toBe(false);
    expect(mapper.context(organizacao({})).hasLogo).toBe(false);
  });
});

/*
 * Quem escolhe um responsável precisa saber se o documento sairá assinado. O que
 * se publica é **o fato**, nunca a imagem: espalhá-la pelo navegador não atende
 * nenhuma pergunta que o booleano já não atenda, e o gerador a lê no servidor.
 */
describe('assinatura do membro', () => {
  const mapper = new OrganizationReadModelMapper();

  const membro = (assinaturas: readonly { id: string }[] | undefined) => [
    {
      userId: 'user-1',
      status: 'ACTIVE',
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: {
        id: 'user-1',
        displayName: 'Marcos Tavares',
        email: 'marcos@exemplo.com',
        avatarUrl: null,
        status: 'ACTIVE',
        professionalSignatures: assinaturas,
      },
      usesCustomAccess: false,
      customPermissions: [],
      customAllowedSurfaces: [],
      role: {
        id: 'role-1',
        key: 'TECHNICIAN',
        name: 'Técnico',
        permissions: [],
        allowedSurfaces: [],
      },
    },
  ];

  it('diz que há assinatura, sem devolver a imagem', () => {
    const [resultado] = mapper.members(membro([{ id: 'sig-1' }]), 'owner-1');

    expect(resultado!.hasSignature).toBe(true);
    expect(JSON.stringify(resultado)).not.toContain('sig-1');
  });

  it('diz que não há quando a pessoa nunca cadastrou', () => {
    expect(mapper.members(membro([]), 'owner-1')[0]!.hasSignature).toBe(false);
  });

  /* A consulta filtra por `active` e `revokedAt`, então assinatura revogada
     chega como lista vazia. Ausente é o caso de quem projetou sem o campo. */
  it('trata ausência do campo como sem assinatura, e não estoura', () => {
    expect(mapper.members(membro(undefined), 'owner-1')[0]!.hasSignature).toBe(
      false,
    );
  });
});

/** O mínimo que `context` aceita, para variar um campo por vez. */
function organizacao(overrides: { logoUrl?: string | null }) {
  return {
    id: 'org-1',
    ownerUserId: 'user-1',
    planId: 'plan-1',
    slug: 'orbit',
    displayName: 'Orbit',
    primarySegment: 'SERVICES',
    status: 'ACTIVE',
    subscriptionStatus: 'TRIALING',
    subscriptionStartedAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    plan: {
      id: 'plan-1',
      key: 'STARTER',
      name: 'Starter',
      description: null,
      monthlyPrice: { toString: () => '99.90' },
      annualPrice: null,
      currency: 'BRL',
      capabilities: ['operations.read'],
      limits: { users: 5 },
      isActive: true,
    },
    businessUnits: [],
    ...overrides,
  };
}
