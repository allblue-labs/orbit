/**
 * Assinatura vencida: o que para e o que continua.
 *
 * ## O portão era único, e derrubava a plataforma inteira
 *
 * `@RequiresActivePlan()` fica quase sempre na **classe** do controlador, e o
 * guarda respondia `403` para qualquer rota marcada — leitura inclusive. Uma
 * avaliação vencida virava uma conta que abre e não mostra nada: erro em toda
 * tela, sem consultar o próprio histórico e sem baixar um documento emitido
 * enquanto ainda pagava.
 *
 * Quem está vencido precisa escolher um plano, e para isso precisa conseguir
 * olhar o que tem. O que a regra separa agora é **ler** de **mudar**.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

interface Envelope<T> {
  data: T;
}
interface ErrorEnvelope {
  error: { code: string; status: number };
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

describe('Subscription expiry (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = adminPrisma();

  let token: string;
  let organizationId: string;
  let customerId: string;

  const http = () => request(app.getHttpServer());
  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

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
        email: `subscriptions.expiry.${sufixo}@orbit.local`,
        firstName: 'Dona',
        lastName: 'Conta',
        password: 'Orbit#Expiry@2026',
        organizationName: `Expiry ${sufixo}`,
        legalName: `Expiry ${sufixo} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);
    token = (registro.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    const atual = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    organizationId = (atual.body as Envelope<{ id: string }>).data.id;

    /* Um cliente criado **enquanto vale**, para depois provar que ainda se lê. */
    const cliente = await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Cliente Expiry ${sufixo} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    customerId = (cliente.body as Envelope<{ id: string }>).data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  /**
   * Envelhece a avaliação desta organização.
   *
   * A avaliação vence pelo relógio — não há comando de "expirar". Mover o fim
   * do período para trás é o que o tempo faria, e é a única forma de observar
   * o estado sem esperar trinta dias.
   */
  async function vencer(): Promise<void> {
    /* O período inteiro anda para trás: há uma restrição de que o fim venha
       depois do início, e mover só o fim a violaria. */
    const dia = 24 * 60 * 60 * 1000;
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        currentPeriodStart: new Date(Date.now() - 31 * dia),
        currentPeriodEnd: new Date(Date.now() - dia),
      },
    });
  }

  async function renovar(): Promise<void> {
    const dia = 24 * 60 * 60 * 1000;
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        currentPeriodStart: new Date(Date.now() - dia),
        currentPeriodEnd: new Date(Date.now() + 30 * dia),
      },
    });
  }

  it('enquanto vale, ler e escrever funcionam', async () => {
    await auth(http().get('/api/v1/customers?limit=1')).expect(200);
    await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Antes do vencimento ${digits(6)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
  });

  describe('com a assinatura vencida', () => {
    beforeAll(vencer);
    afterAll(renovar);

    it('continua lendo o que a organização já tem', async () => {
      /**
       * A tela precisa abrir.
       *
       * Sem isto a pessoa entra e encontra erro em tudo — inclusive na página
       * de onde ela escolheria um plano, que é a ação que resolve.
       */
      for (const rota of [
        '/api/v1/organizations/current',
        '/api/v1/customers?limit=5',
        `/api/v1/customers/${customerId}`,
        '/api/v1/operations?limit=5',
        '/api/v1/artifact-executions?limit=5',
        '/api/v1/management-reports?limit=5',
      ]) {
        const resposta = await auth(http().get(rota));
        expect([rota, resposta.status]).toEqual([rota, 200]);
      }
    });

    it('e recusa qualquer escrita, com 402 e não 403', async () => {
      const recusa = await auth(http().post('/api/v1/customers'))
        .send({
          legalName: `Depois do vencimento ${digits(6)} LTDA`,
          type: 'COMPANY',
          documentType: 'CNPJ',
          documentNumber: cnpj(),
        })
        .expect(402);

      /**
       * `402`, e não `403`.
       *
       * A permissão existe; o que acabou foi o período. Com `403` a interface
       * só sabe dizer "sem permissão", e manda a pessoa procurar um
       * administrador em vez de oferecer o que resolve — escolher um plano.
       */
      const corpo = recusa.body as ErrorEnvelope;
      expect(corpo.error.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(corpo.error.status).toBe(402);
    });

    it('nem alterar, nem apagar', async () => {
      await auth(http().patch(`/api/v1/customers/${customerId}`))
        .send({ legalName: 'Nome novo LTDA' })
        .expect(402);
      await auth(http().delete(`/api/v1/customers/${customerId}`)).expect(402);
    });

    it('o que já foi emitido continua podendo ser baixado', async () => {
      /**
       * Os documentos são da organização: foram produzidos durante o período
       * pago. Sequestrá-los para forçar a contratação seria cobrar com refém —
       * e um PMOC é documento que a lei manda o cliente ter em mãos.
       *
       * A listagem é a porta de entrada do download, e é o que se verifica
       * aqui; o arquivo em si sai por `GET`, coberto pela mesma regra.
       */
      await auth(http().get('/api/v1/management-reports?limit=5')).expect(200);
      await auth(http().get('/api/v1/artifact-executions?limit=5')).expect(200);
    });

    it('mas emitir um documento novo, não', async () => {
      await auth(http().post('/api/v1/management-reports'))
        .send({
          name: 'Relatório que não deveria nascer',
          kind: 'OPERATIONS',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
        })
        .expect(402);
    });
  });

  it('renovada, a escrita volta sem que ninguém precise reentrar', async () => {
    await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Depois de renovar ${digits(6)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
  });
});
