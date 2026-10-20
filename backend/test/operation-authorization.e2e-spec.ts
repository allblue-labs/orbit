/**
 * Autorização da atribuição.
 *
 * ## A regra que não existia
 *
 * `settings.operations.requireAssignmentAuthorization` era gravada desde a
 * PR-12 e **nenhum ponto do backend a lia**. Ligar a chave não escondia nada
 * de ninguém: o técnico continuava vendo tudo pelo aplicativo e pela API, e a
 * tela dizia isso com todas as letras para não fingir um fluxo inexistente.
 *
 * O que estes testes prendem é a regra de verdade — e, principalmente, a
 * promessa de que ligá-la não faz o trabalho já distribuído desaparecer.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { disconnectAdminPrisma } from './support/admin-prisma';

interface Envelope<T> {
  data: T;
}
interface Papel {
  id: string;
  key: string;
}

const digits = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

const cnpj = () => {
  const base = `${digits(8)}0001`;
  const digito = (parcial: string) => {
    const pesos =
      parcial.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = parcial
      .split('')
      .reduce((total, d, i) => total + Number(d) * (pesos[i] ?? 0), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(base);
  return `${base}${primeiro}${digito(`${base}${primeiro}`)}`;
};

describe('Operation assignment authorization (e2e)', () => {
  let app: INestApplication<App>;
  let ownerToken: string;
  let tecnicoToken: string;
  let tecnicoId: string;
  let unidadeId: string;
  let clienteId: string;

  const http = () => request(app.getHttpServer());
  const auth = (test: request.Test, token = ownerToken) =>
    test.set('Authorization', `Bearer ${token}`);

  async function exigirAutorizacao(exigir: boolean) {
    await auth(http().patch('/api/v1/organizations/current'))
      .send({
        settings: { operations: { requireAssignmentAuthorization: exigir } },
      })
      .expect(200);
  }

  /** Cria um atendimento agendado e o atribui ao técnico. */
  async function atendimentoAtribuido(): Promise<string> {
    const criado = await auth(http().post('/api/v1/operations'))
      .send({
        businessUnitId: unidadeId,
        customerId: clienteId,
        code: `OS-${digits(8)}`,
        kind: 'MAINTENANCE',
        title: `Atendimento ${digits(4)}`,
        priority: 'NORMAL',
        scheduledStart: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .expect(201);
    const id = (criado.body as Envelope<{ id: string }>).data.id;
    await auth(http().post(`/api/v1/operations/${id}/assignments`))
      .send({ userId: tecnicoId })
      .expect(201);
    return id;
  }

  /** Os ids que a fila do aplicativo devolve para o técnico. */
  async function filaDoTecnico(): Promise<string> {
    const resposta = await auth(
      http().get('/api/v1/mobile/field/work-queue'),
      tecnicoToken,
    ).expect(200);
    return JSON.stringify(resposta.body);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const sufixo = digits(8);
    const registro = await http()
      .post('/api/v1/identity/register')
      .send({
        email: `auto.${sufixo}@orbit.local`,
        firstName: 'Dona',
        lastName: 'Operacao',
        password: 'Orbit#Auto@2026',
        organizationName: `Auto ${sufixo}`,
        legalName: `Auto ${sufixo} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);
    ownerToken = (registro.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    const organizacao = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    unidadeId = (
      organizacao.body as Envelope<{ businessUnits: { id: string }[] }>
    ).data.businessUnits[0]!.id;

    const papeis = await auth(
      http().get('/api/v1/organizations/current/roles'),
    ).expect(200);
    const operacional = (papeis.body as Envelope<Papel[]>).data.find(
      (papel) => papel.key === 'FIELD_TECHNICIAN',
    )!;

    const membro = await auth(
      http().post('/api/v1/organizations/current/team/members'),
    )
      .send({
        firstName: 'Tec',
        lastName: 'Campo',
        email: `auto.tec.${sufixo}@orbit.local`,
        roleId: operacional.id,
      })
      .expect(201);
    const criado = (
      membro.body as Envelope<{
        member: { userId: string; email: string };
        temporaryPassword: string;
      }>
    ).data;
    tecnicoId = criado.member.userId;

    /**
     * Atribuir exige FIELD_TECHNICIAN **ativo na unidade**, e o cadastro de
     * equipe não faz isso: papel de acesso e ofício são camadas diferentes.
     */
    await auth(
      http().patch(
        `/api/v1/workforce/members/${tecnicoId}/professional-profile`,
      ),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: false,
        active: true,
      })
      .expect(200);

    /* A senha temporária é trocada pelo aplicativo — é lá que ele trabalha. */
    const primeira = await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.member.email,
        password: criado.temporaryPassword,
        client: 'MOBILE',
      })
      .expect(200);
    await auth(
      http().post('/api/v1/identity/me/password'),
      (primeira.body as Envelope<{ accessToken: string }>).data.accessToken,
    )
      .send({
        currentPassword: criado.temporaryPassword,
        newPassword: 'Minha#Senha@2026',
      })
      .expect(204);
    const entrada = await http()
      .post('/api/v1/identity/login')
      .send({
        email: criado.member.email,
        password: 'Minha#Senha@2026',
        client: 'MOBILE',
      })
      .expect(200);
    tecnicoToken = (entrada.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    const cliente = await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Cliente Auto ${sufixo} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    clienteId = (cliente.body as Envelope<{ id: string }>).data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('sem exigência, atribuir já libera — e o carimbo fica', async () => {
    await exigirAutorizacao(false);
    const id = await atendimentoAtribuido();

    const detalhe = await auth(http().get(`/api/v1/operations/${id}`)).expect(
      200,
    );
    /**
     * O carimbo implícito não é firula.
     *
     * Sem ele o recurso teria uma bomba-relógio: este atendimento nasceria
     * sem autorização e sumiria da fila no dia em que alguém ligasse a chave —
     * trabalho já distribuído desaparecendo sem ninguém tocar nele.
     */
    expect(
      (detalhe.body as Envelope<{ authorizedAt: string | null }>).data
        .authorizedAt,
    ).not.toBeNull();
    expect(await filaDoTecnico()).toContain(id);
  });

  it('autorizar onde não se exige é recusado', async () => {
    await exigirAutorizacao(false);
    const id = await atendimentoAtribuido();
    /* Carimbar onde a etapa não existe faria a trilha mentir sobre um passo
       que aquela organização não pratica. */
    await auth(http().post(`/api/v1/operations/${id}/authorization`)).expect(
      400,
    );
  });

  describe('com a exigência ligada', () => {
    let pendente: string;

    beforeAll(async () => {
      await exigirAutorizacao(true);
      pendente = await atendimentoAtribuido();
    });

    it('o atendimento atribuído não chega ao técnico', async () => {
      expect(await filaDoTecnico()).not.toContain(pendente);
    });

    it('autorizado, chega — com quem autorizou registrado', async () => {
      const resposta = await auth(
        http().post(`/api/v1/operations/${pendente}/authorization`),
      ).expect(201);
      const dados = (
        resposta.body as Envelope<{
          authorizedAt: string | null;
          authorizedBy: { id: string } | null;
        }>
      ).data;
      expect(dados.authorizedAt).not.toBeNull();
      expect(dados.authorizedBy).not.toBeNull();

      expect(await filaDoTecnico()).toContain(pendente);
    });

    it('revogado, sai da fila de novo', async () => {
      const resposta = await auth(
        http().delete(`/api/v1/operations/${pendente}/authorization`),
      ).expect(200);
      expect(
        (resposta.body as Envelope<{ authorizedAt: string | null }>).data
          .authorizedAt,
      ).toBeNull();
      expect(await filaDoTecnico()).not.toContain(pendente);
    });

    it('o técnico não autoriza o próprio atendimento', async () => {
      /* Autorizar é decisão de quem atribui. Sem isso a regra seria teatro:
         o executor liberaria a si mesmo. */
      await auth(
        http().post(`/api/v1/operations/${pendente}/authorization`),
        tecnicoToken,
      ).expect(403);
    });
  });

  it('desligar a exigência devolve o que estava retido', async () => {
    await exigirAutorizacao(true);
    const retido = await atendimentoAtribuido();
    expect(await filaDoTecnico()).not.toContain(retido);

    await exigirAutorizacao(false);
    expect(await filaDoTecnico()).toContain(retido);
  });
});
