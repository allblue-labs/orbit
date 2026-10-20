/**
 * Quem pode concluir a manutenção de um equipamento.
 *
 * ## A regra
 *
 * O técnico escalado para aquela execução, ou o dono da organização — que atende
 * quando o escalado faltou.
 *
 * ## Por que ela não é `pmoc.manage`
 *
 * Essa permissão diz que a pessoa **administra** o módulo: cria plano, cobre
 * equipamento, encerra contrato. Executar a manutenção de um aparelho é outra
 * coisa. Sem a distinção, qualquer pessoa com acesso ao módulo assinava a
 * manutenção de uma máquina que nunca viu — e o documento sai com o nome dela,
 * como prova de conformidade perante a Lei 13.589/2018.
 *
 * ## O que este teste garante além da recusa
 *
 * Que a restrição viaja **dentro** do claim, junto do status. Conferir antes e
 * gravar depois deixaria a janela em que a atribuição muda entre a leitura e a
 * escrita — e o que se está gravando é quem assina um documento legal.
 *
 * E que cada recusa diz qual recusa é: "não está em andamento" para quem não é o
 * técnico mandaria a pessoa procurar o estado errado.
 */
import { PmocService, type PmocActor } from './pmoc.service';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
} from '../../exceptions';

const TECNICO = 'user-tecnico';
const OUTRO = 'user-outro';
const DONO = 'user-dono';

const ator = (actorId: string, isOrganizationOwner = false): PmocActor => ({
  organizationId: 'org-1',
  actorId,
  permissions: ['pmoc.manage', 'operations.manage'],
  businessUnitIds: ['bu-1'],
  isOrganizationOwner,
});

function servico(resposta: unknown) {
  const repository = {
    completeEquipmentExecution: jest.fn().mockResolvedValue(resposta),
  };
  const mapper = { equipmentExecution: jest.fn((row: unknown) => row) };
  const service = new PmocService(
    repository as never,
    mapper as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    /* Storage: estes testes não imprimem documento, e o dublê diz isso. */
    undefined as never,
  );
  return { service, repository };
}

const sucesso = {
  refused: null,
  allResolved: false,
  nextDueOn: null,
  execution: { id: 'exec-1' },
};

const concluir = (service: PmocService, quem: PmocActor) =>
  service.completeEquipmentExecution('plan-1', 'cycle-1', 'exec-1', quem, {});

/**
 * Quem pode **abrir** o atendimento pelo celular.
 *
 * A regra: o técnico a quem o plano foi atribuído, ou o dono. E ele abre para si
 * mesmo — escalar outra pessoa é gerenciar, e gerenciar tem outra porta.
 *
 * Antes desta separação o técnico não conseguia atender um PMOC nem quando o
 * plano era dele: a única porta exigia `pmoc.manage`, que o papel de campo não
 * tem.
 */
