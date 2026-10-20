/**
 * A marca da unidade, no caminho de escrita.
 *
 * O que se guarda aqui é o que a validação precisa recusar. O logo é conteúdo
 * que o inquilino envia e que termina desenhado dentro de um PDF gerado no
 * servidor — o caminho feliz é o menos interessante.
 */
import { BusinessUnitService } from './business-unit.service';
import {
  EntityNotFoundException,
  ValidationException,
} from '../../../exceptions';
import type { BusinessUnitRepository } from './business-unit.repository';
import type { EntitlementService } from '../../subscription-plans/entitlements/entitlement.service';

/** PNG 1×1 válido, o menor que dá para escrever à mão. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function montar(unidade: unknown = { id: 'unit-1' }) {
  const repository = {
    find: jest.fn().mockResolvedValue(unidade),
    setLogo: jest
      .fn()
      .mockImplementation((id: string, logoUrl: string | null) =>
        Promise.resolve({ id, logoUrl }),
      ),
  };
  /* O caminho da marca não consulta entitlements; o stub existe para o
     construtor, não para o teste. */
  const service = new BusinessUnitService(
    repository as unknown as BusinessUnitRepository,
    {} as unknown as EntitlementService,
  );
  return { service, repository };
}

describe('marca da unidade de negócio', () => {
  it('grava o data URI quando a imagem é válida', async () => {
    const { service, repository } = montar();

    const resultado = await service.setLogo('unit-1', 'org-1', PNG);

    expect(repository.setLogo).toHaveBeenCalledWith('unit-1', PNG);
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
      await expect(
        service.setLogo('unit-1', 'org-1', url),
      ).rejects.toBeInstanceOf(ValidationException);
    }
    expect(repository.setLogo).not.toHaveBeenCalled();
  });

  it('recusa SVG, que é documento e não imagem', async () => {
    const { service, repository } = montar();

    await expect(
      service.setLogo(
        'unit-1',
        'org-1',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      ),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.setLogo).not.toHaveBeenCalled();
  });

  it('recusa imagem acima do limite', async () => {
    const { service } = montar();

    await expect(
      service.setLogo(
        'unit-1',
        'org-1',
        `data:image/png;base64,${'A'.repeat(700_000)}`,
      ),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('não grava em unidade de outra organização', async () => {
    const { service, repository } = montar(null);

    await expect(
      service.setLogo('unit-1', 'org-1', PNG),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(repository.setLogo).not.toHaveBeenCalled();

    /* Unidade inexistente **e** imagem inválida devolve "não existe", não
       "imagem inválida": a existência é checada primeiro, e a resposta não
       muda conforme o corpo enviado. */
    await expect(
      service.setLogo('unit-1', 'org-1', 'https://exemplo.com/logo.png'),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('remove a marca sem apagar a unidade', async () => {
    const { service, repository } = montar();

    const resultado = await service.removeLogo('unit-1', 'org-1');

    expect(repository.setLogo).toHaveBeenCalledWith('unit-1', null);
    expect(resultado.logoUrl).toBeNull();
  });
});
