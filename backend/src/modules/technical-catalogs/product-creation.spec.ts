/**
 * Todo item de catálogo nasce com código.
 *
 * ## Por que o teste é da fronteira
 *
 * `createProduct` do repositório é por onde todo item nasce — a criação pela tela,
 * pela API e por importação passam por ele. A reserva mora ali e na **mesma
 * transação** da criação: um item sem código, ou um código sem item, seriam duas
 * formas de quebrar a contagem do fluxo.
 *
 * Se a reserva subir para o serviço, este teste falha. É o ponto: lá em cima ela
 * cobriria uma porta e deixaria as outras criando item sem código, que é
 * exatamente o defeito que se está corrigindo.
 */
import { CatalogRepository } from './catalog.repository';

const ORG = '01900000-0000-7000-8000-000000000001';

function bancada() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 12 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    product: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'prod-1', ...args.data }),
        ),
    },
  };
  const repository = new CatalogRepository({
    run: (work: (client: typeof tx) => unknown) => work(tx),
  } as never);
  return { repository, tx };
}

/** O SKU que o insert recebeu. */
function skuGravado(create: jest.Mock): unknown {
  const calls = create.mock.calls as [{ data: { sku?: unknown } }][];
  return calls[0]?.[0]?.data?.sku;
}

const criar = (repository: CatalogRepository, data: Record<string, unknown>) =>
  repository.createProduct({
    organizationId: ORG,
    kind: 'SERVICE',
    name: 'Limpeza de evaporadora',
    ...data,
  });

describe('criação de item de catálogo', () => {
  it('gera o código quando não vem nenhum', async () => {
    const { repository, tx } = bancada();

    await criar(repository, {});

    expect(skuGravado(tx.product.create)).toBe('SRV-000012');
  });

  it('reserva na mesma transação da criação', async () => {
    const { repository, tx } = bancada();

    await criar(repository, {});

    /* O contador é lido no mesmo `tx`: uma transação que falhe depois não deixa
       item sem código nem número consumido sem item. */
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('o prefixo segue o fluxo do item, não o padrão', async () => {
    const { repository, tx } = bancada();

    await criar(repository, { kind: 'PART' });

    expect(skuGravado(tx.product.create)).toBe('PEC-000012');
  });

  it('código digitado passa intacto, e nada é reservado', async () => {
    /* Quem vem de outro sistema importa os códigos antigos. Sobrescrevê-los faria
       o catálogo novo não conversar com a nota fiscal antiga — e consumiria um
       número da sequência para um item que não o usa. */
    const { repository, tx } = bancada();

    await criar(repository, { sku: 'LEGADO-88' });

    expect(skuGravado(tx.product.create)).toBe('LEGADO-88');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('falha na reserva impede a criação', async () => {
    /* Sem isto, o item nasceria sem código — o defeito que esta mudança corrige,
       reaparecendo só quando o contador falha. */
    const { repository, tx } = bancada();
    tx.$queryRaw.mockRejectedValue(new Error('sem contador'));

    await expect(criar(repository, {})).rejects.toThrow(/sem contador/);
    expect(tx.product.create).not.toHaveBeenCalled();
  });
});
