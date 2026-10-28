/* eslint-disable @typescript-eslint/no-explicit-any */
import { MobileFieldArtifactService } from './mobile-field-artifact.service';
import type { MobileFieldActor } from './mobile-field.service';

const actor: MobileFieldActor = {
  id: '01900000-0000-7000-8000-000000000001',
  organizationId: '01900000-0000-7000-8000-000000000002',
  businessUnitIds: ['01900000-0000-7000-8000-000000000003'],
  permissions: ['artifact_rendering.render'],
};

describe('MobileFieldArtifactService', () => {
  it('congela os checklists escolhidos para a OS com as respostas verdadeiras e falsas', async () => {
    const source = operacao(87) as {
      source: { checklistExecutions: unknown[] };
    };
    source.source.checklistExecutions = [
      {
        id: 'general',
        templateSnapshot: {
          name: 'Geral',
          items: [{ key: 'clean', label: 'Limpar filtro', type: 'BOOLEAN' }],
        },
        answers: { clean: true },
      },
      {
        id: 'specific',
        templateSnapshot: {
          name: 'Dreno',
          items: [
            { key: 'drain', label: 'Desobstruir dreno', type: 'BOOLEAN' },
          ],
        },
        answers: { drain: false },
      },
    ];
    const repository = {
      source: jest.fn().mockResolvedValue(source),
      existing: jest.fn().mockResolvedValue(null),
      freeze: jest.fn().mockResolvedValue(artifact('NOT_RENDERED')),
    };
    const service = new MobileFieldArtifactService(
      repository as never,
      {} as never,
      {} as never,
    );
    await service.freeze(
      actor,
      'OPERATION',
      '01900000-0000-7000-8000-000000000012',
    );
    const calls = repository.freeze.mock.calls as [
      {
        snapshot: {
          sections: {
            type?: string;
            title: string;
            fields: { value: unknown }[];
          }[];
        };
      },
    ][];
    expect(
      calls[0]![0].snapshot.sections.filter(
        (section) => section.type === 'CHECKLIST',
      ),
    ).toMatchObject([
      { title: 'Geral', fields: [{ value: true }] },
      { title: 'Dreno', fields: [{ value: false }] },
    ]);
  });

  it('projects PMOC readiness without replacing its existing preparation flow', async () => {
    const repository = {
      source: jest.fn().mockResolvedValue({
        kind: 'PMOC_EQUIPMENT_EXECUTION',
        source: {
          id: '01900000-0000-7000-8000-000000000004',
          status: 'COMPLETED',
          artifactExecutionId: '01900000-0000-7000-8000-000000000005',
        },
        permissions: ['artifact_rendering.render'],
      }),
      existing: jest.fn().mockResolvedValue(null),
    };
    const service = new MobileFieldArtifactService(
      repository as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.preparation(
        actor,
        'PMOC_EQUIPMENT_EXECUTION',
        '01900000-0000-7000-8000-000000000004',
      ),
    ).resolves.toMatchObject({
      documentType: 'PMOC',
      eligibility: { eligible: true, blockedReasons: [] },
    });
  });

  /**
   * O "Número" da OS é o da ordem, não o código digitado.
   *
   * O documento imprime `execution.code`, e ele era montado como `OS-<code>` —
   * onde `code` é texto livre que o dono escreve ao criar a operação. Duas
   * consequências: o número do documento legal seguia a convenção de quem digitou,
   * e não existia contagem de ordens de serviço.
   *
   * Aqui a numeração já está reservada desde o nascimento da ordem; este teste
   * garante que ela **chega ao documento** em vez de ficar só na tabela.
   */
  describe('numeração no documento congelado', () => {
    function bancada(serviceOrderNumber: number | null) {
      const repository = {
        source: jest.fn().mockResolvedValue(operacao(serviceOrderNumber)),
        existing: jest.fn().mockResolvedValue(null),
        freeze: jest.fn().mockResolvedValue(artifact('NOT_RENDERED')),
      };
      const service = new MobileFieldArtifactService(
        repository as never,
        { request: jest.fn() } as never,
        {} as never,
      );
      return { service, repository };
    }

    const congelar = (service: MobileFieldArtifactService) =>
      service.freeze(
        actor,
        'OPERATION',
        '01900000-0000-7000-8000-000000000012',
      );

    it('imprime o número da ordem de serviço', async () => {
      const { service, repository } = bancada(87);

      await congelar(service);

      expect(repository.freeze).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OS-000087',
          title: 'Ordem de Serviço — OS-000087',
        }),
      );
    });

    it('sem número, volta para o código — mas não sai sem identidade', async () => {
      /* Operações anteriores à numeração, e as que não são ordem de serviço.
         Um documento sem número é um documento que ninguém consegue citar. */
      const { service, repository } = bancada(null);

      await congelar(service);

      expect(repository.freeze).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OS-ORB-1' }),
      );
    });
  });

  /**
   * As observações do técnico chegam ao documento.
   *
   * A seção "Pendências e observações" da OS lê `metadata.executionNotes`, e o
   * `metadata` de um documento congelado era só o do **template** — a seção nunca
   * imprimia nada em produção. O técnico escrevia no aplicativo, o texto ficava no
   * histórico, e o documento que o cliente assina saía sem a substância do
   * atendimento.
   */
  describe('observações no documento congelado', () => {
    function bancada(history: unknown[]) {
      const fonte = operacao(87) as { source: { history: unknown[] } };
      fonte.source.history = history;
      const repository = {
        source: jest.fn().mockResolvedValue(fonte),
        existing: jest.fn().mockResolvedValue(null),
        freeze: jest.fn().mockResolvedValue(artifact('NOT_RENDERED')),
      };
      const service = new MobileFieldArtifactService(
        repository as never,
        { request: jest.fn() } as never,
        {} as never,
      );
      return { service, repository };
    }

    const nota = (note: string, visibility: string, kind?: string) => ({
      action: 'FIELD_NOTE_ADDED',
      details: { note, visibility, ...(kind ? { kind } : {}) },
      createdAt: new Date('2026-09-29T12:30:00.000Z'),
    });

    const congelar = (service: MobileFieldArtifactService) =>
      service.freeze(
        actor,
        'OPERATION',
        '01900000-0000-7000-8000-000000000012',
      );

    const notasDoSnapshot = (freeze: jest.Mock): unknown => {
      const calls = freeze.mock.calls as [
        { snapshot: { metadata?: { executionNotes?: unknown } } },
      ][];
      return calls[0]?.[0]?.snapshot?.metadata?.executionNotes;
    };

    const pedidosDoSnapshot = (freeze: jest.Mock): unknown => {
      const calls = freeze.mock.calls as [
        { snapshot: { metadata?: { customerRequests?: unknown } } },
      ][];
      return calls[0]?.[0]?.snapshot?.metadata?.customerRequests;
    };

    /**
     * O que foi constatado e o que foi pedido saem em blocos diferentes.
     *
     * O documento imprime "Observações da execução" e "Solicitações do
     * cliente" separados, porque são as duas perguntas de quem lê a OS: o que
     * foi feito, e o que sobrou. Num campo só, a pendência se perdia no meio do
     * relato — e é dela que sai o próximo atendimento.
     */
    it('separa observação de solicitação', async () => {
      const { service, repository } = bancada([
        nota('Gás recarregado.', 'CUSTOMER_VISIBLE', 'OBSERVATION'),
        nota(
          'Cliente pediu orçamento do compressor.',
          'CUSTOMER_VISIBLE',
          'REQUEST',
        ),
      ]);

      await congelar(service);

      expect(notasDoSnapshot(repository.freeze)).toBe('Gás recarregado.');
      expect(pedidosDoSnapshot(repository.freeze)).toBe(
        'Cliente pediu orçamento do compressor.',
      );
    });

    /**
     * Nota gravada antes de `kind` existir continua sendo observação.
     *
     * Sem este padrão, texto de documentos já emitidos migraria para o bloco de
     * pendências na próxima reemissão — mudando um papel que o cliente assinou.
     */
    it('nota sem natureza declarada é observação', async () => {
      const { service, repository } = bancada([
        nota('Constatação antiga.', 'CUSTOMER_VISIBLE'),
      ]);

      await congelar(service);

      expect(notasDoSnapshot(repository.freeze)).toBe('Constatação antiga.');
      expect(pedidosDoSnapshot(repository.freeze)).toBeNull();
    });

    it('solicitação interna não sai no documento do cliente', async () => {
      const { service, repository } = bancada([
        nota('Cobrar visita extra.', 'INTERNAL', 'REQUEST'),
      ]);

      await congelar(service);

      expect(pedidosDoSnapshot(repository.freeze)).toBeNull();
    });

    it('leva as observações visíveis ao cliente', async () => {
      const { service, repository } = bancada([
        nota('Gás recarregado; dreno desobstruído.', 'CUSTOMER_VISIBLE'),
      ]);

      await congelar(service);

      expect(notasDoSnapshot(repository.freeze)).toBe(
        'Gás recarregado; dreno desobstruído.',
      );
    });

    it('nunca leva as internas', async () => {
      /* A OS é entregue e assinada pelo cliente. A nota interna é conversa da
         equipe, e num papel que ele arquiva ela é vazamento. */
      const { service, repository } = bancada([
        nota(
          'Cliente resiste a trocar a peça; insistir na próxima.',
          'INTERNAL',
        ),
      ]);

      await congelar(service);

      expect(notasDoSnapshot(repository.freeze)).toBeNull();
    });

    it('junta várias, separadas, na ordem em que foram escritas', async () => {
      const { service, repository } = bancada([
        nota('Primeira constatação.', 'CUSTOMER_VISIBLE'),
        nota('Interna, não sai.', 'INTERNAL'),
        nota('Segunda constatação.', 'CUSTOMER_VISIBLE'),
      ]);

      await congelar(service);

      /* Linha em branco entre elas: são momentos diferentes do atendimento, e
         emendadas viram um parágrafo que ninguém escreveu. */
      expect(notasDoSnapshot(repository.freeze)).toBe(
        'Primeira constatação.\n\nSegunda constatação.',
      );
    });

    it('sem observação nenhuma, a seção não existe', async () => {
      /* `null`, e não string vazia: um bloco em branco no documento diz que nada
         foi observado, o que é uma afirmação diferente de não ter havido nota. */
      const { service, repository } = bancada([
        { action: 'FIELD_OPERATION_COMPLETED', details: {} },
      ]);

      await congelar(service);

      expect(notasDoSnapshot(repository.freeze)).toBeNull();
    });
  });

  it('does not enqueue another render when the frozen artifact is pending', async () => {
    const rendering = { request: jest.fn() };
    const repository = {
      get: jest.fn().mockResolvedValue(artifact('PENDING')),
    };
    const service = new MobileFieldArtifactService(
      repository as never,
      rendering as never,
      {} as never,
    );

    await expect(
      service.render(actor, '01900000-0000-7000-8000-000000000010', {}),
    ).resolves.toMatchObject({ status: 'PENDING', allowedActions: [] });
    expect(rendering.request).not.toHaveBeenCalled();
  });
});