describe('autoridade para abrir o próprio atendimento', () => {
  const preparacao = (technicianUserId: string | null) => ({
    plan: {
      id: 'plan-1',
      businessUnitId: 'bu-1',
      status: 'ACTIVE',
      technicalResponsibleUserId: 'rt-1',
      technicianUserId,
      procedure: {},
      technicalResponsible: { id: 'rt-1', displayName: 'Marcos' },
      customer: { id: 'cust-1' },
    },
    cycle: { id: 'cycle-1', status: 'PENDING', dueOn: new Date() },
    coverage: { id: 'cov-1', asset: { status: 'ACTIVE', name: 'Split' } },
  });

  function servicoDeAbertura(technicianUserId: string | null) {
    const repository = {
      executionPreparation: jest
        .fn()
        .mockResolvedValue(preparacao(technicianUserId)),
      startEquipmentExecution: jest.fn(),
    };
    const service = new PmocService(
      repository as never,
      { equipmentExecution: jest.fn() } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      /* Storage: estes testes não imprimem documento, e o dublê diz isso. */
      undefined as never,
    );
    return { service, repository };
  }

  const abrir = (service: PmocService, quem: PmocActor) =>
    service.startMyEquipmentExecution('plan-1', 'cycle-1', 'asset-1', quem);

  it('recusa quando o plano não é do técnico', async () => {
    const { service, repository } = servicoDeAbertura(OUTRO);

    await expect(abrir(service, ator(TECNICO))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    /* A recusa nomeia a regra: quem lê descobre que precisa da atribuição. */
    await expect(abrir(service, ator(TECNICO))).rejects.toThrow(
      /não está atribuído a você/i,
    );
    expect(repository.startEquipmentExecution).not.toHaveBeenCalled();
  });

  it('recusa quando o plano não tem técnico atribuído', async () => {
    const { service } = servicoDeAbertura(null);

    await expect(abrir(service, ator(TECNICO))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('o dono abre sem atribuição', async () => {
    /* É ele que atende quando o escalado faltou. */
    const { service } = servicoDeAbertura(OUTRO);

    /* Passa da checagem de atribuição; o resto do caminho é o mesmo da outra
       porta e falha adiante por falta de colaboradores no stub. */
    await expect(abrir(service, ator(DONO, true))).rejects.not.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /*
   * Abre **para si mesmo**.
   *
   * É o que distingue esta porta da de gerenciar: escalar outra pessoa é decisão
   * de quem organiza o trabalho, não de quem chegou ao local. Sem esta asserção,
   * trocar o id por outro qualquer passava — e um técnico abriria atendimento no
   * nome de um colega.
   */
  it('escala o próprio ator, nunca outro', async () => {
    const { service } = servicoDeAbertura(TECNICO);
    const delegado = jest
      .spyOn(service, 'startEquipmentExecution')
      .mockResolvedValue(undefined as never);

    await abrir(service, ator(TECNICO));

    expect(delegado).toHaveBeenCalledWith(
      'plan-1',
      'cycle-1',
      'asset-1',
      expect.objectContaining({ actorId: TECNICO }),
      { responsibleFieldTechnicianId: TECNICO },
    );
  });

  it('não encontrado quando a cobertura não existe', async () => {
    const { service, repository } = servicoDeAbertura(TECNICO);
    repository.executionPreparation.mockResolvedValue(null);

    await expect(abrir(service, ator(TECNICO))).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });
});

/**
 * Quem pode **emitir** o relatório de uma execução.
 *
 * O documento é a prova de conformidade, e sai com o nome de quem atendeu. Por
 * isso a regra é a mesma de concluir — o escalado daquela execução, ou o dono —
 * e não a de gerenciar o módulo.
 *
 * Antes desta porta o técnico concluía a manutenção pelo celular e ficava sem
 * emitir: `pmoc.manage` era exigido, e o papel de campo não tem.
 */
describe('autoridade para emitir o relatório da execução', () => {
  function servicoDeEmissao(resposta: unknown) {
    const repository = {
      createEquipmentArtifact: jest.fn().mockResolvedValue(resposta),
    };
    const service = new PmocService(
      repository as never,
      { equipmentExecution: jest.fn() } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      /* Storage: estes testes não imprimem documento, e o dublê diz isso. */
      undefined as never,
    );
    return { service, repository };
  }

  /*
   * O ator é o do campo: `pmoc.execute` e `artifact_rendering.render`, que é o
   * que o papel de técnico de fato carrega — **sem** `pmoc.manage`. Testar com o
   * conjunto do administrador esconderia exatamente o que esta porta resolve.
   */
  const emissor = (
    actorId: string,
    isOrganizationOwner = false,
  ): PmocActor => ({
    ...ator(actorId, isOrganizationOwner),
    permissions: ['pmoc.execute', 'artifact_rendering.render'],
  });

  const emitir = (service: PmocService, quem: PmocActor) =>
    service.generateMyEquipmentArtifact('exec-1', quem, {
      renderer: 'pdf.default',
    });

  it('restringe ao próprio ator quando não é o dono', async () => {
    const { service, repository } = servicoDeEmissao({
      artifactExecutionId: 'art-1',
      renderStatus: 'READY',
      created: false,
    });

    await emitir(service, emissor(TECNICO));

    /* A restrição vai para o repositório, que a confere dentro da transação da
       escrita — junto do lock que garante a idempotência. */
    expect(repository.createEquipmentArtifact).toHaveBeenCalledWith(
      'org-1',
      'exec-1',
      TECNICO,
      TECNICO,
    );
  });

  it('o dono emite sem restrição de atribuição', async () => {
    const { service, repository } = servicoDeEmissao({
      artifactExecutionId: 'art-1',
      renderStatus: 'READY',
      created: false,
    });

    await emitir(service, emissor(DONO, true));

    expect(repository.createEquipmentArtifact).toHaveBeenCalledWith(
      'org-1',
      'exec-1',
      DONO,
      null,
    );
  });

  it('recusa quem não é o escalado, dizendo que é isso', async () => {
    const { service } = servicoDeEmissao({ refused: 'NOT_ASSIGNED' });

    await expect(emitir(service, emissor(OUTRO))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(emitir(service, emissor(OUTRO))).rejects.toThrow(
      /técnico escalado/i,
    );
  });

  it('execução inexistente continua sendo não encontrada', async () => {
    const { service } = servicoDeEmissao(null);

    /* Dois desfechos distintos, dois erros distintos: recusa de escala não é
       ausência de registro, e trocá-los manda a pessoa procurar a coisa errada. */
    await expect(emitir(service, emissor(TECNICO))).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('exige a permissão de renderizar', async () => {
    const { service, repository } = servicoDeEmissao(null);
    const semRender: PmocActor = {
      ...emissor(TECNICO),
      permissions: ['pmoc.execute'],
    };

    await expect(emitir(service, semRender)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.createEquipmentArtifact).not.toHaveBeenCalled();
  });
});

describe('autoridade para concluir a execução de um equipamento', () => {
  it('restringe ao próprio ator quando não é o dono', async () => {
    const { service, repository } = servico(sucesso);

    await concluir(service, ator(TECNICO));

    /* A restrição vai para o repositório, que a coloca no `where` do claim. */
    expect(repository.completeEquipmentExecution).toHaveBeenCalledWith(
      expect.objectContaining({ restrictToTechnicianId: TECNICO }),
    );
  });

  it('o dono conclui sem restrição de atribuição', async () => {
    const { service, repository } = servico(sucesso);

    await concluir(service, ator(DONO, true));

    /* `null` é a ausência de restrição — é assim que o dono atende a execução de
       um técnico que faltou, sem precisar de reatribuição. */
    expect(repository.completeEquipmentExecution).toHaveBeenCalledWith(
      expect.objectContaining({ restrictToTechnicianId: null }),
    );
  });

  it('recusa quem não é o técnico escalado, dizendo que é isso', async () => {
    const { service } = servico({ refused: 'NOT_ASSIGNED' });

    await expect(concluir(service, ator(OUTRO))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    /* A mensagem nomeia a regra: quem lê descobre o que fazer — pedir a
       atribuição — em vez de procurar um estado que está correto. */
    await expect(concluir(service, ator(OUTRO))).rejects.toThrow(
      /técnico escalado/i,
    );
  });

  it('execução já concluída continua sendo conflito, não permissão', async () => {
    const { service } = servico({ refused: 'NOT_IN_PROGRESS' });

    /* Dois motivos distintos, dois erros distintos: juntá-los faria o técnico
       certo receber "você não tem permissão" ao clicar duas vezes. */
    await expect(concluir(service, ator(TECNICO))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('execução inexistente é não encontrada', async () => {
    const { service } = servico({ refused: 'NOT_FOUND' });

    await expect(concluir(service, ator(TECNICO))).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('não grava manutenção no futuro', async () => {
    const { service, repository } = servico(sucesso);
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await expect(
      service.completeEquipmentExecution(
        'plan-1',
        'cycle-1',
        'exec-1',
        ator(TECNICO),
        { performedAt: amanha },
      ),
    ).rejects.toThrow(/future/i);
    expect(repository.completeEquipmentExecution).not.toHaveBeenCalled();
  });
});
