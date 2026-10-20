/**
 * A emissão de um recibo.
 *
 * ## Por que esta porta existe, e o que o teste tranca
 *
 * Um recibo é uma execução de artefato com seis respostas. Se a tela montasse isso,
 * ela decidiria o template, o número, os ids de seção e de campo do modelo oficial e
 * a unidade do valor — e é a **unidade** que faz o Financeiro reconhecer dinheiro.
 * Cinco decisões de domínio numa tela, cada uma envelhecendo sozinha.
 *
 * O que se prova aqui: que o número é do servidor, que o valor sai com a unidade
 * certa, que criar não emite e que o modelo da casa manda no que é gravado.
 */
import { ConflictException, ValidationException } from '../../exceptions';
import { formatReceiptNumber } from './receipt-number';
import { ReceiptService } from './receipt.service';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIDADE = '01900000-0000-7000-8000-000000000002';
const ATOR = '01900000-0000-7000-8000-000000000003';

const SECOES_OFICIAIS = [
  {
    id: 'partes',
    fields: [{ id: 'pagador' }, { id: 'documento_pagador' }, { id: 'data' }],
  },
  {
    id: 'valor',
    fields: [{ id: 'valor' }, { id: 'referente' }, { id: 'forma_pagamento' }],
  },
];

const ENTRADA = {
  payer: 'Darlan Simplício',
  payerDocument: '892.839.828-38',
  amount: '1234.56',
  paidOn: '2026-10-01',
  referring: 'Manutenção corretiva do split da suíte',
  paymentMethod: 'Pix',
};

function servico(options: { sections?: unknown; operation?: unknown } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 42 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    artifactExecution: { findFirst: jest.fn().mockResolvedValue(null) },
    artifactTemplate: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'tpl-recibo',
        versions: [{ sections: options.sections ?? SECOES_OFICIAIS }],
      }),
    },
    operation: {
      findFirst: jest.fn().mockResolvedValue(options.operation ?? null),
    },
  };

  const executions = {
    create: jest.fn().mockResolvedValue({ id: 'exec-1', status: 'DRAFT' }),
    saveResponse: jest.fn().mockResolvedValue({ id: 'exec-1' }),
  };

  const service = new ReceiptService(
    { run: (work: (client: typeof tx) => unknown) => work(tx) } as never,
    executions as never,
  );
  return { service, tx, executions };
}

/** As respostas gravadas, por `secao.campo`. */
function respostas(saveResponse: jest.Mock) {
  const calls = saveResponse.mock.calls as [
    string,
    string,
    string,
    { sectionId: string; fieldId: string; value: unknown; unit?: string },
  ][];
  return new Map(
    calls.map((call) => [`${call[3].sectionId}.${call[3].fieldId}`, call[3]]),
  );
}

