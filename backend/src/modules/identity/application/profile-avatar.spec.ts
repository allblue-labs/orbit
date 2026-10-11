/**
 * A foto no perfil de quem está autenticado.
 *
 * ## O defeito que isto prende
 *
 * `/identity/me` publicava `avatarUrl` lendo `users.avatar_url` — coluna
 * resquício de quando a foto era um endereço solto. Hoje a foto é um arquivo
 * servido por URL assinada e temporária, e uma URL que expira não cabe numa
 * coluna persistida: ela **nunca** é escrita.
 *
 * O efeito foi observado em produção local — o dono trocou a foto três vezes
 * com sucesso (`avatar_storage_file_id` preenchido, upload 200, ativação 200) e
 * `avatar_url` seguia nula. O aplicativo, que lê esse campo, mostrava as
 * iniciais: a foto ficava gravada e invisível.
 *
 * A web não sofria porque pede a foto a `/identity/me/avatar`, que a assina na
 * hora.
 */
import { EntityNotFoundException } from '../../../exceptions';
import { ProfileService } from './profile.service';

const USUARIO = '01900000-0000-7000-8000-000000000001';
const ORGANIZACAO = '01900000-0000-7000-8000-000000000002';

function bancada(avatar: { url: string | null }) {
  const repository = {
    findById: jest.fn().mockResolvedValue({
      id: USUARIO,
      email: 'dono@exemplo.com',
      firstName: 'Darlan',
      lastName: 'Simplicio',
      displayName: 'Darlan Simplicio',
      phone: null,
      /* A coluna velha, nula como está no banco de verdade. */
      avatarUrl: null,
      locale: 'pt-BR',
      timezone: 'America/Recife',
      status: 'ACTIVE',
      emailVerifiedAt: null,
      mfaFactors: [],
      mustChangePassword: false,
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
    updateProfile: jest.fn(),
  };
  const avatars = { view: jest.fn().mockResolvedValue(avatar) };
  const service = new ProfileService(
    repository as never,
    {} as never,
    avatars as never,
  );
  return { service, repository, avatars };
}

describe('o perfil publica a foto que existe', () => {
  it('devolve a URL assinada, e não a coluna nula', async () => {
    const { service } = bancada({ url: 'https://api/objects?signature=abc' });

    const perfil = await service.get(USUARIO, ORGANIZACAO);

    expect(perfil.avatarUrl).toBe('https://api/objects?signature=abc');
  });

  it('sem foto, o campo é nulo — e é verdade', async () => {
    const { service } = bancada({ url: null });

    await expect(service.get(USUARIO, ORGANIZACAO)).resolves.toMatchObject({
      avatarUrl: null,
    });
  });

  it('a foto é buscada para o dono certo, na organização certa', async () => {
    /* `availableFile` é escopado por organização: passar a errada devolveria
       "sem foto" para quem tem uma. */
    const { service, avatars } = bancada({ url: 'https://api/x' });

    await service.get(USUARIO, ORGANIZACAO);

    expect(avatars.view).toHaveBeenCalledWith({
      id: USUARIO,
      organizationId: ORGANIZACAO,
    });
  });

  it('usuário inexistente não chega a pedir foto', async () => {
    const { service, repository, avatars } = bancada({ url: null });
    repository.findById.mockResolvedValue(null);

    await expect(service.get(USUARIO, ORGANIZACAO)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
    expect(avatars.view).not.toHaveBeenCalled();
  });
});

describe('o que não precisa da foto não a busca', () => {
  /*
   * `get` assina uma URL de storage. Usá-lo para confirmar existência
   * acoplaria a troca de nome e o cadastro de MFA ao provedor de arquivos —
   * uma indisponibilidade lá derrubaria os dois sem motivo.
   */
  it('atualizar o perfil não toca no storage', async () => {
    const { service, avatars, repository } = bancada({ url: null });

    await service.update(USUARIO, { displayName: 'Darlan S.' });

    expect(avatars.view).not.toHaveBeenCalled();
    expect(repository.updateProfile).toHaveBeenCalled();
  });

  it('o e-mail para o MFA não toca no storage', async () => {
    const { service, avatars } = bancada({ url: null });

    await expect(service.email(USUARIO)).resolves.toBe('dono@exemplo.com');
    expect(avatars.view).not.toHaveBeenCalled();
  });
});
