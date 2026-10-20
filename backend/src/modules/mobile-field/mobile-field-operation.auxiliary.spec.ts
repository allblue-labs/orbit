/**
 * Auxiliar acompanha; responsável executa.
 *
 * ## O defeito que estes testes trancam
 *
 * `actions()` decidia só pelas permissões do **papel** —
 * `operations.status.update` e `operations.update` —, que são iguais para
 * todo técnico de campo. Um auxiliar com o papel padrão recebia `START` e
 * `COMPLETE` e podia concluir, no aplicativo, um atendimento que não é dele.
 *
 * A permissão diz o que a pessoa sabe fazer; a atribuição diz em qual
 * atendimento. Faltava a segunda metade.
 */
import { MobileFieldOperationService } from './mobile-field-operation.service';

const organizationId = '01900000-0000-7000-8000-000000000001';
const operationId = '01900000-0000-7000-8000-000000000002';
const responsavelId = '01900000-0000-7000-8000-000000000003';
const auxiliarId = '01900000-0000-7000-8000-000000000004';

/** Papel completo de técnico de campo: o que separa os dois não é isto. */
const PERMISSOES = [
  'operations.read',
  'operations.update',
  'operations.status.update',
  'assets.read',
  'artifact_executions.read',
  'inventory.manage',
];

function ator(id: string) {
  return {
    id,
    organizationId,
    businessUnitIds: ['01900000-0000-7000-8000-000000000009'],
    permissions: PERMISSOES,
    capabilities: [],
  } as never;
}

function servico(
  status: string,
  conclusao: {
    completedAt?: Date | null;
    completedBy?: { id: string; displayName: string } | null;
  } = {},
) {
  const source = {
    id: operationId,
    code: 'OS-1',
    title: 'Atendimento',
    description: null,
    status,
    priority: 'NORMAL',
    businessUnitId: '01900000-0000-7000-8000-000000000009',
    scheduledStart: null,
    startedAt: null,
    completedAt: conclusao.completedAt ?? null,
    startedBy: null,
    completedBy: conclusao.completedBy ?? null,
    customer: null,
    location: { lat: 1, lng: 1 },
    /** O contrato publica uma lista: o técnico atende o que está no endereço. */
    assets: [
      {
        asset: {
          id: 'asset-1',
          name: 'Chiller',
          code: null,
          tag: null,
          manufacturer: null,
          model: null,
          serialNumber: null,
          location: null,
          status: 'ACTIVE',
          qrIdentities: [],
        },
      },
    ],
    responsibleFieldTechnicianId: responsavelId,
    auxiliaryTechnicians: [{ user: { id: auxiliarId, displayName: 'Aux' } }],
    checklistExecutions: [],
    artifactExecutions: [
      {
        id: 'artifact-1',
        status: 'ISSUED',
        renderStatus: 'COMPLETED',
        snapshot: { artifactType: 'ORDEM_SERVICO' },
      },
    ],
    materials: [],
    updatedAt: new Date('2026-09-12T12:00:00.000Z'),
  };

  const repository = {
    preparation: jest.fn().mockResolvedValue(source),
    isFieldActor: jest.fn().mockResolvedValue(true),
  };
  const signatures = {
    context: jest.fn().mockResolvedValue({ signature: { id: 'assinatura' } }),
  };

  return new MobileFieldOperationService(
    repository as never,
    {} as never,
    signatures as never,
  );
}

async function acoesDe(
  status: string,
  atorId: string,
  conclusao?: {
    completedAt?: Date | null;
    completedBy?: { id: string; displayName: string } | null;
  },
) {
  const preparation = await servico(status, conclusao).preparation(
    ator(atorId),
    operationId,
  );
  return preparation;
}

