/**
 * A reserva do número da Ordem de Serviço.
 *
 * ## O que precisa ser verdade
 *
 * Que a contagem venha do **contador**, incrementado no banco, e não de um
 * `MAX(...) + 1` calculado aqui: duas criações simultâneas leriam o mesmo máximo, e
 * a segunda quebraria no índice único — com o pedido do cliente perdido no meio.
 *
 * E que a reserva seja por organização. Um contador global faria a primeira ordem
 * de um cliente novo nascer com o número de outra empresa, o que é vazamento de
 * informação comercial num documento que ele arquiva.
 */
import {
  allocateServiceOrderNumber,
  formatServiceOrderNumber,
} from './service-order-number';

const ORG = '01900000-0000-7000-8000-000000000001';

function cliente(resposta: unknown) {
  const consultas: string[] = [];
  const valores: unknown[][] = [];
  const client = {
    $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => {
      consultas.push(query.join('?'));
      valores.push(values);
      return Promise.resolve(resposta as T);
    },
  };
  return { client, consultas, valores };
}

describe('reserva do número da OS', () => {
  it('incrementa o contador no banco e devolve o número', async () => {
    const { client, consultas, valores } = cliente([{ last_value: 87 }]);

    const numero = await allocateServiceOrderNumber(client, ORG);

    expect(numero).toBe(87);

    /* `ON CONFLICT DO UPDATE`: quem serializa é o banco. Sem isto, a leitura e a
       escrita ficariam em dois passos, com a janela entre elas. */
    expect(consultas[0]).toContain('ON CONFLICT (organization_id) DO UPDATE');
    expect(consultas[0]).toContain('last_value + 1');
    expect(consultas[0]).toContain('RETURNING last_value');
    expect(valores[0]).toEqual([ORG]);
  });

  it('a reserva é por organização', async () => {
    const { client, consultas } = cliente([{ last_value: 1 }]);

    await allocateServiceOrderNumber(client, ORG);

    /* O contador é keyed por inquilino. Um contador único para a instalação faria
       a primeira ordem de uma organização nova sair com um número alto — e
       revelaria o volume das outras. */
    expect(consultas[0]).toContain('organization_id');
  });

  it('recusa em vez de inventar quando o banco não devolve número', async () => {
    /* Assumir `1` aqui gravaria um número já usado, e o índice único recusaria a
       criação inteira — com a causa escondida atrás de um erro de constraint. */
    const { client } = cliente([]);

    await expect(allocateServiceOrderNumber(client, ORG)).rejects.toThrow(
      /did not return/i,
    );
  });
});

describe('como o número é lido', () => {
  it('tem largura fixa, para alinhar em lista e ser lido em voz alta', () => {
    expect(formatServiceOrderNumber(87)).toBe('OS-000087');
    expect(formatServiceOrderNumber(1)).toBe('OS-000001');
  });

  it('cresce em vez de truncar', () => {
    /* Perder um dígito perderia a identidade do documento. */
    expect(formatServiceOrderNumber(1234567)).toBe('OS-1234567');
  });

  it('operação sem número não ganha um', () => {
    expect(formatServiceOrderNumber(null)).toBeNull();
  });
});
