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

    const nota = (note: string, visibility: string) => ({
      action: 'FIELD_NOTE_ADDED',
      details: { note, visibility },
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