describe('auxiliar é somente leitura no atendimento', () => {
  it('não recebe START mesmo com a permissão do papel', async () => {
    const { allowedActions } = await acoesDe('SCHEDULED', auxiliarId);
    expect(allowedActions).not.toContain('START');
  });

  it('não recebe RESUME, COMPLETE, checklist, nota nem material', async () => {
    const { allowedActions } = await acoesDe('IN_PROGRESS', auxiliarId);
    for (const proibida of [
      'RESUME',
      'COMPLETE',
      'UPDATE_CHECKLIST',
      'ADD_NOTE',
      'REGISTER_MATERIAL',
    ]) {
      expect(allowedActions).not.toContain(proibida);
    }
  });

  it('continua lendo: abre a rota, lê a etiqueta e o documento emitido', async () => {
    /// É o que ele precisa em campo. Tirar a leitura junto com a execução
    /// transformaria "acompanha" em "não vê".
    const { allowedActions } = await acoesDe('IN_PROGRESS', auxiliarId);
    expect(allowedActions).toEqual(
      expect.arrayContaining([
        'VIEW',
        'OPEN_ROUTE',
        'SCAN_EQUIPMENT',
        'VIEW_DOCUMENT',
        'DOWNLOAD_DOCUMENT',
      ]),
    );
  });

  it('o motivo do bloqueio é o papel no atendimento, não a permissão', async () => {
    /// Dizer "falta permissão" mandaria o auxiliar pedir um acesso que ele
    /// já tem — e ninguém entenderia por que continua sem conseguir.
    const { executionEligibility } = await acoesDe('IN_PROGRESS', auxiliarId);
    expect(executionEligibility.blockers).toContain(
      'AUXILIARY_TECHNICIAN_READ_ONLY',
    );
    expect(executionEligibility.blockers).not.toContain(
      'EXECUTION_PERMISSION_REQUIRED',
    );
    expect(executionEligibility.eligible).toBe(false);
  });
});

/**
 * A conclusão chega ao auxiliar.
 *
 * ## O que isto garante
 *
 * O auxiliar não conclui — e é justamente por isso que ele precisa **ver** que
 * foi concluído, por quem e quando, além do documento que saiu. Sem isso,
 * "acompanha o atendimento" significaria acompanhar até a última coisa que ele
 * mesmo fez, e o fecho ficaria invisível para metade da equipe.
 *
 * A comissão dele sai do mesmo fato: `isCommissionable` exige `COMPLETED`, e é a
 * conclusão do responsável que a libera — com valor próprio do papel de auxiliar.
 * Essa parte tem teste no calculador; aqui se garante que o fato chega a ele.
 */
describe('atendimento concluído, visto pelo auxiliar', () => {
  const concluido = {
    completedAt: new Date('2026-09-12T15:00:00.000Z'),
    completedBy: { id: responsavelId, displayName: 'Responsável' },
  };

  it('lê a conclusão: quando foi e quem concluiu', async () => {
    const preparation = await acoesDe('COMPLETED', auxiliarId, concluido);

    expect(preparation.operation.status).toBe('COMPLETED');
    expect(preparation.operation.completedAt).toBe('2026-09-12T15:00:00.000Z');
    expect(preparation.operation.completedBy?.name).toBe('Responsável');
  });

  it('continua alcançando o documento emitido', async () => {
    /* É a peça que ele mostra ao cliente e a que sustenta a comissão dele. */
    const { allowedActions } = await acoesDe(
      'COMPLETED',
      auxiliarId,
      concluido,
    );

    expect(allowedActions).toEqual(
      expect.arrayContaining(['VIEW', 'VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT']),
    );
  });

  it('não ganha ação de execução por estar concluído', async () => {
    /* Nem o auxiliar nem ninguém reabre pelo aplicativo: o atendimento acabou, e
       um `START` aqui seria um segundo início sobre um fato fechado. */
    const { allowedActions } = await acoesDe(
      'COMPLETED',
      auxiliarId,
      concluido,
    );

    expect(allowedActions).not.toContain('START');
    expect(allowedActions).not.toContain('COMPLETE');
    expect(allowedActions).not.toContain('UPDATE_CHECKLIST');
  });
});

describe('responsável continua executando', () => {
  it('recebe START quando o atendimento ainda não começou', async () => {
    const { allowedActions } = await acoesDe('SCHEDULED', responsavelId);
    expect(allowedActions).toContain('START');
  });

  it('recebe as ações de execução com o atendimento em andamento', async () => {
    const { allowedActions } = await acoesDe('IN_PROGRESS', responsavelId);
    expect(allowedActions).toEqual(
      expect.arrayContaining([
        'RESUME',
        'COMPLETE',
        'UPDATE_CHECKLIST',
        'ADD_NOTE',
        'REGISTER_MATERIAL',
      ]),
    );
  });

  it('não é bloqueado por ser auxiliar de si mesmo', async () => {
    const { executionEligibility } = await acoesDe(
      'IN_PROGRESS',
      responsavelId,
    );
    expect(executionEligibility.blockers).not.toContain(
      'AUXILIARY_TECHNICIAN_READ_ONLY',
    );
    expect(executionEligibility.eligible).toBe(true);
  });
});