/**
 * Qual motor desenha o relatório emitido em campo.
 *
 * ## O defeito
 *
 * `render` mandava `renderer: input.renderer ?? 'pdf.default'`. Como o
 * aplicativo não escolhe motor, o `??` resolvia **sempre** para `pdf.default` —
 * o desenho genérico de pares rótulo/valor. O mesmo documento pedido pela web
 * saía por `pdf.premium`, com timbre, tabela de equipamentos e registro
 * fotográfico; o que o cliente recebia em campo, não.
 *
 * O padrão é decisão do produto (`defaultRendererFor`), e `request` já o aplica
 * quando o campo chega ausente. O conserto é não carimbar nada aqui.
 */
describe('motor de desenho do relatório de campo', () => {
  function bancada(renderStatus: string) {
    const rendering = { request: jest.fn().mockResolvedValue({}) };
    const repository = {
      get: jest.fn().mockResolvedValue(artifact(renderStatus)),
      source: jest.fn().mockResolvedValue(operacao(87)),
      existing: jest.fn().mockResolvedValue(null),
    };
    const service = new MobileFieldArtifactService(
      repository as never,
      rendering as never,
      {} as never,
    );
    return { service, rendering };
  }

  const pedir = (
    service: MobileFieldArtifactService,
    renderer?: 'pdf.premium' | 'pdf.default' | 'html.default',
  ) =>
    service.render(actor, '01900000-0000-7000-8000-000000000010', {
      renderer,
    });

  it('não escolhe motor: deixa o padrão do produto valer', async () => {
    const { service, rendering } = bancada('NOT_RENDERED');

    await pedir(service);

    const [, , input] = rendering.request.mock.calls[0] as [
      unknown,
      unknown,
      { renderer?: string },
    ];
    expect(input.renderer).toBeUndefined();
  });

  /* Pedir um motor específico continua funcionando — é assim que se compara a
     saída de dois deles. */
  it('respeita o motor quando alguém pede um', async () => {
    const { service, rendering } = bancada('NOT_RENDERED');

    await pedir(service, 'pdf.premium');

    expect(rendering.request).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ renderer: 'pdf.premium' }),
    );
  });
});

