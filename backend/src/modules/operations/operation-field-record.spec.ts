/**
 * O registro de campo visto da web.
 *
 * ## O que faltava
 *
 * As fotos e a assinatura do cliente eram gravadas pelo aplicativo e só apareciam
 * **dentro do PDF**. Quem acompanha o fluxo pela plataforma não tinha como ver se
 * havia evidência nem se o cliente assinou, a não ser emitindo o documento e
 * abrindo o arquivo.
 *
 * ## O que este teste fixa
 *
 * Duas decisões que, erradas, contam uma história falsa sobre um documento que o
 * cliente assinou: aceite invalidado não é aceite, e assinatura ausente é ausência
 * — não um quadro vazio.
 */
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';

const ORG = '01900000-0000-7000-8000-000000000001';
const OPERACAO = '01900000-0000-7000-8000-000000000002';

const arquivo = (id: string) => ({
  id,
  bucket: 'orbit',
  objectKey: `evidence/${id}.jpg`,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 120n,
  sha256: 'a'.repeat(64),
  status: 'AVAILABLE',
});

function servico(record: {
  evidence?: unknown[];
  acknowledgement?: unknown;
  signatureFile?: unknown;
  capturedBy?: unknown;
}) {
  const repository = {
    find: jest.fn().mockResolvedValue({ id: OPERACAO, organizationId: ORG }),
    fieldRecord: jest.fn().mockResolvedValue({
      evidence: record.evidence ?? [],
      acknowledgement: record.acknowledgement ?? null,
      signatureFile: record.signatureFile ?? null,
      capturedBy: record.capturedBy ?? null,
    }),
  };
  const files = {
    sign: jest.fn((file: { objectKey: string }) =>
      Promise.resolve({
        url: `https://storage.example/${file.objectKey}?sig=abc`,
        expiresAt: new Date('2026-09-30T13:00:00.000Z'),
        requiredHeaders: {},
      }),
    ),
  };
  const service = new OperationService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    files as never,
  );
  return { service, repository, files };
}

const ler = (service: OperationService) => service.fieldRecord(OPERACAO, ORG);

describe('registro de campo de um atendimento', () => {
  it('publica cada evidência com endereço assinado', async () => {
    const { service, files } = servico({
      evidence: [
        {
          id: 'ev-1',
          category: 'BEFORE',
          source: 'CAMERA',
          fileName: 'antes.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 120n,
          capturedAt: new Date('2026-09-29T12:00:00.000Z'),
          capturedBy: { id: 'user-1', displayName: 'Ana' },
          storageFile: arquivo('ev-1'),
        },
      ],
    });

    const registro = await ler(service);

    const [foto] = registro.evidence;
    expect(registro.evidence).toHaveLength(1);
    expect(foto?.url).toContain('storage.example');

    /* Pré-visualização, não download: a imagem é exibida na página, e o servidor
       distingue as duas na assinatura. */
    expect(files.sign).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: 'evidence/ev-1.jpg' }),
      'preview',
    );

    /* `sizeBytes` como texto: é `BigInt` no banco, e `JSON.stringify` recusa
       `BigInt` — a rota inteira responderia 500. */
    expect(foto?.sizeBytes).toBe('120');
  });

  it('o aceite vem com a assinatura e com o resumo que o cliente leu', async () => {
    const { service } = servico({
      acknowledgement: {
        id: 'ack-1',
        signerName: 'Darlan Simplício',
        acknowledgedAt: new Date('2026-09-29T13:00:00.000Z'),
        capturedByUserId: 'user-1',
        summarySnapshot: { titulo: 'Atendimento concluído' },
        signatureStorageFileId: 'file-1',
      },
      signatureFile: arquivo('file-1'),
      capturedBy: { id: 'user-1', displayName: 'Ana' },
    });

    const registro = await ler(service);

    expect(registro.acknowledgement?.signerName).toBe('Darlan Simplício');
    expect(registro.acknowledgement?.signature?.url).toContain(
      'storage.example',
    );

    /* O resumo é o congelado, e é ele que dá sentido à assinatura: recalcular hoje
       mostraria o atendimento de agora, não o que foi aceito. */
    expect(registro.acknowledgement?.summary).toEqual({
      titulo: 'Atendimento concluído',
    });
    expect(registro.acknowledgement?.capturedBy?.displayName).toBe('Ana');
  });

  it('aceite sem assinatura é aceite sem imagem, não um quadro vazio', async () => {
    /* Acontece: o cliente reconhece o atendimento e não assina na tela. A
       assinatura é desejável, não obrigatória. */
    const { service } = servico({
      acknowledgement: {
        id: 'ack-1',
        signerName: 'Darlan Simplício',
        acknowledgedAt: new Date('2026-09-29T13:00:00.000Z'),
        capturedByUserId: 'user-1',
        summarySnapshot: {},
        signatureStorageFileId: null,
      },
    });

    const registro = await ler(service);

    expect(registro.acknowledgement).not.toBeNull();
    expect(registro.acknowledgement?.signature).toBeNull();
  });

  it('atendimento sem nada registrado não inventa conteúdo', async () => {
    const { service, files } = servico({});

    const registro = await ler(service);

    expect(registro.evidence).toEqual([]);
    expect(registro.acknowledgement).toBeNull();

    /* Nada a assinar: uma assinatura por leitura vazia seria ida ao storage sem
       ninguém do outro lado. */
    expect(files.sign).not.toHaveBeenCalled();
  });

  it('confere o inquilino antes de assinar qualquer coisa', async () => {
    /* A leitura da operação é o que responde "não encontrado" para quem pede o
       atendimento de outra organização. Assinar primeiro entregaria a URL de uma
       imagem que a pessoa não pode ver. */
    const { service, repository, files } = servico({});
    repository.find.mockResolvedValue(null);

    await expect(ler(service)).rejects.toThrow();
    expect(repository.fieldRecord).not.toHaveBeenCalled();
    expect(files.sign).not.toHaveBeenCalled();
  });
});

