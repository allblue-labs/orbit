/**
 * Abrir um atendimento estando no local.
 *
 * ## O que este teste protege
 *
 * As regras que decidem se o comando é aceito, e a **idempotência** — que é o
 * ponto mais consequente: o comando cria cliente, equipamentos e ordem, e a
 * resposta pode se perder na volta. Sem a chave, tocar "tentar de novo" na
 * calçada deixaria o técnico com dois cadastros do mesmo cliente e duas ordens
 * para o mesmo serviço.
 */
import { MobileWalkInService } from './mobile-walk-in.service';
import type { MobileFieldActor } from './mobile-field.service';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIDADE = '01900000-0000-7000-8000-000000000002';
const OUTRA_UNIDADE = '01900000-0000-7000-8000-00000000000a';
const TECNICO = '01900000-0000-7000-8000-000000000003';
const CLIENTE = '01900000-0000-7000-8000-000000000004';
const ORDEM = '01900000-0000-7000-8000-000000000005';
const CHAVE = 'walkin-0001-abc';

function bancada(permissions: readonly string[] = ['operations.create']) {
  const repository = {
    primaryUnit: jest.fn().mockResolvedValue({ id: UNIDADE }),
    customers: jest.fn().mockResolvedValue([]),
    customerAssets: jest.fn().mockResolvedValue([]),
    /* Tipado para que o teste possa olhar o `payloadHash` sem `any`. */
    create: jest.fn<
      Promise<{ operationId: string; created: boolean }>,
      [{ businessUnitId: string; payloadHash: string }]
    >(() => Promise.resolve({ operationId: ORDEM, created: true })),
  };
  const service = new MobileWalkInService(repository as never);
  const actor: MobileFieldActor = {
    id: TECNICO,
    organizationId: ORG,
    businessUnitIds: [UNIDADE],
    permissions: [...permissions],
  };
  return { service, repository, actor };
}

const novoCliente = { legalName: 'Clima Norte LTDA' };

