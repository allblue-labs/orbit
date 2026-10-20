import { IssuedDocumentQueryDto } from './issued-document.dto';
import { IssuedDocumentService } from './issued-document.service';

/**
 * O envelope de paginação.
 *
 * Parece aritmética trivial e é onde a tela mente: `hasNextPage` errado deixa o
 * botão "próxima" aceso numa lista que acabou, e `totalPages` arredondado para
 * baixo esconde a última página inteira.
 */
describe('IssuedDocumentService', () => {
  const listar = (
    total: number,
    patch: Partial<IssuedDocumentQueryDto> = {},
  ) => {
    const repository = {
      page: jest.fn().mockResolvedValue({ data: [], total }),
    };
    const service = new IssuedDocumentService(repository as never);
    const query = Object.assign(new IssuedDocumentQueryDto(), patch);
    return service.list('org', query);
  };

  it('reparte o total em páginas, arredondando para cima', async () => {
    const { meta } = await listar(41, { page: 1, limit: 20 });
    /* 41 em páginas de 20 são três páginas: arredondar para baixo esconderia a
       linha 41 em uma página que a tela diria não existir. */
    expect(meta.totalPages).toBe(3);
  });

  it('a página exata não cria uma página vazia a mais', async () => {
    const { meta } = await listar(40, { page: 1, limit: 20 });
    expect(meta.totalPages).toBe(2);
  });

  it('sem nada emitido, não há página nenhuma', async () => {
    const { meta } = await listar(0);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('a primeira página tem próxima e não tem anterior', async () => {
    const { meta } = await listar(41, { page: 1, limit: 20 });
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('a última página tem anterior e não tem próxima', async () => {
    const { meta } = await listar(41, { page: 3, limit: 20 });
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('o meio tem as duas', async () => {
    const { meta } = await listar(100, { page: 3, limit: 20 });
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('devolve a página e o total como vieram do banco', async () => {
    const repository = {
      page: jest.fn().mockResolvedValue({ data: [{ id: 'um' }], total: 7 }),
    };
    const service = new IssuedDocumentService(repository as never);
    const resultado = await service.list(
      'org',
      Object.assign(new IssuedDocumentQueryDto(), { page: 1, limit: 20 }),
    );
    expect(resultado.data).toEqual([{ id: 'um' }]);
    expect(resultado.meta).toMatchObject({ total: 7, page: 1, limit: 20 });
    expect(repository.page).toHaveBeenCalledWith('org', expect.anything());
  });
});
