/**
 * O código do item de catálogo.
 *
 * ## O que precisa ser verdade
 *
 * Que cada fluxo conte por si. Produto, serviço e peça moram na mesma tabela, e
 * uma sequência única faria o primeiro serviço da organização nascer como o número
 * 47 porque existem 46 produtos — número que ninguém consegue explicar para quem
 * está montando a lista de serviços.
 *
 * E que a geração conviva com código **digitado**: organizações que vêm de outro
 * sistema importam os códigos antigos, e um deles pode ser exatamente o próximo
 * que o contador ia entregar.
 */
import { allocateProductSku, formatProductSku, skuPrefix } from './product-sku';

const ORG = '01900000-0000-7000-8000-000000000001';

function cliente(options: { reservado: number; ocupados?: readonly string[] }) {
  const ocupados = new Set(options.ocupados ?? []);
  const consultas: string[] = [];
  const escritas: string[] = [];
  const client = {
    $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => {
      consultas.push(query.join('?'));
      void values;
      return Promise.resolve([
        { last_value: options.reservado },
      ] as unknown as T);
    },
    $executeRaw: (query: TemplateStringsArray) => {
      escritas.push(query.join('?'));
      return Promise.resolve(1);
    },
    product: {
      findFirst: (args: unknown) => {
        const where = (args as { where: { sku: string } }).where;
        return Promise.resolve(
          ocupados.has(where.sku) ? { id: 'existente' } : null,
        );
      },
    },
  };
  return { client, consultas, escritas };
}

describe('prefixo por fluxo', () => {
  it('cada fluxo tem o seu', () => {
    expect(skuPrefix('PRODUCT')).toBe('PRD');
    expect(skuPrefix('SERVICE')).toBe('SRV');
    expect(skuPrefix('PART')).toBe('PEC');
  });

  it('fluxo desconhecido cai num código genérico, não em undefined', () => {
    /* `kind` é texto no banco: um fluxo novo aparecer antes deste mapa é mais
       provável que o contrário, e `undefined-000001` seria um código impresso em
       orçamento. */
    expect(skuPrefix('KIT')).toBe('ITM');
    expect(formatProductSku('KIT', 1)).toBe('ITM-000001');
  });

  it('seis dígitos, e cresce em vez de truncar', () => {
    expect(formatProductSku('PRODUCT', 42)).toBe('PRD-000042');
    expect(formatProductSku('SERVICE', 1234567)).toBe('SRV-1234567');
  });
});

describe('reserva do código', () => {
  it('usa o contador do banco, keyed por organização e fluxo', async () => {
    const { client, consultas } = cliente({ reservado: 7 });

    const sku = await allocateProductSku(client, ORG, 'SERVICE');

    expect(sku).toBe('SRV-000007');
    expect(consultas[0]).toContain(
      'ON CONFLICT (organization_id, kind) DO UPDATE',
    );
    expect(consultas[0]).toContain('last_value + 1');
  });

  it('a contagem de um fluxo não depende da do outro', async () => {
    /* Os dois contadores devolvem 1: é o banco quem os separa, e o código gerado
       reflete isso em vez de somar os catálogos. */
    const produto = cliente({ reservado: 1 });
    const servico = cliente({ reservado: 1 });

    expect(await allocateProductSku(produto.client, ORG, 'PRODUCT')).toBe(
      'PRD-000001',
    );
    expect(await allocateProductSku(servico.client, ORG, 'SERVICE')).toBe(
      'SRV-000001',
    );
  });

  it('avança quando o código do contador já foi digitado por alguém', async () => {
    const { client, escritas } = cliente({
      reservado: 7,
      ocupados: ['PRD-000007', 'PRD-000008'],
    });

    const sku = await allocateProductSku(client, ORG, 'PRODUCT');

    expect(sku).toBe('PRD-000009');

    /* E leva o contador junto: sem isto, a próxima criação tropeçaria nos mesmos
       dois códigos e faria as mesmas consultas de novo. */
    expect(escritas[0]).toContain('GREATEST(last_value');
  });

  it('não escreve no contador quando o primeiro código já servia', async () => {
    const { client, escritas } = cliente({ reservado: 3 });

    await allocateProductSku(client, ORG, 'PART');

    expect(escritas).toEqual([]);
  });

  it('recusa em vez de inventar quando o contador não devolve número', async () => {
    const client = {
      $queryRaw: <T>() => Promise.resolve([] as unknown as T),
      $executeRaw: () => Promise.resolve(0),
      product: { findFirst: () => Promise.resolve(null) },
    };

    /* Assumir `1` gravaria um código já usado, e o índice recusaria a criação
       inteira — com a causa escondida atrás de um erro de constraint. */
    await expect(allocateProductSku(client, ORG, 'PRODUCT')).rejects.toThrow(
      /did not return/i,
    );
  });

  it('desiste depois de cinquenta ocupados seguidos', async () => {
    /* Cinquenta códigos digitados em sequência a partir do contador é dado
       corrompido, não uso normal. Insistir devolveria um código que o índice vai
       recusar. */
    const ocupados = Array.from({ length: 60 }, (_, indice) =>
      formatProductSku('PRODUCT', indice + 1),
    );
    const { client } = cliente({ reservado: 1, ocupados });

    await expect(allocateProductSku(client, ORG, 'PRODUCT')).rejects.toThrow(
      /50 attempts/i,
    );
  });
});