describe('atendimento avulso', () => {
  it('abre a ordem e devolve o identificador para o roteiro seguir', async () => {
    const { service, actor } = bancada();

    await expect(
      service.create(actor, CHAVE, { customer: novoCliente }),
    ).resolves.toEqual({
      operationId: ORDEM,
      idempotency: { key: CHAVE, replayed: false },
    });
  });

  /**
   * Cliente existente **ou** novo, nunca os dois.
   *
   * Aceitar os dois obrigaria o servidor a escolher qual vale, e qualquer
   * escolha seria arbitrária — com o risco de cadastrar um cliente duplicado
   * enquanto a ordem aponta para outro.
   */
  it('recusa os dois caminhos de cliente ao mesmo tempo', async () => {
    const { service, repository, actor } = bancada();

    await expect(
      service.create(actor, CHAVE, {
        customerId: CLIENTE,
        customer: novoCliente,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('recusa nenhum dos dois', async () => {
    const { service, repository, actor } = bancada();

    await expect(service.create(actor, CHAVE, {})).rejects.toBeInstanceOf(
      ValidationException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  /** Um cliente sem nome não é cadastro: é uma linha anônima na carteira. */
  it('recusa cliente novo sem nome', async () => {
    const { service, actor } = bancada();

    await expect(
      service.create(actor, CHAVE, { customer: { legalName: '   ' } }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  /* ---------------------------------------------------------------- */
  /* Idempotência                                                      */
  /* ---------------------------------------------------------------- */

  it('exige a chave de idempotência', async () => {
    const { service, repository, actor } = bancada();

    await expect(
      service.create(actor, undefined, { customer: novoCliente }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('recusa chave curta ou com caractere fora do conjunto seguro', async () => {
    const { service, actor } = bancada();

    for (const chave of ['curta', 'com espaço aqui 12345', 'a'.repeat(161)]) {
      await expect(
        service.create(actor, chave, { customer: novoCliente }),
      ).rejects.toBeInstanceOf(ValidationException);
    }
  });

  /**
   * O reenvio devolve a mesma ordem, dizendo que foi reenvio.
   *
   * `replayed` existe para a tela não anunciar "atendimento criado" duas vezes
   * — e, principalmente, para ela não criar um terceiro.
   */
  it('reenvio devolve a mesma ordem, marcada como repetição', async () => {
    const { service, repository, actor } = bancada();
    repository.create.mockResolvedValue({
      operationId: ORDEM,
      created: false,
    });

    await expect(
      service.create(actor, CHAVE, { customer: novoCliente }),
    ).resolves.toEqual({
      operationId: ORDEM,
      idempotency: { key: CHAVE, replayed: true },
    });
  });

  /**
   * A mesma chave com outro conteúdo é defeito do cliente, não reenvio.
   *
   * Em silêncio, o segundo atendimento — de outro cliente — receberia a ordem
   * do primeiro, e o técnico executaria no endereço errado.
   */
  it('mesma chave com outro payload é conflito', async () => {
    const { service, repository, actor } = bancada();
    repository.create.mockRejectedValue(
      new Error('WALK_IN_IDEMPOTENCY_PAYLOAD_MISMATCH'),
    );

    await expect(
      service.create(actor, CHAVE, { customer: novoCliente }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /** O hash ignora ordem de chaves: o mesmo payload reordenado é o mesmo. */
  it('o hash do payload não depende da ordem das chaves', async () => {
    const { service, repository, actor } = bancada();

    await service.create(actor, CHAVE, {
      customer: novoCliente,
      description: 'Sem gelar',
    });
    const primeiro = repository.create.mock.calls[0]![0];

    repository.create.mockClear();
    await service.create(actor, CHAVE, {
      description: 'Sem gelar',
      customer: novoCliente,
    });
    const segundo = repository.create.mock.calls[0]![0];

    expect(segundo.payloadHash).toBe(primeiro.payloadHash);
  });

  /* ---------------------------------------------------------------- */
  /* Escopo e permissão                                                */
  /* ---------------------------------------------------------------- */

  it('exige permissão de criar atendimento', async () => {
    const { service, actor } = bancada(['operations.read']);

    await expect(
      service.create(actor, CHAVE, { customer: novoCliente }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /** Sem unidade escolhida, usa a principal do ator. */
  it('usa a organização principal quando nenhuma é informada', async () => {
    const { service, repository, actor } = bancada();

    await service.create(actor, CHAVE, { customer: novoCliente });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ businessUnitId: UNIDADE }),
    );
  });

  /**
   * Unidade fora do escopo é recusada **antes** da transação.
   *
   * Sem isto, o comando abriria uma ordem numa organização que o técnico não
   * atende — e o cliente novo nasceria lá também.
   */
  it('recusa organização fora do escopo do ator', async () => {
    const { service, repository, actor } = bancada();

    await expect(
      service.create(actor, CHAVE, {
        businessUnitId: OUTRA_UNIDADE,
        customer: novoCliente,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('traduz cliente inexistente em 404', async () => {
    const { service, repository, actor } = bancada();
    repository.create.mockRejectedValue(
      new Error('WALK_IN_CUSTOMER_NOT_FOUND'),
    );

    await expect(
      service.create(actor, CHAVE, { customerId: CLIENTE }),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('traduz equipamento de outro cliente em recusa de validação', async () => {
    const { service, repository, actor } = bancada();
    repository.create.mockRejectedValue(
      new Error('WALK_IN_ASSET_SCOPE_INVALID'),
    );

    await expect(
      service.create(actor, CHAVE, { customerId: CLIENTE }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  /* ---------------------------------------------------------------- */
  /* Leitura para os passos do roteiro                                 */
  /* ---------------------------------------------------------------- */

  it('a carteira exige permissão de ler cliente', async () => {
    const { service, actor } = bancada(['operations.create']);

    await expect(service.customers(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /** O ponto de referência é publicado — é o que localiza em campo. */
  it('publica o ponto de referência do endereço', async () => {
    const { service, repository, actor } = bancada([
      'operations.create',
      'customers.read',
    ]);
    repository.customers.mockResolvedValue([
      {
        id: CLIENTE,
        type: 'COMPANY',
        legalName: 'Clima Norte',
        tradeName: null,
        documentNumber: null,
        phone: null,
        email: null,
        address: null,
        addresses: [
          {
            id: 'addr-1',
            label: 'Matriz',
            street: 'Av. Rio Branco',
            number: '120',
            complement: null,
            district: 'Recife',
            city: 'Recife',
            stateCode: 'PE',
            postalCode: '50030230',
            notes: 'Portão azul ao lado da padaria',
          },
        ],
      },
    ]);

    const { items } = await service.customers(actor);

    expect(items[0]!.addresses[0]!.reference).toBe(
      'Portão azul ao lado da padaria',
    );
  });

  /** O limite é fechado: um celular na calçada não rola duzentos clientes. */
  it('limita o tamanho da carteira devolvida', async () => {
    const { service, repository, actor } = bancada([
      'operations.create',
      'customers.read',
    ]);

    await service.customers(actor, undefined, 500);

    expect(repository.customers).toHaveBeenCalledWith(ORG, undefined, 50);
  });
});

describe('walk-in unit and owner access', () => {
  it('limits equipment to the selected allowed unit', async () => {
    const { service, repository, actor } = bancada(['customers.read']);
    await service.customerAssets(actor, CLIENTE, UNIDADE);
    expect(repository.customerAssets).toHaveBeenCalledWith(ORG, CLIENTE, [
      UNIDADE,
    ]);
  });
  it('rejects equipment requests outside the actor scope', async () => {
    const { service, repository, actor } = bancada(['customers.read']);
    await expect(
      service.customerAssets(actor, CLIENTE, OUTRA_UNIDADE),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.customerAssets).not.toHaveBeenCalled();
  });
  it('honors structural ownership without granting ordinary technicians new permissions', async () => {
    const { service, repository, actor } = bancada([]);
    await expect(
      service.create({ ...actor, isOrganizationOwner: true }, CHAVE, {
        customer: novoCliente,
      }),
    ).resolves.toMatchObject({ operationId: ORDEM });
    expect(repository.create).toHaveBeenCalledTimes(1);
    await expect(
      service.create(actor, CHAVE, { customer: novoCliente }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('includes equipment dates in the idempotency fingerprint', async () => {
    const { service, repository, actor } = bancada();
    await service.create(actor, CHAVE, {
      customerId: CLIENTE,
      equipment: [
        { name: 'Split', installationAt: new Date('2026-10-24T00:00:00Z') },
      ],
    });
    await service.create(actor, CHAVE, {
      customerId: CLIENTE,
      equipment: [
        { name: 'Split', installationAt: new Date('2026-10-25T00:00:00Z') },
      ],
    });
    const first = repository.create.mock.calls[0]?.[0] as {
      payloadHash: string;
    };
    const second = repository.create.mock.calls[1]?.[0] as {
      payloadHash: string;
    };
    expect(first.payloadHash).not.toBe(second.payloadHash);
  });
});
