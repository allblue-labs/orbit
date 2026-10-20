/**
 * Quem recebe código gerado, e quem não recebe.
 *
 * ## A fronteira
 *
 * `create` do repositório é por onde o cadastro de equipamento passa, e a reserva
 * mora ali, na mesma transação: um equipamento sem código, ou um número consumido
 * sem equipamento, seriam duas formas de furar a contagem.
 *
 * ## A regra que estes testes trancam
 *
 * Gera **só** para `INTERNAL_CODE` sem valor. Série, QR, NFC, barras e RFID são
 * lidos da máquina física: um número de série gerado é um fato inventado sobre o
 * equipamento do cliente, e um QR que não existe em etiqueta nenhuma é uma busca
 * que nunca encontra nada.
 */
import { AssetRepository } from './asset.repository';

const ORG = '01900000-0000-7000-8000-000000000001';

function bancada() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 4 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    asset: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'asset-1', ...args.data }),
        ),
    },
  };
  const repository = new AssetRepository({
    run: (work: (client: typeof tx) => unknown) => work(tx),
  } as never);
  return { repository, tx };
}

/** O identificador que o insert recebeu. */
function identificadorGravado(create: jest.Mock): unknown {
  const calls = create.mock.calls as [{ data: { identifier?: unknown } }][];
  return calls[0]?.[0]?.data?.identifier;
}

const criar = (repository: AssetRepository, data: Record<string, unknown>) =>
  repository.create({
    organizationId: ORG,
    businessUnitId: '01900000-0000-7000-8000-000000000009',
    category: 'EQUIPMENT',
    name: 'Split Hi-Wall',
    ...data,
  });

describe('criação de equipamento', () => {
  it('gera o código quando o tipo é interno e nada foi informado', async () => {
    const { repository, tx } = bancada();

    await criar(repository, { identifierType: 'INTERNAL_CODE' });

    expect(identificadorGravado(tx.asset.create)).toBe('EQP-000004');
  });

  it('reserva na mesma transação da criação', async () => {
    const { repository, tx } = bancada();

    await criar(repository, { identifierType: 'INTERNAL_CODE' });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('código interno digitado passa intacto', async () => {
    /* Quem etiquetou o parque antes de usar o Orbit tem a convenção dele, e
       sobrescrevê-la deixaria a etiqueta física discordando do sistema. */
    const { repository, tx } = bancada();

    await criar(repository, {
      identifierType: 'INTERNAL_CODE',
      identifier: 'TORRE-A-12',
    });

    expect(identificadorGravado(tx.asset.create)).toBe('TORRE-A-12');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('o QR também é gerado — a etiqueta é impressa pelo Orbit', async () => {
    /*
     * O QR entrou na lista do que o sistema atribui porque o papel sai daqui
     * (`/assets/:id/qr/ensure`, resolvido em `/q/<token>`): exigir que alguém
     * digitasse um QR antes de ele existir invertia a ordem dos fatos.
     */
    const { repository, tx } = bancada();

    await criar(repository, { identifierType: 'QR_CODE' });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(identificadorGravado(tx.asset.create)).toBeDefined();
  });

  it('o que é lido da máquina continua sem ser gerado', async () => {
    /* Inventar um número de série é inventar um fato sobre o equipamento do
       cliente. Vale igual para NFC, código de barras e RFID. */
    for (const tipo of ['SERIAL_NUMBER', 'NFC', 'BARCODE', 'RFID', 'CUSTOM']) {
      const { repository, tx } = bancada();

      await criar(repository, { identifierType: tipo });

      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(identificadorGravado(tx.asset.create)).toBeUndefined();
    }
  });

  it('equipamento sem tipo de identificador continua sem identificador', async () => {
    /* Gerar aqui seria **decidir** que a máquina é identificada por etiqueta
       interna — informação de cadastro que ninguém deu. */
    const { repository, tx } = bancada();

    await criar(repository, {});

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(identificadorGravado(tx.asset.create)).toBeUndefined();
  });

  it('falha na reserva impede a criação', async () => {
    const { repository, tx } = bancada();
    tx.$queryRaw.mockRejectedValue(new Error('sem contador'));

    await expect(
      criar(repository, { identifierType: 'INTERNAL_CODE' }),
    ).rejects.toThrow(/sem contador/);
    expect(tx.asset.create).not.toHaveBeenCalled();
  });
});
