/**
 * O filtro da listagem de execuções.
 *
 * A central documental pergunta "cadê o documento", e a resposta é uma
 * consulta: por cliente, por tipo, por período, pelo estado da emissão. Errar
 * aqui não quebra a tela — devolve a lista errada, que é pior, porque ninguém
 * desconfia de uma lista.
 */
import { executionFilter } from './artifact-execution.repository';
import type { ArtifactExecutionQueryDto } from './dto/artifact-execution.dto';

const ORG = '11111111-1111-1111-1111-111111111111';

function query(
  overrides: Partial<ArtifactExecutionQueryDto> = {},
): ArtifactExecutionQueryDto {
  return { page: 1, limit: 20, ...overrides };
}

describe('executionFilter', () => {
  it('sempre limita à organização e esconde o que foi apagado', () => {
    expect(executionFilter(ORG, query())).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
    });
  });

  it('não cria recorte de período quando nenhuma data vem', () => {
    /* `createdAt: {}` seria um objeto vazio inofensivo hoje e um filtro
       silencioso no dia em que alguém acrescentar um campo padrão. */
    expect(executionFilter(ORG, query())).not.toHaveProperty('createdAt');
  });

  it('filtra o estado da emissão, que não é o status da execução', () => {
    const filter = executionFilter(
      ORG,
      query({ renderStatus: 'READY', status: 'UNDER_REVIEW' }),
    );

    expect(filter.renderStatus).toBe('READY');
    expect(filter.status).toBe('UNDER_REVIEW');
  });

  it('filtra o tipo pelo snapshot, não pelo template', () => {
    const filter = executionFilter(ORG, query({ artifactType: 'RVT' }));

    expect(filter.snapshot).toEqual({ artifactType: 'RVT' });
    expect(filter).not.toHaveProperty('templateId');
  });

  it('inclui o dia inteiro quando o fim do período vem sem hora', () => {
    const filter = executionFilter(ORG, query({ createdTo: '2026-03-31' }));

    expect(filter.createdAt).toEqual({
      lte: new Date('2026-03-31T23:59:59.999Z'),
    });
  });

  it('respeita o instante quando o fim do período vem com hora', () => {
    const filter = executionFilter(
      ORG,
      query({ createdTo: '2026-03-31T10:00:00.000Z' }),
    );

    expect(filter.createdAt).toEqual({
      lte: new Date('2026-03-31T10:00:00.000Z'),
    });
  });

  it('aceita período aberto de um lado só', () => {
    expect(
      executionFilter(ORG, query({ createdFrom: '2026-03-01' })).createdAt,
    ).toEqual({ gte: new Date('2026-03-01T00:00:00.000Z') });
  });

  it('busca por código e por título, sem diferenciar maiúsculas', () => {
    const filter = executionFilter(ORG, query({ search: 'rvt-2026' }));

    expect(filter.OR).toEqual([
      { code: { contains: 'rvt-2026', mode: 'insensitive' } },
      { title: { contains: 'rvt-2026', mode: 'insensitive' } },
    ]);
  });
});
