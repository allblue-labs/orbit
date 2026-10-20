/**
 * O rascunho não emite.
 *
 * Esta é a propriedade que o preview precisa ter e que nenhuma inspeção dos
 * bytes revela: pedir para ver **não pode** enfileirar trabalho, abrir revisão
 * nem passar pela política de emissão. Se um dia alguém "unificar" o preview
 * com a emissão para reaproveitar código, é aqui que o cliente descobre antes
 * do seu histórico encher de documentos que ninguém pediu.
 */
import { ArtifactRenderService } from './artifact-render.service';
import { EntityNotFoundException } from '../../exceptions';
import type { RenderActor } from './artifact-render.service';

const ATOR: RenderActor = { organizationId: 'org-1', actorId: 'user-1' };

function montar(source: unknown) {
  const repository = {
    findRenderSource: jest.fn().mockResolvedValue(source),
    findState: jest.fn(),
    findSampleEmitter: jest.fn().mockResolvedValue(null),
  };
  const queue = { enqueue: jest.fn() };
  const motor = {
    id: 'pdf.premium',
    render: jest.fn().mockResolvedValue({
      bytes: Buffer.from('%PDF-1.3 rascunho'),
      mimeType: 'application/pdf',
      format: 'PDF',
    }),
  };
  const renderers = { get: jest.fn().mockReturnValue(motor) };
  const manifestPolicy = { assertExecutionCanIssue: jest.fn() };
  const inputs = { build: jest.fn().mockResolvedValue({ execution: {} }) };

  const documentContext = { build: jest.fn().mockReturnValue({}) };
  const quotes = {
    render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 orcamento')),
  };

  const service = new ArtifactRenderService(
    repository as never,
    queue as never,
    renderers as never,
    manifestPolicy as never,
    { snapshot: jest.fn() } as never,
    inputs as never,
    documentContext as never,
    quotes,
  );

  return {
    service,
    repository,
    queue,
    renderers,
    motor,
    manifestPolicy,
    quotes,
  };
}

const FONTE = {
  code: 'PMOC-000023',
  snapshot: { artifactType: 'PMOC' },
};

describe('preview de documento', () => {
  it('devolve os bytes sem enfileirar nem abrir revisão', async () => {
    const { service, queue, manifestPolicy, motor } = montar(FONTE);

    const rascunho = await service.preview('exec-1', ATOR);

    expect(rascunho.mimeType).toBe('application/pdf');
    expect(rascunho.bytes.toString()).toContain('%PDF');
    expect(motor.render).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(manifestPolicy.assertExecutionCanIssue).not.toHaveBeenCalled();
  });

  it('nomeia o arquivo como rascunho, não como o documento emitido', async () => {
    const { service } = montar(FONTE);

    const rascunho = await service.preview('exec-1', ATOR);

    expect(rascunho.fileName).toBe('PMOC-000023-rascunho.pdf');
  });

  it('usa o motor padrão quando o pedido não escolhe', async () => {
    const { service, renderers } = montar(FONTE);

    await service.preview('exec-1', ATOR);

    expect(renderers.get).toHaveBeenCalledWith('pdf.premium');
  });

  it('respeita o motor pedido', async () => {
    const { service, renderers } = montar(FONTE);

    await service.preview('exec-1', ATOR, 'html.default');

    expect(renderers.get).toHaveBeenCalledWith('html.default');
  });

  it('recusa execução de outra organização como inexistente', async () => {
    const { service, repository } = montar(null);

    await expect(service.preview('exec-1', ATOR)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
    expect(repository.findRenderSource).toHaveBeenCalledWith('exec-1', 'org-1');
  });
});