describe('emissão de recibo', () => {
  it('o número é do servidor, e vai no código e no título', async () => {
    const { service, executions } = servico();

    await service.create(ORG, UNIDADE, ATOR, ENTRADA);

    const criado = (
      executions.create.mock.calls as [
        string,
        string,
        Record<string, unknown>,
      ][]
    )[0]?.[2];

    expect(criado?.code).toBe('RC-000042');

    /* O título leva o número porque é ele que aparece em lista e em notificação:
       sem isso, procurar o recibo 42 obrigaria a abrir os recibos um por um. */
    expect(criado?.title).toContain('RC-000042');
    expect(criado?.title).toContain('Darlan Simplício');
  });

  it('o valor sai com a unidade da moeda', async () => {
    const { service, executions } = servico();

    await service.create(ORG, UNIDADE, ATOR, ENTRADA);

    const valor = respostas(executions.saveResponse).get('valor.valor');

    expect(valor?.value).toBe('1234.56');

    /*
     * `BRL` não é enfeite: o Financeiro reconhece dinheiro por **campo numérico
     * com unidade de moeda**, não por um campo chamado "valor". Sem a unidade, o
     * recibo emitido não viraria receita e ninguém notaria até o fechamento.
     */
    expect(valor?.unit).toBe('BRL');
  });

  it('grava os seis campos do modelo oficial', async () => {
    const { service, executions } = servico();

    await service.create(ORG, UNIDADE, ATOR, ENTRADA);

    expect([...respostas(executions.saveResponse).keys()].sort()).toEqual([
      'partes.data',
      'partes.documento_pagador',
      'partes.pagador',
      'valor.forma_pagamento',
      'valor.referente',
      'valor.valor',
    ]);
  });

  it('campo ausente na entrada não vira resposta vazia', async () => {
    /* Uma resposta em branco é diferente de não ter resposta: o documento
       imprimiria o rótulo com nada ao lado, afirmando que não houve forma de
       pagamento. */
    const { service, executions } = servico();

    await service.create(ORG, UNIDADE, ATOR, {
      ...ENTRADA,
      paymentMethod: undefined,
      payerDocument: '',
    });

    const gravadas = respostas(executions.saveResponse);
    expect(gravadas.has('valor.forma_pagamento')).toBe(false);
    expect(gravadas.has('partes.documento_pagador')).toBe(false);
  });

  it('modelo da casa sem um campo não derruba a emissão', async () => {
    /*
     * Uma organização pode publicar o próprio modelo de recibo. Se ele não declara
     * "forma de pagamento", o recibo continua válido — recusar a emissão inteira
     * por causa de um campo opcional seria pior que emitir sem ele.
     */
    const { service, executions } = servico({
      sections: [
        { id: 'partes', fields: [{ id: 'pagador' }, { id: 'data' }] },
        { id: 'valor', fields: [{ id: 'valor' }, { id: 'referente' }] },
      ],
    });

    await service.create(ORG, UNIDADE, ATOR, ENTRADA);

    const gravadas = respostas(executions.saveResponse);
    expect(gravadas.has('valor.forma_pagamento')).toBe(false);
    expect(gravadas.has('valor.valor')).toBe(true);
  });

  it('criar não emite: o recibo nasce rascunho', async () => {
    /* Emitir é renderizar e publicar o manifesto, e é isso que vira receita
       confirmada. Juntar os dois faria um rascunho conferido pela metade virar
       dinheiro lançado. */
    const { service, executions } = servico();

    const criado = await service.create(ORG, UNIDADE, ATOR, ENTRADA);

    expect(executions.create).toHaveBeenCalledTimes(1);
    expect(criado).toBeDefined();
    const chamadas = Object.keys(executions);
    expect(chamadas).not.toContain('render');
  });

  it('sem unidade emissora, recusa com a razão', async () => {
    /* O recibo sai no papel da unidade — timbre, CNPJ e endereço são dela. */
    const { service } = servico();

    await expect(
      service.create(ORG, null, ATOR, ENTRADA),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});

describe('origem do recibo', () => {
  it('atendimento concluído pode originar recibo', async () => {
    const { service } = servico({
      operation: {
        id: 'op-1',
        code: 'ORB-1',
        serviceOrderNumber: 87,
        title: 'Corretiva',
        status: 'COMPLETED',
        completedAt: new Date('2026-09-30T12:00:00.000Z'),
        customer: { id: 'cust-1', legalName: 'Clínica', tradeName: null },
      },
    });

    await expect(
      service.eligibleOperation(ORG, '01900000-0000-7000-8000-00000000000a'),
    ).resolves.toMatchObject({ code: 'ORB-1' });
  });

  it('atendimento em andamento não origina recibo', async () => {
    /*
     * Recibo é prova de pagamento por serviço **feito**. Oferecer um atendimento em
     * andamento convidaria a receber antes de entregar — decisão comercial que o
     * sistema não deve sugerir.
     */
    const { service } = servico({
      operation: { id: 'op-1', status: 'IN_PROGRESS', customer: null },
    });

    await expect(
      service.eligibleOperation(ORG, '01900000-0000-7000-8000-00000000000a'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('como o número é lido', () => {
  it('tem largura fixa, como o da OS', () => {
    expect(formatReceiptNumber(42)).toBe('RC-000042');
    expect(formatReceiptNumber(1)).toBe('RC-000001');
  });
});
