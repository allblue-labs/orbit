/**
 * Quem pode anexar evidência a uma execução de PMOC.
 *
 * ## A regra
 *
 * O técnico daquela execução, com perfil de campo ativo e vínculo com a unidade,
 * enquanto a execução corre. A permissão pode ser a de **gerenciar** o módulo ou
 * a de **executar** em campo — as duas autoridades são legítimas sobre o mesmo
 * anexo, e exigir a primeira excluía justamente quem tira a foto.
 *
 * ## Por que este teste existe
 *
 * O portão exigia só `pmoc.manage`. Enquanto o PMOC não era atendido pelo
 * celular, ninguém notava; no dia em que o técnico passou a atender, ele
 * registrava a manutenção e não conseguia anexar a evidência — que é o que o
 * relatório imprime como prova. O defeito não aparecia: a tela mostrava a seção,
 * o envio voltava negado.
 */
import { MobileEvidenceRepository } from './mobile-evidence.repository';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIDADE = '01900000-0000-7000-8000-000000000002';
const TECNICO = '01900000-0000-7000-8000-000000000003';
const EXECUCAO = '01900000-0000-7000-8000-000000000004';

function bancada({
  permissions,
  responsibleFieldTechnicianId = TECNICO,
  status = 'IN_PROGRESS',
  hasProfile = true,
  hasMembership = true,
}: {
  permissions: readonly string[];
  responsibleFieldTechnicianId?: string;
  status?: string;
  hasProfile?: boolean;
  hasMembership?: boolean;
}) {
  const tx = {
    organizationMembership: {
      findFirst: jest.fn().mockResolvedValue({ role: { permissions } }),
    },
    businessUnitMembership: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest
        .fn()
        .mockResolvedValue(hasMembership ? { id: 'membership' } : null),
    },
    professionalProfile: {
      findFirst: jest
        .fn()
        .mockResolvedValue(hasProfile ? { id: 'perfil' } : null),
    },
    pmocEquipmentExecution: {
      findFirst: jest.fn().mockResolvedValue({
        id: EXECUCAO,
        businessUnitId: UNIDADE,
        status,
        operationId: null,
        responsibleFieldTechnicianId,
        operation: null,
      }),
    },
  };
  const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
  const repository = new MobileEvidenceRepository(rls as never);
  const actor = {
    id: TECNICO,
    organizationId: ORG,
    businessUnitIds: [UNIDADE],
  };
  return {
    autorizar: () =>
      repository.authorizeTarget(
        actor as never,
        'PMOC_EQUIPMENT_EXECUTION',
        EXECUCAO,
      ),
  };
}

describe('evidência de uma execução de PMOC', () => {
  it('o técnico de campo anexa com pmoc.execute', async () => {
    /* É o conjunto real do papel de campo: executa, e **não** gerencia. */
    const { autorizar } = bancada({
      permissions: ['pmoc.read', 'pmoc.execute'],
    });

    await expect(autorizar()).resolves.toMatchObject({ denied: false });
  });

  it('quem gerencia continua anexando', async () => {
    const { autorizar } = bancada({ permissions: ['pmoc.manage'] });

    await expect(autorizar()).resolves.toMatchObject({ denied: false });
  });

  it('sem nenhuma das duas, não anexa', async () => {
    /* Ler o PMOC não é participar dele. */
    const { autorizar } = bancada({ permissions: ['pmoc.read'] });

    await expect(autorizar()).resolves.toMatchObject({ denied: true });
  });

  it('a permissão não substitui a atribuição', async () => {
    /* O portão tem mais de uma tranca: quem não é o técnico daquela execução não
       anexa nem com a permissão certa — a foto é prova do que aquela pessoa viu. */
    const { autorizar } = bancada({
      permissions: ['pmoc.execute'],
      responsibleFieldTechnicianId: '01900000-0000-7000-8000-00000000000f',
    });

    await expect(autorizar()).resolves.toMatchObject({ denied: true });
  });

  it('execução concluída não recebe mais evidência', async () => {
    const { autorizar } = bancada({
      permissions: ['pmoc.execute'],
      status: 'COMPLETED',
    });

    await expect(autorizar()).resolves.toMatchObject({ denied: true });
  });

  it('sem perfil de campo ativo, não anexa', async () => {
    const { autorizar } = bancada({
      permissions: ['pmoc.execute'],
      hasProfile: false,
    });

    await expect(autorizar()).resolves.toMatchObject({ denied: true });
  });
});
