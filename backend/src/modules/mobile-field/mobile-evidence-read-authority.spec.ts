/**
 * Ler as evidências de um atendimento é leitura — não escrita.
 *
 * ## O defeito
 *
 * `list` recusava com 404 tudo o que o portão de **escrita** recusava, e esse
 * portão inclui `mutable` (o atendimento ainda estar aberto), `assigned` (ser
 * quem executa) e perfil de campo ativo. O efeito na etapa Evidências do
 * roteiro era a frase "Este registro não está disponível" no lugar da lista —
 * para o dono da organização, para quem não executava aquele atendimento, e
 * para qualquer um que abrisse um atendimento já concluído.
 *
 * Eram duas perguntas diferentes atendidas pela mesma tranca: "posso anexar
 * aqui?" e "posso ver o que já foi anexado?".
 */
import { MobileEvidenceRepository } from './mobile-evidence.repository';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIDADE = '01900000-0000-7000-8000-000000000002';
const ATOR = '01900000-0000-7000-8000-000000000003';
const ATENDIMENTO = '01900000-0000-7000-8000-000000000004';
const OUTRO = '01900000-0000-7000-8000-00000000000f';

function bancada({
  permissions,
  responsibleFieldTechnicianId = ATOR,
  status = 'IN_PROGRESS',
  hasProfile = true,
  hasMembership = true,
}: {
  permissions: readonly string[];
  responsibleFieldTechnicianId?: string | null;
  status?: string;
  hasProfile?: boolean;
  hasMembership?: boolean;
}) {
  const tx = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ settings: null }),
    },
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
    operation: {
      findFirst: jest.fn().mockResolvedValue({
        id: ATENDIMENTO,
        businessUnitId: UNIDADE,
        status,
        responsibleFieldTechnicianId,
        auxiliaryTechnicians: [],
      }),
    },
    fieldEvidence: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
  const repository = new MobileEvidenceRepository(rls as never);
  const actor = { id: ATOR, organizationId: ORG, businessUnitIds: [UNIDADE] };
  return {
    autorizar: () =>
      repository.authorizeTarget(actor as never, 'OPERATION', ATENDIMENTO),
    listar: () => repository.list(actor as never, 'OPERATION', ATENDIMENTO, 50),
  };
}

describe('ver as evidências de um atendimento', () => {
  /**
   * O caso relatado, em um teste.
   *
   * O dono abre o atendimento no celular e a etapa Evidências diz "este
   * registro não está disponível". Ele tem `operations.read`, está na unidade e
   * o atendimento é dele — o que falta é ser o técnico escalado, que é
   * requisito de **anexar**.
   */
  it('quem não executa o atendimento continua vendo o que foi anexado', async () => {
    const { autorizar, listar } = bancada({
      permissions: ['operations.read'],
      responsibleFieldTechnicianId: OUTRO,
    });

    await expect(autorizar()).resolves.toMatchObject({
      readable: true,
      denied: true,
    });
    await expect(listar()).resolves.toEqual([]);
  });

  /** A foto é a prova do serviço entregue: ela não some ao encerrar. */
  it('atendimento concluído continua tendo evidências legíveis', async () => {
    const { autorizar, listar } = bancada({
      permissions: ['operations.read'],
      status: 'COMPLETED',
    });

    await expect(autorizar()).resolves.toMatchObject({
      readable: true,
      denied: true,
    });
    await expect(listar()).resolves.toEqual([]);
  });

  /** Perfil de campo é requisito de quem registra, não de quem confere. */
  it('sem perfil de técnico de campo, ainda lê', async () => {
    const { autorizar } = bancada({
      permissions: ['operations.read'],
      hasProfile: false,
    });

    await expect(autorizar()).resolves.toMatchObject({ readable: true });
  });

  /** Sem vínculo com a unidade não há nem leitura: é outro inquilino de fato. */
  it('sem vínculo com a unidade, não lê', async () => {
    const { autorizar, listar } = bancada({
      permissions: ['operations.read'],
      hasMembership: false,
    });

    await expect(autorizar()).resolves.toMatchObject({ readable: false });
    await expect(listar()).resolves.toBeNull();
  });

  /** Nenhuma permissão de atendimento: não lê. */
  it('sem permissão de leitura de atendimento, não lê', async () => {
    const { autorizar, listar } = bancada({ permissions: ['pmoc.read'] });

    await expect(autorizar()).resolves.toMatchObject({ readable: false });
    await expect(listar()).resolves.toBeNull();
  });

  /** `operations.update` também lê: quem escreve não precisa de duas chaves. */
  it('quem pode alterar o atendimento também lê', async () => {
    const { autorizar } = bancada({ permissions: ['operations.update'] });

    await expect(autorizar()).resolves.toMatchObject({ readable: true });
  });

  it('o curinga lê', async () => {
    const { autorizar } = bancada({ permissions: ['*'] });

    await expect(autorizar()).resolves.toMatchObject({ readable: true });
  });

  /**
   * O portão de escrita não foi afrouxado.
   *
   * É a metade que importa deste teste: separar leitura de escrita não pode ter
   * passado a deixar qualquer leitor anexar foto a um atendimento que não é
   * dele.
   */
  it('quem lê não passa a anexar', async () => {
    const { autorizar } = bancada({
      permissions: ['operations.read'],
      responsibleFieldTechnicianId: OUTRO,
    });

    await expect(autorizar()).resolves.toMatchObject({ denied: true });
  });

  it('o técnico escalado, com o atendimento aberto, anexa', async () => {
    const { autorizar } = bancada({ permissions: ['operations.update'] });

    await expect(autorizar()).resolves.toMatchObject({
      denied: false,
      readable: true,
    });
  });
});
