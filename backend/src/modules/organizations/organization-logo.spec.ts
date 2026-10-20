/**
 * A marca da empresa, no caminho de escrita.
 *
 * Mesma política do logo de unidade — a imagem é conteúdo que o inquilino envia
 * e que termina desenhada dentro de um PDF gerado no servidor, então o que
 * interessa é o que a validação recusa. O caso próprio desta rota é a leitura
 * separada: a imagem **não** viaja em `GET current`, e aqui se prova que a
 * escrita e a leitura usam a consulta enxuta, não a organização inteira.
 */
import { OrganizationService } from './organization.service';
import { EntityNotFoundException, ValidationException } from '../../exceptions';
import type { OrganizationRepository } from './organization.repository';
import type { AuthorizationService } from '../../common';

/** PNG 1×1 válido, o menor que dá para escrever à mão. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function montar(organizacao: unknown = { id: 'org-1', logoUrl: null }) {
  const repository = {
    findLogo: jest.fn().mockResolvedValue(organizacao),
    findCurrent: jest.fn().mockResolvedValue({ id: 'org-1' }),
    setLogo: jest
      .fn()
      .mockImplementation((id: string, logoUrl: string | null) =>
        Promise.resolve({ id, logoUrl }),
      ),
  };
  const service = new OrganizationService(
    repository as unknown as OrganizationRepository,
    {} as unknown as AuthorizationService,
  );
  return { service, repository };
}

describe('marca da empresa', () => {
  it('grava o data URI quando a imagem é válida', async () => {
    const { service, repository } = montar();

    const resultado = await service.setLogo('org-1', PNG);

    expect(repository.setLogo).toHaveBeenCalledWith('org-1', PNG);
    expect(resultado.logoUrl).toBe(PNG);
  });

  it('recusa URL, que o servidor teria de buscar', async () => {
    const { service, repository } = montar();

    /* Buscar um endereço escolhido pelo inquilino é SSRF, com a rede interna
       ao alcance. */
    for (const url of [
      'https://exemplo.com/logo.png',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
    ]) {
      await expect(service.setLogo('org-1', url)).rejects.toBeInstanceOf(
        ValidationException,
      );
    }
    expect(repository.setLogo).not.toHaveBeenCalled();
  });

  it('recusa SVG, que é documento e não imagem', async () => {
    const { service, repository } = montar();

    await expect(
      service.setLogo('org-1', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.setLogo).not.toHaveBeenCalled();
  });

  it('recusa imagem acima do limite', async () => {
    const { service } = montar();

    await expect(
      service.setLogo('org-1', `data:image/png;base64,${'A'.repeat(700_000)}`),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('não grava em organização que a sessão não alcança', async () => {
    const { service, repository } = montar(null);

    await expect(service.setLogo('org-1', PNG)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
    expect(repository.setLogo).not.toHaveBeenCalled();

    /* Organização inalcançável **e** imagem inválida devolve "não existe", não
       "imagem inválida": a existência é checada primeiro, e a resposta não muda
       conforme o corpo enviado. */
    await expect(
      service.setLogo('org-1', 'https://exemplo.com/logo.png'),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('remove a marca sem apagar mais nada', async () => {
    const { service, repository } = montar();

    const resultado = await service.removeLogo('org-1');

    expect(repository.setLogo).toHaveBeenCalledWith('org-1', null);
    expect(resultado.logoUrl).toBeNull();
  });

  /*
   * A imagem chega a meio megabyte e `GET current` é pedido em cada navegação.
   * Se a marca viesse de `findCurrent`, a resposta que carrega plano e unidades
   * carregaria a imagem junto — de graça, em toda tela.
   */
  it('lê a marca pela consulta enxuta, não pela organização inteira', async () => {
    const { service, repository } = montar({ id: 'org-1', logoUrl: PNG });

    const resultado = await service.getLogo('org-1');

    expect(resultado.logoUrl).toBe(PNG);
    expect(repository.findLogo).toHaveBeenCalledWith('org-1');
    expect(repository.findCurrent).not.toHaveBeenCalled();
  });

  it('escrever também não carrega a organização inteira', async () => {
    const { service, repository } = montar();

    await service.setLogo('org-1', PNG);

    expect(repository.findCurrent).not.toHaveBeenCalled();
  });
});
