import { OperationService } from './operation.service';
import { EntityNotFoundException, ValidationException } from '../../exceptions';

/**
 * Autorizar em lote.
 *
 * ## O que se prova
 *
 * Que o lote tem as mesmas regras da autorização individual — a organização precisa
 * exigir autorização, e só atendimento atribuído é autorizável — e que ele não
 * inventa carimbos: o que já estava autorizado não é recarimbado, e um id que não é
 * da organização derruba a chamada em vez de autorizar o resto em silêncio.
 */
describe('autorização em lote', () => {
  const montar = (options: {
    exige?: boolean;
    encontrados?: {
      id: string;
      authorizedAt: Date | null;
      responsibleFieldTechnicianId: string | null;
    }[];
  }) => {
    const repository = {
      organizationSettings: jest
        .fn()
        .mockResolvedValue(
          options.exige === false
            ? {}
            : { operations: { requireAssignmentAuthorization: true } },
        ),
      findIdsWithin: jest.fn().mockResolvedValue(options.encontrados ?? []),
      authorizeMany: jest
        .fn()
        .mockImplementation((_org, _actor, ids: string[]) =>
          Promise.resolve(ids.length),
        ),
    };
    const service = new OperationService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, repository };
  };

  const atribuido = (id: string, authorizedAt: Date | null = null) => ({
    id,
    authorizedAt,
    responsibleFieldTechnicianId: 'tecnico',
  });

  it('autoriza os atendimentos pendentes', async () => {
    const { service, repository } = montar({
      encontrados: [atribuido('um'), atribuido('dois')],
    });

    await expect(
      service.authorizeMany('org', 'owner', ['um', 'dois']),
    ).resolves.toEqual({ authorized: 2 });
    expect(repository.authorizeMany).toHaveBeenCalledWith('org', 'owner', [
      'um',
      'dois',
    ]);
  });

  /**
   * Duas pessoas podem clicar no mesmo botão.
   *
   * O segundo clique não deve falhar nem recarimbar: o estado desejado já é o que
   * está lá, e recarimbar trocaria a hora de quem autorizou de verdade.
   */
  it('não recarimba o que já estava autorizado', async () => {
    const { service, repository } = montar({
      encontrados: [
        atribuido('ja', new Date('2026-10-01T10:00:00.000Z')),
        atribuido('pendente'),
      ],
    });

    await expect(
      service.authorizeMany('org', 'owner', ['ja', 'pendente']),
    ).resolves.toEqual({ authorized: 1 });
    expect(repository.authorizeMany).toHaveBeenCalledWith('org', 'owner', [
      'pendente',
    ]);
  });

  it('lote todo já autorizado não escreve nada', async () => {
    const { service, repository } = montar({
      encontrados: [atribuido('ja', new Date())],
    });
    await expect(
      service.authorizeMany('org', 'owner', ['ja']),
    ).resolves.toEqual({ authorized: 0 });
    expect(repository.authorizeMany).toHaveBeenCalledWith('org', 'owner', []);
  });

  /**
   * Carimbar um atendimento sem responsável liberaria para o campo um trabalho que
   * não é de ninguém — e ele sairia da fila de pendências sem ter chegado a um
   * técnico.
   */
  it('recusa atendimento sem responsável', async () => {
    const { service, repository } = montar({
      encontrados: [
        atribuido('ok'),
        { id: 'orfao', authorizedAt: null, responsibleFieldTechnicianId: null },
      ],
    });

    await expect(
      service.authorizeMany('org', 'owner', ['ok', 'orfao']),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.authorizeMany).not.toHaveBeenCalled();
  });

  /**
   * Um id que não é da organização derruba a chamada inteira.
   *
   * Autorizar o resto e devolver "26 de 30" deixaria o dono sem saber quais quatro
   * ficaram fora nem por quê.
   */
  it('id desconhecido recusa o lote todo', async () => {
    const { service, repository } = montar({
      encontrados: [atribuido('existe')],
    });

    await expect(
      service.authorizeMany('org', 'owner', ['existe', 'de-outra-org']),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(repository.authorizeMany).not.toHaveBeenCalled();
  });

  /** Ids repetidos no corpo não fazem a conferência achar que faltou algum. */
  it('id repetido não reprova a conferência', async () => {
    const { service } = montar({ encontrados: [atribuido('um')] });
    await expect(
      service.authorizeMany('org', 'owner', ['um', 'um']),
    ).resolves.toEqual({ authorized: 1 });
  });

  /**
   * Onde a organização não exige autorização, carimbar não significa nada — e
   * confundiria a trilha, porque alguém leria "autorizado por" e concluiria que
   * existe uma etapa que ninguém cumpre.
   */
  it('recusa quando a organização não exige autorização', async () => {
    const { service, repository } = montar({
      exige: false,
      encontrados: [atribuido('um')],
    });

    await expect(
      service.authorizeMany('org', 'owner', ['um']),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.findIdsWithin).not.toHaveBeenCalled();
    expect(repository.authorizeMany).not.toHaveBeenCalled();
  });
});
