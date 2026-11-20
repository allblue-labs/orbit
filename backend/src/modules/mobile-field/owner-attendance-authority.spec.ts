/**
 * O dono atende o que é de qualquer técnico.
 *
 * ## O defeito
 *
 * O serviço de PMOC já deixava o dono abrir e concluir sem atribuição — "é ele
 * quem atende quando o técnico escalado faltou". Mas o roteiro passa, no meio,
 * por portas apoiadas na **operação** que mora atrás da execução, e elas exigiam
 * atribuição sem exceção:
 *
 * ```text
 * preparação da operação  → 404 "este registro não está disponível"
 * observação / checklist  → 403 "atendimento exige atribuição ativa"
 * aceite do cliente       → 403 "somente o técnico atribuído"
 * ```
 *
 * O dono abria o atendimento e era recusado no passo seguinte.
 *
 * A evidência **não** entra aqui de propósito: a foto é prova do que aquela
 * pessoa viu (ver `mobile-evidence-authority.spec`).
 */
import { MobileFieldOperationRepository } from './mobile-field-operation.repository';
import { MobileFieldOperationService } from './mobile-field-operation.service';
import { MobileSignatureService } from './mobile-signature.service';
import { EntityNotFoundException, ForbiddenException } from '../../exceptions';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIDADE = '01900000-0000-7000-8000-000000000009';
const OPERACAO = '01900000-0000-7000-8000-000000000002';
const TECNICO = '01900000-0000-7000-8000-000000000003';
const DONO = '01900000-0000-7000-8000-000000000004';
const VERSAO = new Date('2026-11-20T12:00:00.000Z');

const ator = (id: string, dono: boolean) =>
  ({
    id,
    organizationId: ORG,
    businessUnitIds: [UNIDADE],
    permissions: ['operations.read', 'operations.update'],
    isOrganizationOwner: dono,
  }) as never;

/* ------------------------------------------------------------------ */
/* Preparação da operação                                               */
/* ------------------------------------------------------------------ */

function preparacao() {
  const source = {
    id: OPERACAO,
    code: 'PMOC-1',
    title: 'PMOC',
    description: null,
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    businessUnitId: UNIDADE,
    scheduledStart: null,
    startedAt: null,
    completedAt: null,
    startedBy: null,
    completedBy: null,
    customer: null,
    location: null,
    assets: [],
    responsibleFieldTechnicianId: TECNICO,
    auxiliaryTechnicians: [],
    checklistExecutions: [],
    artifactExecutions: [],
    materials: [],
    authorizedAt: VERSAO,
    organization: { settings: null },
    updatedAt: VERSAO,
  };
  const service = new MobileFieldOperationService(
    {
      preparation: jest.fn().mockResolvedValue(source),
      /* O dono, aqui, nem tem perfil de campo: é a situação real de uma conta
         antiga, e `requireVisible` já o dispensava disso. */
      isFieldActor: jest.fn().mockResolvedValue(false),
      operationMaterials: jest.fn().mockResolvedValue([]),
    } as never,
    {} as never,
    { context: jest.fn().mockResolvedValue({ signature: null }) } as never,
    {
      authorizeTarget: jest
        .fn()
        .mockResolvedValue({ context: {}, denied: true, readable: true }),
    } as never,
  );
  return service;
}

