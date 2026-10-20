/**
 * Cadastro de pessoas da equipe, senha temporária e recuperação de senha.
 *
 * O que só aqui se prova:
 *
 * - a organização nasce com os papéis de técnico, e o auxiliar **não** executa;
 * - a senha temporária sai uma vez, obriga a troca e morre na troca;
 * - o link de definição vale uma vez, e o dono da organização não recebe um;
 * - `POST /identity/password/forgot` responde igual exista a conta ou não —
 *   antes ele era um oráculo de enumeração: 202 para inexistente, 500 para
 *   existente quando o SMTP estava fora;
 * - desligar tira o acesso agora, inclusive das sessões já abertas.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);

const PASSWORD = 'Orbit#TeamMembers@2026';

interface Envelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface Membro {
  userId: string;
  displayName: string;
  email: string;
  role: { id: string; key: string; name: string };
  businessUnits: { id: string; legalName: string; tradeName: string | null }[];
  access: {
    useRoleDefaults: boolean;
    permissions: string[];
    allowedSurfaces: string[];
  };
}

interface Papel {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  allowedSurfaces: string[];
}

const digits = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

const cnpj = () => {
  const base = digits(8) + '0001';
  const check = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      value
        .split('')
        .reduce(
          (sum, digit, index) => sum + Number(digit) * weights[index]!,
          0,
        ) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = check(base);
  return `${base}${first}${check(`${base}${first}`)}`;
};

describe('Team members, temporary password and recovery (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = adminPrisma();
  let http: () => request.Agent;
  let ownerToken: string;
  let neighbourToken: string;
  let ownerUserId: string;
  let ownerOrganizationId: string;
  let secondBusinessUnitId: string;
  let operacional: Papel;
  let auxiliar: Papel;

  const auth = (test: request.Test, token = ownerToken) =>
    test.set('Authorization', `Bearer ${token}`);

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `team.${label}.${suffix}@orbit.local`;
    const response = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Team',
        lastName: label,
        password: PASSWORD,
        organizationName: `Team ${label} ${suffix}`,
        legalName: `Team ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
        planKey: 'ENTERPRISE_UNLIMITED',
      })
      .expect(201);
    return {
      email,
      token: (response.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }

  async function criarMembro(
    body: Record<string, unknown> = {},
    token = ownerToken,
    expected = 201,
  ) {
    const response = await auth(
      http().post('/api/v1/organizations/current/team/members'),
      token,
    )
      .send({
        email: `tecnico.${digits(8)}@orbit.local`,
        firstName: 'Joao',
        lastName: 'Campo',
        roleId: operacional.id,
        ...body,
      })
      .expect(expected);
    return response.body as Envelope<{
      member: Membro;
      temporaryPassword: string;
    }>;
  }

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    http = () => request(app.getHttpServer());

    const owner = await register('owner');
    ownerToken = owner.token;
    neighbourToken = (await register('neighbour')).token;
    ownerUserId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: owner.email },
        select: { id: true },
      })
    ).id;

    const organization = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    ownerOrganizationId = (organization.body as Envelope<{ id: string }>).data
      .id;
    const secondUnit = await auth(
      http().post('/api/v1/organizations/current/business-units'),
    )
      .send({
        legalName: `Team Filial ${digits(6)} LTDA`,
        tradeName: 'Filial Norte',
        type: 'BRANCH',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Olinda',
        street: 'Rua da Filial',
        stateCode: 'PE',
      })
      .expect(201);
    secondBusinessUnitId = (secondUnit.body as Envelope<{ id: string }>).data
      .id;

    const roles = await auth(
      http().get('/api/v1/organizations/current/roles'),
    ).expect(200);
    const lista = (roles.body as Envelope<Papel[]>).data;
    operacional = lista.find((papel) => papel.key === 'FIELD_TECHNICIAN')!;
    auxiliar = lista.find((papel) => papel.key === 'ASSISTANT_TECHNICIAN')!;
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('a organização nasce com os papéis de técnico, e eles se distinguem', () => {
    expect(operacional).toBeDefined();
    expect(auxiliar).toBeDefined();

    /**
     * A diferença é o que justifica dois papéis.
     *
     * Os dois leem o atendimento; só o operacional executa e emite. Se o
     * auxiliar também executasse, a distinção seria decorativa e a tela estaria
     * prometendo um controle que não existe.
     */
    expect(auxiliar.permissions).toContain('operations.read');
    expect(auxiliar.permissions).not.toContain('checklists.execute');
    expect(auxiliar.permissions).not.toContain('artifact_manifests.issue');
    expect(operacional.permissions).toContain('checklists.execute');
    expect(operacional.permissions).toContain('artifact_manifests.issue');
  });

  it('publica todos os presets atribuíveis sem transformar Owner em opção', async () => {
    const response = await auth(
      http().get('/api/v1/organizations/current/roles'),
    ).expect(200);
    const keys = (response.body as Envelope<Papel[]>).data.map(
      (role) => role.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'ADMINISTRATOR',
        'FIELD_TECHNICIAN',
        'ASSISTANT_TECHNICIAN',
        'TECHNICAL_RESPONSIBLE',
        'CUSTOMER_SERVICE',
        'FINANCIAL',
        'VIEWER',
      ]),
    );
    expect(keys).not.toContain('OWNER');
  });

  it('deriva Owner da organização, sem wildcard persistido, e inclui unidade futura', async () => {
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: ownerOrganizationId, key: 'OWNER' },
      select: { permissions: true },
    });
    expect(ownerRole.permissions).toEqual([]);

    const response = await auth(
      http().get('/api/v1/identity/me/access'),
    ).expect(200);
    const access = (
      response.body as Envelope<{
        isOwner: boolean;
        permissions: string[];
        surfaceAccess: string[];
        unitIds: string[];
      }>
    ).data;
    expect(access.isOwner).toBe(true);
    expect(access.surfaceAccess).toEqual(
      expect.arrayContaining(['WEB', 'MOBILE', 'API']),
    );
    expect(access.unitIds).toContain(secondBusinessUnitId);
  });

  it('permite ao Owner ler e iniciar a própria assinatura sem perfil RBAC artificial', async () => {
    const response = await auth(
      http().get('/api/v1/identity/me/signature'),
    ).expect(200);
    expect(
      (response.body as Envelope<{ signatureAvailable: boolean }>).data
        .signatureAvailable,
    ).toBe(false);

    const upload = await auth(
      http().post('/api/v1/identity/me/signature/uploads'),
    )
      .send({
        fileName: 'assinatura-owner.png',
        mimeType: 'image/png',
        sizeBytes: 128,
      })
      .expect(201);
    expect(
      (upload.body as Envelope<{ fileId: string; upload: { method: string } }>)
        .data,
    ).toMatchObject({ upload: { method: 'PUT' } });
  });

  it('cadastra acesso personalizado em múltiplas unidades e publica o efetivo', async () => {
    const organization = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const primaryUnitId = (
      organization.body as Envelope<{ businessUnits: { id: string }[] }>
    ).data.businessUnits.find((unit) => unit.id !== secondBusinessUnitId)!.id;

    const created = await criarMembro({
      businessUnitIds: [primaryUnitId, secondBusinessUnitId],
      useRoleDefaults: false,
      permissions: ['operations.read'],
      allowedSurfaces: ['MOBILE'],
    });
    expect(
      created.data.member.businessUnits.map((unit) => unit.id).sort(),
    ).toEqual([primaryUnitId, secondBusinessUnitId].sort());
    expect(created.data.member.access).toEqual({
      useRoleDefaults: false,
      permissions: ['operations.read'],
      allowedSurfaces: ['MOBILE'],
    });
  });

  it('nega uma rota mobile diretamente para uma conta somente Web', async () => {
    const created = await criarMembro({
      useRoleDefaults: false,
      permissions: ['operations.read'],
      allowedSurfaces: ['WEB'],
    });
    const login = await http()
      .post('/api/v1/identity/login')
      .send({
        email: created.data.member.email,
        password: created.data.temporaryPassword,
        client: 'WEB',
      })
      .expect(200);
    const token = (login.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    await auth(http().get('/api/v1/mobile/field/home'), token).expect(403);
  });

  it('impede autoconcessão e delegação acima da autoridade do gestor', async () => {
    const roleResponse = await auth(
      http().post('/api/v1/organizations/current/roles'),
    )
      .send({
        name: `Gestor limitado ${digits(5)}`,
        permissions: ['organization.members.update'],
        allowedSurfaces: ['WEB'],
      })
      .expect(201);
    const role = (roleResponse.body as Envelope<Papel>).data;
    const manager = await criarMembro({ roleId: role.id });
    const login = await http()
      .post('/api/v1/identity/login')
      .send({
        email: manager.data.member.email,
        password: manager.data.temporaryPassword,
        client: 'WEB',
      })
      .expect(200);
    const token = (login.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const accessResponse = await auth(
      http().get('/api/v1/identity/me/access'),
      token,
    ).expect(200);
    const managerAccess = (
      accessResponse.body as Envelope<{
        permissions: string[];
        unitIds: string[];
      }>
    ).data;
    expect(managerAccess.permissions).toContain('organization.members.update');
    expect(managerAccess.unitIds).not.toHaveLength(0);

    await auth(
      http().patch(
        `/api/v1/organizations/current/members/${manager.data.member.userId}`,
      ),
      token,
    )
      .send({ allowedSurfaces: ['WEB', 'MOBILE'] })
      .expect(400);

    const denial = await criarMembro(
      {
        roleId: auxiliar.id,
        useRoleDefaults: false,
        permissions: ['organization.members.update', 'financial.manage'],
        allowedSurfaces: ['WEB'],
      },
      token,
      403,
    );
    expect((denial as unknown as ErrorEnvelope).error.code).toBe('FORBIDDEN');
  });

  it('a senha temporária sai uma vez, obriga a troca e morre na troca', async () => {
    const criado = await criarMembro();
    const senha = criado.data.temporaryPassword;

    /** Ditável: blocos, sem caracteres que se confundem ao telefone. */
    expect(senha).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    /** Em claro em lugar nenhum: o que fica gravado é o hash. */
    const credencial = await prisma.credential.findUniqueOrThrow({
      where: { userId: criado.data.member.userId },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(credencial.passwordHash).not.toContain(senha);
    expect(credencial.mustChangePassword).toBe(true);

    const entrada = await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: senha,
        client: 'MOBILE',
      })
      .expect(200);
    const sessao = (
      entrada.body as Envelope<{
        accessToken: string;
        mustChangePassword: boolean;
      }>
    ).data;

    /** O cliente decide a primeira tela sem uma segunda chamada. */
    expect(sessao.mustChangePassword).toBe(true);

    const perfil = await auth(
      http().get('/api/v1/identity/me'),
      sessao.accessToken,
    ).expect(200);
    expect(
      (perfil.body as Envelope<{ mustChangePassword: boolean }>).data
        .mustChangePassword,
    ).toBe(true);

    const nova = 'Tecnico#Propria@2026';
    await auth(http().post('/api/v1/identity/me/password'), sessao.accessToken)
      .send({ currentPassword: senha, newPassword: nova })
      .expect(204);

    const depois = await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: nova,
        client: 'MOBILE',
      })
      .expect(200);
    expect(
      (depois.body as Envelope<{ mustChangePassword: boolean }>).data
        .mustChangePassword,
    ).toBe(false);

    /** A senha que o dono conhecia deixa de abrir a conta. */
    await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: senha,
        client: 'MOBILE',
      })
      .expect(401);
  });

  it('o link de definição vale uma vez, e não existe para o dono', async () => {
    const criado = await criarMembro();
    const userId = criado.data.member.userId;

    const emitido = await auth(
      http().post(
        `/api/v1/organizations/current/team/members/${userId}/password-link`,
      ),
    ).expect(201);
    const link = (emitido.body as Envelope<{ link: string }>).data.link;
    expect(link).toContain('/redefinir-senha?token=');

    const token = new URL(link).searchParams.get('token')!;
    const senha = 'Tecnico#PeloLink@2026';
    await http()
      .post('/api/v1/identity/password/reset')
      .send({ token, password: senha })
      .expect(204);
    await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: senha,
        client: 'MOBILE',
      })
      .expect(200);

    /** Um link usado é um link gasto. */
    await http()
      .post('/api/v1/identity/password/reset')
      .send({ token, password: 'Outra#Senha@2026' })
      .expect(400);

    /**
     * O dono não recebe link por aqui.
     *
     * Quem administra a organização poderia gerar um para a conta do dono e
     * assumir o lugar dele. O dono usa o fluxo público, que exige acesso ao
     * e-mail dele.
     */
    await auth(
      http().post(
        `/api/v1/organizations/current/team/members/${ownerUserId}/password-link`,
      ),
    ).expect(400);

    /** E o vizinho não alcança a minha gente. */
    await auth(
      http().post(
        `/api/v1/organizations/current/team/members/${userId}/password-link`,
      ),
      neighbourToken,
    ).expect(404);
  });

  it('o fluxo público responde igual exista a conta ou não', async () => {
    const criado = await criarMembro();

    /**
     * A regressão que este teste tranca.
     *
     * Sem SMTP configurado, o envio estourava e o endpoint devolvia 500 —
     * **só** para e-mail existente, porque o inexistente saía antes do envio.
     * Comparar os dois códigos dizia se uma pessoa tem conta no Orbit.
     */
    const existente = await http()
      .post('/api/v1/identity/password/forgot')
      .send({ email: criado.data.member.email });
    const inexistente = await http()
      .post('/api/v1/identity/password/forgot')
      .send({ email: `ninguem.${digits(10)}@orbit.local` });

    expect(existente.status).toBe(202);
    expect(inexistente.status).toBe(202);
    /*
      O corpo, e não o envelope.

      `requestId` e `timestamp` mudam a cada requisição por construção — são
      justamente os campos que não podem ser iguais. O que não pode diferir é a
      resposta que o visitante lê.
    */
    const corpo = (resposta: { body: unknown }) =>
      resposta.body as { success: boolean; data: unknown };
    expect(corpo(existente).data).toEqual(corpo(inexistente).data);
    expect(corpo(existente).success).toBe(corpo(inexistente).success);

    /** E o token nunca aparece na resposta pública. */
    expect(JSON.stringify(existente.body)).not.toContain('token');
  });

  it('nenhum papel com curinga é atribuível pela equipe', async () => {
    const dono = await prisma.role.findFirstOrThrow({
      where: { organizationId: ownerOrganizationId, key: 'OWNER' },
      select: { id: true },
    });

    await criarMembro({ roleId: dono.id }, ownerToken, 400);

    /**
     * E não é pelo nome.
     *
     * A organização pode criar papéis próprios. Um papel sob medida com `['*']`
     * teria passado enquanto a recusa olhava só para a chave `OWNER` — e quem o
     * recebesse poderia remover quem o cadastrou.
     */
    await auth(http().post('/api/v1/organizations/current/roles'))
      .send({ name: `Faz tudo ${digits(4)}`, permissions: ['*'] })
      .expect(400);

    /** Um papel sob medida **sem** curinga continua atribuível. */
    const restrito = await auth(
      http().post('/api/v1/organizations/current/roles'),
    )
      .send({
        name: `Só leitura ${digits(4)}`,
        permissions: ['operations.read'],
      })
      .expect(201);
    await criarMembro(
      { roleId: (restrito.body as Envelope<Papel>).data.id },
      ownerToken,
      201,
    );
  });

  /* ---------------------------------------------------------------- */
  /* Superfície: o campo é do aplicativo, o painel é da administração   */
  /* ---------------------------------------------------------------- */

  it('os papéis de campo nascem só para o aplicativo', async () => {
    const roles = await auth(
      http().get('/api/v1/organizations/current/roles'),
    ).expect(200);
    const lista = (roles.body as Envelope<Papel[]>).data;

    expect(lista.find((papel) => papel.key === 'OWNER')).toBeUndefined();

    for (const chave of ['FIELD_TECHNICIAN', 'ASSISTANT_TECHNICIAN']) {
      const papel = lista.find((item) => item.key === chave)!;
      expect(papel.allowedSurfaces).toEqual(['MOBILE']);
    }
  });

  it('o técnico entra no aplicativo e é recusado no painel web', async () => {
    const criado = await criarMembro();
    const credencial = {
      email: criado.data.member.email,
      password: criado.data.temporaryPassword,
    };

    await http()
      .post('/api/v1/identity/login')
      .send({ ...credencial, client: 'MOBILE' })
      .expect(200);

    /**
     * A regressão que este teste tranca.
     *
     * O login não olhava `client` para nada além de registrar a sessão. Um
     * técnico recém-cadastrado entrava no painel e lia a organização inteira —
     * clientes, contratos, financeiro — com a senha temporária que o dono
     * acabara de lhe passar.
     */
    const recusa = await http()
      .post('/api/v1/identity/login')
      .send({ ...credencial, client: 'WEB' })
      .expect(403);

    /**
     * Código próprio, e não um `FORBIDDEN` genérico.
     *
     * A tela precisa dizer onde a conta funciona. Um erro genérico faz a
     * pessoa tentar a senha de novo, e a senha não tem nada de errado.
     */
    expect((recusa.body as ErrorEnvelope).error.code).toBe(
      'SURFACE_NOT_ALLOWED',
    );
  });

  it('a senha errada continua sendo 401, e não denuncia a superfície', async () => {
    const criado = await criarMembro();

    /**
     * A ordem importa: superfície **depois** da credencial.
     *
     * Recusar por superfície antes de conferir a senha diria a quem tentasse
     * que aquele endereço existe e é de campo — um oráculo de enumeração de
     * contas com outro nome.
     */
    await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: 'senha-que-nao-e-a-dele',
        client: 'WEB',
      })
      .expect(401);
  });

  it('a sessão web já emitida morre na renovação', async () => {
    const criado = await criarMembro();

    /**
     * Uma sessão web de técnico só existe de antes desta regra — o login não a
     * emite mais. O teste a fabrica pelo caminho permitido e troca a
     * superfície da linha, que é o estado em que o banco de um cliente
     * atualizado se encontra: sessões abertas antes da migração.
     */
    const entrada = await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: criado.data.temporaryPassword,
        client: 'MOBILE',
      })
      .expect(200);
    const par = (entrada.body as Envelope<{ refreshToken: string }>).data;

    await prisma.session.updateMany({
      where: { userId: criado.data.member.userId, revokedAt: null },
      data: { client: 'WEB' },
    });

    await http()
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: par.refreshToken })
      .expect(403);

    /** E a sessão não fica pendurada: ela é revogada na recusa. */
    const viva = await prisma.session.count({
      where: { userId: criado.data.member.userId, revokedAt: null },
    });
    expect(viva).toBe(0);
  });

  it('desligar tira o acesso agora, inclusive da sessão já aberta', async () => {
    const criado = await criarMembro({ roleId: auxiliar.id });
    const entrada = await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.data.member.email,
        password: criado.data.temporaryPassword,
        client: 'MOBILE',
      })
      .expect(200);
    const token = (entrada.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    await auth(
      http().delete(
        `/api/v1/organizations/current/team/members/${criado.data.member.userId}`,
      ),
    ).expect(204);

    /**
     * A sessão que já estava aberta morre junto.
     *
     * Sem revogar, quem foi desligado seguiria trabalhando com o token que
     * tinha na mão até ele expirar — e o motivo de desligar alguém costuma ser
     * exatamente não querer isso.
     */
    await auth(http().get('/api/v1/organizations/current'), token).expect(401);

    /** A pessoa continua existindo: ela assina laudo e aparece no histórico. */
    const usuario = await prisma.user.findUnique({
      where: { id: criado.data.member.userId },
      select: { id: true },
    });
    expect(usuario).not.toBeNull();
  });
});
