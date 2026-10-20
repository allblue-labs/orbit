import { TeamRepository } from './team.repository';
import type { PrismaService, RlsTransaction } from '../../../database';
import {
  ASSIGNABLE_TEAM_ROLES,
  ASSISTANT_TECHNICIAN_ROLE_KEY,
  FIELD_TECHNICIAN_ROLE_KEY,
} from '../team-roles';
import { executesFieldWork } from '../../workforce/field-eligibility';

/**
 * O perfil profissional nasce com o cadastro de quem executa em campo.
 *
 * ## Por que o teste é do repositório
 *
 * Porque é a transação que importa. Um teste de serviço com repositório dublado
 * provaria que o serviço calculou um booleano — e o booleano estava certo mesmo
 * antes, do outro lado: quem não escrevia a linha era a transação. O dublê de
 * `tx` deixa a escrita visível, e é ela que o formulário de operação lê depois.
 */
describe('perfil de técnico de campo no cadastro', () => {
  const acessoDoPapel = (key: string) => {
    const seed = ASSIGNABLE_TEAM_ROLES.find((item) => item.key === key);
    if (!seed) throw new Error(`papel ausente do catálogo: ${key}`);
    return {
      permissions: seed.permissions,
      allowedSurfaces: seed.allowedSurfaces,
    };
  };

  const cadastrar = async (fieldTechnicianEnabled: boolean) => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-novo' }),
      },
      organizationMembership: { create: jest.fn().mockResolvedValue({}) },
      businessUnitMembership: { createMany: jest.fn().mockResolvedValue({}) },
      professionalProfile: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx),
    } as unknown as PrismaService;
    const repository = new TeamRepository(prisma, {} as RlsTransaction);

    const resultado = await repository.createMember(
      {
        organizationId: 'org',
        businessUnitIds: ['unit'],
        roleId: 'role',
        usesCustomAccess: false,
        customPermissions: [],
        customAllowedSurfaces: [],
        actorId: 'owner',
        email: 'joao@empresa.com',
        normalizedEmail: 'joao@empresa.com',
        firstName: 'João',
        lastName: 'Campo',
        passwordHash: 'hash',
        fieldTechnicianEnabled,
      },
      () => Promise.resolve(undefined),
    );
    return { tx, resultado };
  };

  /**
   * O defeito relatado, em um teste.
   *
   * Sem esta linha a pessoa é cadastrada como técnico e não aparece no seletor
   * de técnicos do formulário de operação — que lê `professional_profiles` —,
   * nem pode ser atribuída, porque `validateTechnicianAssignments` recusa quem
   * não está lá.
   */
  it('cria o perfil de quem executa em campo', async () => {
    const { tx, resultado } = await cadastrar(true);

    expect(resultado).toEqual({ userId: 'user-novo' });
    expect(tx.professionalProfile.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        userId: 'user-novo',
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: false,
        active: true,
      },
    });
  });

  /**
   * Responsabilidade técnica continua sendo ato explícito.
   *
   * É designação legal, com credencial de conselho atrás. Ligá-la junto faria o
   * cadastro afirmar uma capacidade que ninguém verificou — e ela é a que assina
   * documento técnico.
   */
  it('não concede responsabilidade técnica junto', async () => {
    const { tx } = await cadastrar(true);
    const [[chamada]] = tx.professionalProfile.create.mock.calls as [
      [{ data: { technicalResponsibleEnabled: boolean } }],
    ];
    expect(chamada.data.technicalResponsibleEnabled).toBe(false);
  });

  /** Quem não executa não ganha perfil: o auxiliar, o painel, o visualizador. */
  it('não cria perfil para quem não executa em campo', async () => {
    const { tx } = await cadastrar(false);
    expect(tx.professionalProfile.create).not.toHaveBeenCalled();
  });

  /** O vínculo é criado de todo jeito — o perfil é um extra, não um pré-requisito. */
  it('o cadastro acontece mesmo sem perfil profissional', async () => {
    const { tx, resultado } = await cadastrar(false);
    expect(resultado).toEqual({ userId: 'user-novo' });
    expect(tx.organizationMembership.create).toHaveBeenCalled();
    expect(tx.businessUnitMembership.createMany).toHaveBeenCalled();
  });

  /** O e-mail já usado para antes de qualquer escrita. */
  it('não escreve nada quando o e-mail já existe', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ja-existe' }),
        create: jest.fn(),
      },
      organizationMembership: { create: jest.fn() },
      businessUnitMembership: { createMany: jest.fn() },
      professionalProfile: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx),
    } as unknown as PrismaService;
    const repository = new TeamRepository(prisma, {} as RlsTransaction);

    const resultado = await repository.createMember(
      {
        organizationId: 'org',
        businessUnitIds: ['unit'],
        roleId: 'role',
        usesCustomAccess: false,
        customPermissions: [],
        customAllowedSurfaces: [],
        actorId: 'owner',
        email: 'joao@empresa.com',
        normalizedEmail: 'joao@empresa.com',
        firstName: 'João',
        lastName: 'Campo',
        passwordHash: 'hash',
        fieldTechnicianEnabled: true,
      },
      () => Promise.resolve(undefined),
    );

    expect(resultado).toEqual({ conflict: 'EMAIL_TAKEN' });
    expect(tx.professionalProfile.create).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  /**
   * A ponta que fecha o circuito.
   *
   * O repositório recebe um booleano; quem o calcula é o serviço, a partir do
   * acesso concedido. Se o catálogo mudar de forma que o técnico operador deixe
   * de passar por `executesFieldWork`, o cadastro volta a produzir técnicos
   * invisíveis — e é aqui que isso aparece.
   */
  it('o catálogo real faz o técnico operador passar, e o auxiliar não', () => {
    expect(executesFieldWork(acessoDoPapel(FIELD_TECHNICIAN_ROLE_KEY))).toBe(
      true,
    );
    expect(
      executesFieldWork(acessoDoPapel(ASSISTANT_TECHNICIAN_ROLE_KEY)),
    ).toBe(false);
  });
});