describe('o dono no atendimento de outro técnico', () => {
  it('vê a preparação da operação', async () => {
    await expect(
      preparacao().preparation(ator(DONO, true), OPERACAO),
    ).resolves.toMatchObject({ operation: { id: OPERACAO } });
  });

  /** A exceção é do dono, não de qualquer um que tenha o mesmo papel. */
  it('outro técnico continua sem ver', async () => {
    await expect(
      preparacao().preparation(
        ator('01900000-0000-7000-8000-00000000000f', false),
        OPERACAO,
      ),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });
});

/* ------------------------------------------------------------------ */
/* Comandos de registro                                                */
/* ------------------------------------------------------------------ */

function comandoDeObservacao(actorIsOwner: boolean, actorId: string) {
  const operation = {
    id: OPERACAO,
    businessUnitId: UNIDADE,
    status: 'IN_PROGRESS',
    updatedAt: VERSAO,
    responsibleFieldTechnicianId: TECNICO,
    auxiliaryTechnicians: [],
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    operation: {
      findFirst: jest.fn().mockResolvedValue(operation),
      update: jest.fn().mockResolvedValue({ updatedAt: VERSAO }),
    },
    operationHistory: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    professionalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    businessUnitMembership: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const repository = new MobileFieldOperationRepository(
    { run: (work: (client: typeof tx) => unknown) => work(tx) } as never,
    { emit: jest.fn() } as never,
  );
  return repository.addNote({
    operationId: OPERACAO,
    organizationId: ORG,
    actorId,
    actorIsOwner,
    expectedVersion: VERSAO.toISOString(),
    idempotencyKey: 'nota-0001',
    payloadHash: 'h'.repeat(64),
    note: 'Gás recarregado.',
    visibility: 'CUSTOMER_VISIBLE',
    kind: 'OBSERVATION',
  });
}

describe('registrar no atendimento de outro técnico', () => {
  it('o dono registra a observação', async () => {
    await expect(comandoDeObservacao(true, DONO)).resolves.toMatchObject({
      idempotentReplay: false,
    });
  });

  it('quem não é dono nem atribuído continua recusado', async () => {
    await expect(
      comandoDeObservacao(false, '01900000-0000-7000-8000-00000000000f'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/* ------------------------------------------------------------------ */
/* Aceite do cliente                                                   */
/* ------------------------------------------------------------------ */

function aceite() {
  const operation = {
    id: OPERACAO,
    businessUnitId: UNIDADE,
    status: 'IN_PROGRESS',
    updatedAt: VERSAO,
    authorizedAt: VERSAO,
    organization: { settings: null },
    completedByUserId: null,
    responsibleFieldTechnicianId: TECNICO,
    startedByUserId: TECNICO,
    code: 'PMOC-1',
    title: 'PMOC',
    customer: null,
    assets: [],
    completedAt: null,
  };
  const repository = {
    operation: jest.fn().mockResolvedValue(operation),
    acknowledgement: jest.fn().mockResolvedValue(null),
  };
  return new MobileSignatureService(
    repository as never,
    {} as never,
    {} as never,
  );
}

describe('aceite do cliente no atendimento de outro técnico', () => {
  /**
   * Era a última porta do PMOC: o dono chegava à confirmação e recebia
   * "somente o técnico atribuído pode confirmar este atendimento".
   */
  it('o dono colhe o aceite', async () => {
    await expect(
      aceite().acknowledgementPreparation(ator(DONO, true), OPERACAO),
    ).resolves.toMatchObject({ existingAcknowledgement: null });
  });

  it('outro técnico continua recusado', async () => {
    await expect(
      aceite().acknowledgementPreparation(
        ator('01900000-0000-7000-8000-00000000000f', false),
        OPERACAO,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/* ------------------------------------------------------------------ */
/* A flag chega ao repositório                                          */
/* ------------------------------------------------------------------ */

/**
 * A isenção do repositório só vale se o serviço disser quem é o dono.
 *
 * Os controllers de evidência e de sincronização offline montavam o ator sem
 * `isOrganizationOwner` — as isenções que já existiam liam `undefined`. Este
 * teste segura a última perna do caminho: serviço → repositório.
 */
describe('a flag de dono viaja até o comando', () => {
  function servico() {
    const repository = {
      addNote: jest
        .fn()
        .mockResolvedValue({ version: 'v', idempotentReplay: false }),
      updateChecklist: jest.fn().mockResolvedValue({
        execution: {
          id: 'c',
          status: 'IN_PROGRESS',
          progress: 0,
          updatedAt: VERSAO,
        },
        idempotentReplay: false,
      }),
    };
    const service = new MobileFieldOperationService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, repository };
  }

  it('observação leva a flag', async () => {
    const { service, repository } = servico();

    await service.addNote(ator(DONO, true), OPERACAO, {
      expectedVersion: VERSAO.toISOString(),
      idempotencyKey: 'nota-0001',
      note: 'x',
    } as never);

    expect(repository.addNote).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsOwner: true }),
    );
  });

  it('checklist leva a flag', async () => {
    const { service, repository } = servico();

    await service.updateChecklist(ator(DONO, true), OPERACAO, 'c', {
      expectedVersion: VERSAO.toISOString(),
      idempotencyKey: 'chk-00001',
      answers: {},
    } as never);

    expect(repository.updateChecklist).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsOwner: true }),
    );
  });
});
