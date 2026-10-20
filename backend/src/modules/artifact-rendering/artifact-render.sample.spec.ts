/**
 * A amostra de modelo não é emissão, e imprime o timbre de quem pergunta.
 *
 * Duas propriedades que os bytes não revelam:
 *
 * 1. **Nada é gravado.** Ver como um modelo sai não pode enfileirar trabalho,
 *    abrir revisão nem consumir código de documento — senão a tela de Modelos
 *    enche o histórico do cliente de documentos que ninguém pediu.
 * 2. **O emitente é o real.** A pergunta é "como o *meu* documento sai"; uma
 *    amostra com emitente fictício responderia outra pergunta, e o defeito
 *    passaria por detalhe estético.
 */
import { ArtifactRenderService } from './artifact-render.service';
import { EntityNotFoundException } from '../../exceptions';
import type { RenderActor } from './artifact-render.service';

const ATOR: RenderActor = { organizationId: 'org-1', actorId: 'user-1' };

const MARCA_DA_EMPRESA = 'data:image/jpeg;base64,ZW1wcmVzYQ==';

const UNIDADE = {
  legalName: 'Clima Norte Serviços de Refrigeração Ltda',
  tradeName: 'Clima Norte',
  documentType: 'CNPJ',
  documentNumber: '11222333000181',
  logoUrl: 'data:image/png;base64,AAAA',
  organization: { logoUrl: MARCA_DA_EMPRESA },
};

function montar() {
  const repository = {
    findRenderSource: jest.fn(),
    findState: jest.fn(),
    findSampleEmitter: jest.fn().mockResolvedValue(UNIDADE),
  };
  const queue = { enqueue: jest.fn() };
  /* Tipado para que a leitura das chamadas não caia em `any`: o que este teste
     inspeciona é justamente o argumento que chegou ao renderizador. */
  const motor = {
    id: 'pdf.premium',
    render: jest
      .fn<
        Promise<unknown>,
        [
          {
            execution: { code: string };
            metadata: { documentContext: Record<string, unknown> };
          },
        ]
      >()
      .mockResolvedValue({
        bytes: Buffer.from('%PDF-1.3 amostra'),
        mimeType: 'application/pdf',
        format: 'PDF',
      }),
  };
  const renderers = { get: jest.fn().mockReturnValue(motor) };
  const manifestPolicy = { assertExecutionCanIssue: jest.fn() };
  const inputs = { build: jest.fn() };
  const documentContext = {
    build: jest
      .fn<
        { emitter: { tradeName: string } },
        [{ businessUnit?: unknown; logo?: { mimeType: string } }]
      >()
      .mockReturnValue({ emitter: { tradeName: 'Clima Norte' } }),
  };
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
    documentContext,
    quotes,
  };
}

describe('amostra de modelo', () => {
  it('devolve o PDF sem enfileirar nem passar pela política de emissão', async () => {
    const { service, queue, manifestPolicy, motor } = montar();

    const amostra = await service.sample('ORDEM_SERVICO', ATOR);

    expect(amostra.mimeType).toBe('application/pdf');
    expect(amostra.bytes.toString()).toContain('%PDF');
    expect(motor.render).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(manifestPolicy.assertExecutionCanIssue).not.toHaveBeenCalled();
  });

  it('monta o documento com o timbre e a logo da organização', async () => {
    const { service, documentContext, repository } = montar();

    await service.sample('RELATORIO_VISITA', ATOR);

    expect(repository.findSampleEmitter).toHaveBeenCalledWith('org-1');

    /* Sem matcher aninhado: o que importa é que a unidade real e a logo dela
       chegaram ao construtor do contexto. */
    const contexto = documentContext.build.mock.calls[0]![0];
    expect(contexto.businessUnit).toBe(UNIDADE);
    expect(contexto.logo?.mimeType).toBe('image/png');
  });

  it('leva o emitente real e o cliente fictício até o renderizador', async () => {
    const { service, motor } = montar();

    await service.sample('ORDEM_SERVICO', ATOR);

    const entrada = motor.render.mock.calls[0]![0];

    expect(entrada.execution.code).toContain('AMOSTRA');
    expect(entrada.metadata.documentContext.emitter).toEqual({
      tradeName: 'Clima Norte',
    });
    expect(entrada.metadata.documentContext.customer).toMatchObject({
      name: 'Edifício Aurora',
    });
  });

  it('emite orçamento pelo serviço de orçamento, não pelo motor de execução', async () => {
    /* Orçamento não nasce de execução: se a amostra passasse pelo renderer de
       execução, sairia um documento que a emissão real nunca produz. */
    const { service, quotes, motor } = montar();

    const amostra = await service.sample('ORCAMENTO', ATOR);

    expect(quotes.render).toHaveBeenCalledTimes(1);
    expect(motor.render).not.toHaveBeenCalled();
    expect(amostra.bytes.toString()).toContain('orcamento');
  });

  it('recusa um tipo sem amostra em vez de inventar um documento vazio', async () => {
    const { service } = montar();

    await expect(service.sample('INVENTADO', ATOR)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  /*
   * O caso de quem opera com uma unidade só: a marca foi cadastrada nas
   * configurações da empresa — que é onde se procura — e nunca no cadastro da
   * unidade. Sem a herança, o documento sairia sem timbre e a pessoa teria
   * enviado a imagem no lugar certo para nada.
   */
  it('herda a marca da empresa quando a unidade não tem a sua', async () => {
    const { service, repository, documentContext } = montar();
    repository.findSampleEmitter.mockResolvedValue({
      ...UNIDADE,
      logoUrl: null,
    });

    await service.sample('RELATORIO_VISITA', ATOR);

    /* `image/jpeg` é o da empresa; o da unidade neste teste é PNG. O mime prova
     *qual* das duas marcas foi impressa, não só que alguma foi. */
    expect(documentContext.build.mock.calls[0]![0].logo?.mimeType).toBe(
      'image/jpeg',
    );
  });

  it('a marca da unidade vence a da empresa', async () => {
    const { service, documentContext } = montar();

    await service.sample('RELATORIO_VISITA', ATOR);

    expect(documentContext.build.mock.calls[0]![0].logo?.mimeType).toBe(
      'image/png',
    );
  });

  it('sai com o timbre vazio quando a organização não tem unidade', async () => {
    /* Instalação nova: nenhuma unidade cadastrada ainda. A amostra tem de sair
       igual, sem timbre — e não estourar. */
    const { service, repository, documentContext, motor } = montar();
    repository.findSampleEmitter.mockResolvedValue(null);

    await service.sample('RECIBO', ATOR);

    expect(documentContext.build).toHaveBeenCalledWith({
      businessUnit: undefined,
      logo: undefined,
    });
    expect(motor.render).toHaveBeenCalledTimes(1);
  });
});