function artifact(renderStatus: string): any {
  return {
    id: '01900000-0000-7000-8000-000000000010',
    artifactExecutionId: '01900000-0000-7000-8000-000000000011',
    sourceType: 'OPERATION',
    sourceId: '01900000-0000-7000-8000-000000000012',
    documentType: 'SERVICE_ORDER',
    snapshotVersion: 1,
    snapshotHash: 'a'.repeat(64),
    artifactExecution: {
      renderStatus,
      snapshot: { templateVersion: 1 },
      manifests: [],
    },
  };
}

/** Uma operação concluída, pronta para congelar o documento. */
function operacao(serviceOrderNumber: number | null): any {
  return {
    kind: 'OPERATION',
    source: {
      id: '01900000-0000-7000-8000-000000000012',
      businessUnitId: '01900000-0000-7000-8000-000000000003',
      customerId: null,
      code: 'ORB-1',
      serviceOrderNumber,
      title: 'Preventiva',
      status: 'COMPLETED',
      startedAt: new Date('2026-09-29T12:00:00.000Z'),
      completedAt: new Date('2026-09-29T13:00:00.000Z'),
      assets: [],
      auxiliaryTechnicians: [],
      history: [],
      checklistExecutions: [],
      inventoryMovements: [],
      materials: [],
      fieldEvidence: [],
      fieldEvidenceUploads: [],
      customer: null,
      customerAddress: null,
      businessUnit: {
        legalName: 'Orbit Recife',
        tradeName: null,
        city: 'Recife',
        stateCode: 'PE',
      },
      responsibleFieldTechnician: {
        id: '01900000-0000-7000-8000-000000000001',
        displayName: 'Ana',
      },
      startedBy: {
        id: '01900000-0000-7000-8000-000000000001',
        displayName: 'Ana',
      },
      completedBy: {
        id: '01900000-0000-7000-8000-000000000001',
        displayName: 'Ana',
      },
      responsibleFieldTechnicianId: '01900000-0000-7000-8000-000000000001',
    },
    signatoryId: '01900000-0000-7000-8000-000000000001',
    /* A assinatura do técnico é pré-condição para congelar — sem ela o documento
       sairia sem quem responde por ele, e o serviço recusa antes. */
    signature: { hash: 'b'.repeat(64), storageFileId: 'file-1' },
    acknowledgement: null,
    template: {
      id: 'tpl-1',
      key: 'ORDEM_SERVICO',
      name: 'Ordem de Serviço',
      artifactType: 'SERVICE_ORDER',
      segment: null,
      version: {
        id: 'v1',
        version: 1,
        metadata: {},
        sections: [],
        signatureSlots: [],
        layout: {},
      },
    },
    permissions: ['artifact_rendering.render'],
  };
}
