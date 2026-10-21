import { TeamRepository } from './team.repository';
import { TeamService, type TeamActor } from './team.service';
import type { PrismaService, RlsTransaction } from '../../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../../exceptions';

/**
 * Correção do nome e do e-mail de quem a organização cadastrou.
 *
 * O cadastro direto existe porque o owner digita os dados de quem não conclui
 * um cadastro sozinho — e um erro de digitação ali não tinha conserto: o nome
 * errado saía em todo documento, e o e-mail errado tirava da pessoa o fluxo
 * público de recuperar senha.
 */
describe('correção de identidade de um membro', () => {
  /* ---------------------------------------------------------------- */
  /* Transação                                                         */
  /* ---------------------------------------------------------------- */

  const transacao = (
    atual: {
      firstName: string;
      lastName: string;
      normalizedEmail: string;
    } | null,
  ) => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        /* O tipo é a união das duas consultas que o método faz: a pessoa, pelo
           id, e o dono do e-mail, pelo índice único. */
        findUnique: jest.fn<
          Promise<Record<string, unknown> | null>,
          [{ where: { id?: string; normalizedEmail?: string } }]
        >(({ where }) => Promise.resolve(where.id ? atual : null)),
        /* Tipado para que o teste possa olhar **quais chaves** chegaram:
           `toHaveBeenCalledWith` ignora chave com valor `undefined`, e é
           exatamente a diferença entre "não mexa no e-mail" e "apague-o". */
        update: jest.fn(
          (args: { where: { id: string }; data: Record<string, unknown> }) =>
            Promise.resolve(args),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx),
    } as unknown as PrismaService;
    return { tx, repository: new TeamRepository(prisma, {} as RlsTransaction) };
  };

  const pessoa = {
    firstName: 'Marcos',
    lastName: 'Tavares',
    normalizedEmail: 'marcos@empresa.com',
  };

  const corrigir = (
    tx: ReturnType<typeof transacao>['tx'],
    repository: TeamRepository,
    input: Partial<{
      email: string;
      normalizedEmail: string;
      firstName: string;
      lastName: string;
    }>,
  ) =>
    repository
      .updateMemberIdentity({
        organizationId: 'org',
        userId: 'user-1',
        actorId: 'owner',
        ...input,
      })
      .then((resultado) => ({ resultado, tx }));

  /**
   * `displayName` é derivado, e deixá-lo parado era o defeito escondido: a
   * correção aparecia na listagem — que lê o nome composto — e continuava
   * errada em todo documento emitido depois.
   */
  it('recompõe o nome de exibição a partir das duas partes', async () => {
    const { tx, repository } = transacao(pessoa);

    await corrigir(tx, repository, { firstName: 'Marco' });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        firstName: 'Marco',
        lastName: 'Tavares',
        displayName: 'Marco Tavares',
      },
    });
  });

  /**
   * Sem e-mail no corpo, nenhuma das duas colunas é tocada.
   *
   * Escrever `email: undefined` as apagaria — e apagar o e-mail de alguém é
   * tirar dela qualquer caminho de volta para a conta.
   */
  it('não mexe no e-mail quando ele não foi informado', async () => {
    const { tx, repository } = transacao(pessoa);

    await corrigir(tx, repository, { lastName: 'Tavares Filho' });

    const { data } = tx.user.update.mock.calls[0]![0];
    expect(Object.keys(data).sort()).toEqual([
      'displayName',
      'firstName',
      'lastName',
    ]);
  });

  it('grava as duas colunas de e-mail quando ele muda', async () => {
    const { tx, repository } = transacao(pessoa);

    await corrigir(tx, repository, {
      email: 'Marcos.Tavares@empresa.com',
      normalizedEmail: 'marcos.tavares@empresa.com',
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        firstName: 'Marcos',
        lastName: 'Tavares',
        displayName: 'Marcos Tavares',
        email: 'Marcos.Tavares@empresa.com',
        normalizedEmail: 'marcos.tavares@empresa.com',
      },
    });
  });

  /**
   * O e-mail é único no Orbit inteiro, e a recusa tem de chegar como regra.
   *
   * Sem esta verificação dentro da transação, a escrita estouraria como violação
   * de índice único — erro 500 onde a resposta correta é 409.
   */
  it('recusa um e-mail que já tem conta', async () => {
    const { tx, repository } = transacao(pessoa);
    tx.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; normalizedEmail?: string } }) =>
        Promise.resolve(where.id ? pessoa : { id: 'outro-user' }),
    );

    const { resultado } = await corrigir(tx, repository, {
      email: 'ocupado@empresa.com',
      normalizedEmail: 'ocupado@empresa.com',
    });

    expect(resultado).toEqual({ conflict: 'EMAIL_TAKEN' });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  /** O mesmo endereço que a pessoa já tem não é conflito com ela mesma. */
  it('aceita reenviar o e-mail atual', async () => {
    const { tx, repository } = transacao(pessoa);
    tx.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; normalizedEmail?: string } }) =>
        Promise.resolve(where.id ? pessoa : { id: 'user-1' }),
    );

    const { resultado } = await corrigir(tx, repository, {
      email: 'marcos@empresa.com',
      normalizedEmail: 'marcos@empresa.com',
      firstName: 'Marcos',
    });

    expect(resultado).toEqual({ updated: true });
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('não registra auditoria de quem não existe', async () => {
    const { tx, repository } = transacao(null);

    const { resultado } = await corrigir(tx, repository, { firstName: 'X' });

    expect(resultado).toEqual({ missing: true });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- */
  /* Regras do serviço                                                 */
  /* ---------------------------------------------------------------- */

  const owner: TeamActor = {
    organizationId: 'org',
    userId: 'owner',
    permissions: ['*'],
    allowedSurfaces: ['WEB'],
    businessUnitIds: [],
    isOrganizationOwner: true,
  };

  const servico = (ownerUserId: string) => {
    const team = {
      findMember: jest.fn().mockResolvedValue({
        userId: 'user-1',
        user: { email: 'marcos@empresa.com' },
      }),
      updateMemberIdentity: jest.fn().mockResolvedValue({ updated: true }),
    };
    const organizations = {
      findCurrent: jest.fn().mockResolvedValue({ ownerUserId }),
      listBusinessUnitMemberships: jest.fn().mockResolvedValue([]),
    };
    const service = new TeamService(
      team as unknown as TeamRepository,
      organizations as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, team };
  };

  /**
   * O dono fica fora, e por segurança — não por simetria.
   *
   * Quem administra membros poderia apontar o e-mail do dono para um endereço
   * próprio e, pelo fluxo público de recuperação de senha, assumir a conta. É a
   * mesma razão pela qual `issuePasswordLink` recusa o dono.
   */
  it('recusa corrigir os dados do dono da organização', async () => {
    const { service, team } = servico('user-1');

    await expect(
      service.updateMemberIdentity(owner, 'user-1', { firstName: 'Outro' }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(team.updateMemberIdentity).not.toHaveBeenCalled();
  });

  it('recusa um corpo sem nenhum campo', async () => {
    const { service, team } = servico('outro-owner');

    await expect(
      service.updateMemberIdentity(owner, 'user-1', {}),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(team.findMember).not.toHaveBeenCalled();
  });

  it('traduz o conflito do repositório em 409', async () => {
    const { service, team } = servico('outro-owner');
    team.updateMemberIdentity.mockResolvedValue({ conflict: 'EMAIL_TAKEN' });

    await expect(
      service.updateMemberIdentity(owner, 'user-1', {
        email: 'ocupado@empresa.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /**
   * Sem este 404 a escrita aconteceria: `User` é global, não tem inquilino, e
   * `updateMemberIdentity` recebe só o `userId`. Quem administra uma organização
   * passaria a corrigir o nome de alguém de outra — por isso o teste cobra que a
   * escrita **não** seja chamada, e não apenas que a resposta seja 404.
   */
  it('recusa quem não é membro da organização, sem escrever', async () => {
    const { service, team } = servico('outro-owner');
    team.findMember.mockResolvedValue(null);

    await expect(
      service.updateMemberIdentity(owner, 'user-1', { firstName: 'X' }),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(team.updateMemberIdentity).not.toHaveBeenCalled();
  });

  /** O e-mail chega normalizado para o índice único, e preservado para exibir. */
  it('normaliza o e-mail antes de gravar', async () => {
    const { service, team } = servico('outro-owner');

    await service.updateMemberIdentity(owner, 'user-1', {
      email: 'Marcos.Tavares@Empresa.com',
    });

    expect(team.updateMemberIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'Marcos.Tavares@Empresa.com',
        normalizedEmail: 'marcos.tavares@empresa.com',
      }),
    );
  });
});