/**
 * A consulta, e não só a projeção.
 *
 * O serviço tem dublê de repositório — então o que ele prova é o que faz com a
 * resposta, não qual pergunta faz ao banco. E é na pergunta que moram as duas
 * exclusões que importam: evidência que ainda está subindo não tem arquivo no
 * storage, e aceite invalidado não é aceite.
 */
/** O `where` da primeira chamada — lido, e não casado por matcher aninhado. */
function where(consulta: jest.Mock): Record<string, unknown> {
  const calls = consulta.mock.calls as [{ where: Record<string, unknown> }][];
  return calls[0]?.[0]?.where ?? {};
}

describe('a consulta do registro de campo', () => {
  function bancada() {
    const tx = {
      fieldEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      customerAcknowledgement: { findFirst: jest.fn().mockResolvedValue(null) },
      storageFile: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const repository = new OperationRepository(
      { run: (work: (client: typeof tx) => unknown) => work(tx) } as never,
      { emit: jest.fn() } as never,
    );
    return { repository, tx };
  }

  it('pede só evidência com arquivo no storage', async () => {
    const { repository, tx } = bancada();

    await repository.fieldRecord(OPERACAO, ORG);

    /* `FINALIZED`: as que ainda sobem não têm objeto, e assinar URL para elas
       devolveria endereço que responde 404 — um quadro quebrado na página. */
    expect(where(tx.fieldEvidence.findMany).status).toBe('FINALIZED');
  });

  it('ignora aceite invalidado', async () => {
    const { repository, tx } = bancada();

    await repository.fieldRecord(OPERACAO, ORG);

    /* O aceite é invalidado quando o atendimento muda depois dele. Mostrá-lo como
       válido afirmaria que o cliente aceitou algo que ele não viu — sobre um
       documento que leva a assinatura dele. */
    const filtro = where(tx.customerAcknowledgement.findFirst);
    expect(filtro.invalidatedAt).toBeNull();
    expect(filtro.executionType).toBe('OPERATION');
    expect(filtro.executionId).toBe(OPERACAO);
  });

  it('não busca assinatura quando não há aceite', async () => {
    const { repository, tx } = bancada();

    await repository.fieldRecord(OPERACAO, ORG);

    expect(tx.storageFile.findFirst).not.toHaveBeenCalled();
    expect(tx.user.findFirst).not.toHaveBeenCalled();
  });
});
