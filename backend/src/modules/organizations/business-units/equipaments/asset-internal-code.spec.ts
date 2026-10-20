/**
 * O código interno do equipamento.
 *
 * ## O recorte, que é o ponto
 *
 * Dos sete tipos de identificador, só um é **atribuído** pela organização: o código
 * interno. Os outros — série, QR, NFC, barras, RFID — são lidos da máquina física.
 * Gerar um número de série inventaria um fato sobre o equipamento do cliente, e um
 * QR gerado que não existe em etiqueta nenhuma é uma busca que nunca encontra nada.
 *
 * ## E por inquilino
 *
 * O contador é por organização, como a unicidade do identificador. Global, a
 * primeira máquina de um cliente novo nasceria com o número de outra empresa — numa
 * etiqueta que vai colada no equipamento.
 */
import {
  allocateInternalCode,
  formatInternalCode,
  GENERATED_IDENTIFIER_TYPES,
  isGeneratedIdentifierType,
} from './asset-internal-code';

const ORG = '01900000-0000-7000-8000-000000000001';

function cliente(options: { reservado: number; ocupados?: readonly string[] }) {
  const ocupados = new Set(options.ocupados ?? []);
  const consultas: string[] = [];
  const escritas: string[] = [];
  const buscas: Record<string, unknown>[] = [];
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
    asset: {
      findFirst: (args: unknown) => {
        const where = (args as { where: Record<string, unknown> }).where;
        buscas.push(where);
        return Promise.resolve(
          ocupados.has(where.identifier as string) ? { id: 'existente' } : null,
        );
      },
    },
  };
  return { client, consultas, escritas, buscas };
}

describe('os tipos que o sistema atribui', () => {
  it('são a etiqueta interna e o QR — e só eles', () => {
    /*
     * A lista é lida pelo repositório e pela validação. Um tipo a mais aqui faz
     * o sistema inventar um dado da máquina: número de série, NFC, código de
     * barras e RFID são **lidos** do equipamento do cliente.
     *
     * O QR pertence à lista porque a etiqueta é impressa pelo próprio Orbit — o
     * papel segue o sistema, não o contrário.
     */
    expect([...GENERATED_IDENTIFIER_TYPES].sort()).toEqual([
      'INTERNAL_CODE',
      'QR_CODE',
    ]);
  });

  it('número de série continua sendo lido, nunca gerado', () => {
    expect(isGeneratedIdentifierType('SERIAL_NUMBER')).toBe(false);
    expect(isGeneratedIdentifierType('NFC')).toBe(false);
    expect(isGeneratedIdentifierType('BARCODE')).toBe(false);
    expect(isGeneratedIdentifierType('RFID')).toBe(false);
  });

  it('sem tipo não é tipo gerado', () => {
    /* `null` e `undefined` chegam do banco e do DTO; tratá-los como gerados
       faria um equipamento sem identificador receber um código silenciosamente. */
    expect(isGeneratedIdentifierType(null)).toBe(false);
    expect(isGeneratedIdentifierType(undefined)).toBe(false);
  });

  it('seis dígitos, e cresce em vez de truncar', () => {
    expect(formatInternalCode(42)).toBe('EQP-000042');
    expect(formatInternalCode(1234567)).toBe('EQP-1234567');
  });
});

describe('reserva do código interno', () => {
  it('usa o contador do banco, keyed pela organização', async () => {
    const { client, consultas } = cliente({ reservado: 7 });

    const codigo = await allocateInternalCode(client, ORG);

    expect(codigo).toBe('EQP-000007');
    expect(consultas[0]).toContain('ON CONFLICT (organization_id) DO UPDATE');
    expect(consultas[0]).toContain('last_value + 1');
  });

  it('procura ocupado sem excluir equipamento apagado', async () => {
    /* O índice único `(organization_id, identifier)` não tem predicado: um
       registro em soft delete continua ocupando o código. Filtrar `deletedAt:
       null` devolveria um código que o banco vai recusar, e o conflito apareceria
       sem causa visível. */
    const { client, buscas } = cliente({ reservado: 1 });

    await allocateInternalCode(client, ORG);

    expect(buscas[0]).toEqual({
      organizationId: ORG,
      identifier: 'EQP-000001',
    });
    expect(buscas[0]).not.toHaveProperty('deletedAt');
  });

  it('avança quando o código do contador já foi etiquetado à mão', async () => {
    const { client, escritas } = cliente({
      reservado: 7,
      ocupados: ['EQP-000007'],
    });

    expect(await allocateInternalCode(client, ORG)).toBe('EQP-000008');

    /* E leva o contador junto: senão a próxima criação tropeça no mesmo. */
    expect(escritas[0]).toContain('GREATEST(last_value');
  });

  it('não escreve no contador quando o primeiro código já servia', async () => {
    const { client, escritas } = cliente({ reservado: 3 });

    await allocateInternalCode(client, ORG);

    expect(escritas).toEqual([]);
  });

  it('recusa em vez de inventar quando o contador não devolve número', async () => {
    const client = {
      $queryRaw: <T>() => Promise.resolve([] as unknown as T),
      $executeRaw: () => Promise.resolve(0),
      asset: { findFirst: () => Promise.resolve(null) },
    };

    await expect(allocateInternalCode(client, ORG)).rejects.toThrow(
      /did not return/i,
    );
  });

  it('desiste depois de cinquenta ocupados seguidos', async () => {
    const ocupados = Array.from({ length: 60 }, (_, indice) =>
      formatInternalCode(indice + 1),
    );
    const { client } = cliente({ reservado: 1, ocupados });

    await expect(allocateInternalCode(client, ORG)).rejects.toThrow(
      /50 attempts/i,
    );
  });
});
