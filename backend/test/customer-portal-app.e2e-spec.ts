import { paidSubscriptionFixture } from './support/paid-subscription-fixture';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
/**
 * Área do cliente no app — o acesso que o owner cria, a troca obrigatória da
 * senha, o login só com e-mail, a foto e a assinatura.
 *
 * Contra o PostgreSQL real, com o papel de runtime sem BYPASSRLS: as funções
 * novas e o índice de um acesso por cliente só se provam no banco.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import {
  CUSTOMER_PORTAL_TOKEN_DELIVERY,
  type CustomerPortalTokenDelivery,
} from '../src/modules/customer-portal/customer-portal.types';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/modules/storage/storage.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { imageFixture } from './support/image-fixture';

jest.setTimeout(180_000);

const INTERNAL_PASSWORD = 'Orbit#Portal@2026';
const NEW_PASSWORD = 'Orbit#Cliente@2026';

interface Envelope<T> {
  data: T;
}

class CapturingDelivery implements CustomerPortalTokenDelivery {
  readonly delivered: Array<{ recipient: string; token: string }> = [];
  deliver(_purpose: string, recipient: string, token: string) {
    this.delivered.push({ recipient, token });
    return Promise.resolve();
  }
}

describe('Área do cliente no app (e2e)', () => {
  const prisma = adminPrisma();
  const delivery = new CapturingDelivery();
  let app: INestApplication<App>;
  let storage: StorageProvider;
  let ownerToken: string;
  let ownerTokenC: string;
  let organizationSlug: string;
  let organizationSlugC: string;
  let customerA: string;
  let customerB: string;
  let accessEmail: string;
  let identityId: string;
  let temporaryPassword: string;
  let portalToken: string;
  let portalRefresh: string;

  const api = () => request(app.getHttpServer());
  const asOwner = (test: request.Test, token = ownerToken) =>
    test.set('Authorization', `Bearer ${token}`);
  const asCustomer = (test: request.Test, token = portalToken) =>
    test.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_PORTAL_TOKEN_DELIVERY)
      .useValue(delivery)
      .compile();
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
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);

    const tenant = await createTenant('a');
    ownerToken = tenant.token;
    organizationSlug = tenant.slug;
    const tenantC = await createTenant('c');
    ownerTokenC = tenantC.token;
    organizationSlugC = tenantC.slug;

    customerA = await createCustomer(ownerToken, 'Clínica Sol LTDA');
    customerB = await createCustomer(ownerToken, 'Padaria Lua');
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('mostra o domínio da organização e a sugestão antes de criar', async () => {
    const response = await asOwner(
      api().get(`/api/v1/customers/${customerA}/portal/access`),
    ).expect(200);
    const data = (response.body as Envelope<any>).data;
    expect(data.domain).toBe(`${organizationSlug}.com`);
    expect(data.suggestedLocalPart).toBe('clinica.sol');
    expect(data.identity).toBeNull();
  });

  it('cria o acesso com o domínio do servidor e a senha aparece uma vez', async () => {
    const response = await asOwner(
      api().post(`/api/v1/customers/${customerA}/portal/access`),
    )
      .send({ localPart: 'Clínica Sol@gmail.com' })
      .expect(201);
    const data = (response.body as Envelope<any>).data;
    accessEmail = data.identity.email;
    identityId = data.identity.id;
    temporaryPassword = data.temporaryPassword;

    expect(accessEmail).toBe(`clinica.sol@${organizationSlug}.com`);
    expect(data.identity.status).toBe('active');
    expect(data.identity.mustChangePassword).toBe(true);
    expect(temporaryPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const persisted = await prisma.customerPortalIdentity.findUniqueOrThrow({
      where: { id: identityId },
    });
    expect(persisted.passwordHash).toBeTruthy();
    expect(persisted.passwordHash).not.toContain(temporaryPassword);

    /* Ler o acesso depois não devolve a senha. */
    const again = await asOwner(
      api().get(`/api/v1/customers/${customerA}/portal/access`),
    ).expect(200);
    expect(JSON.stringify(again.body)).not.toContain(temporaryPassword);
  });

  it('um acesso por cliente', async () => {
    const response = await asOwner(
      api().post(`/api/v1/customers/${customerA}/portal/access`),
    )
      .send({ localPart: 'outro.nome' })
      .expect(409);
    expect(JSON.stringify(response.body)).toContain('PORTAL_ACCESS_EXISTS');

    /* O índice segura mesmo quem passar por fora da regra do serviço. */
    await expect(
      prisma.customerPortalIdentity.create({
        data: {
          id: randomUUID(),
          organizationId: (await organizationIdOf(customerA))!,
          customerId: customerA,
          email: `direto.${randomUUID()}@x.com`,
          normalizedEmail: `direto.${randomUUID()}@x.com`,
          displayName: 'Direto',
        },
      }),
    ).rejects.toThrow();
  });

  it('o endereço de um cliente não serve a outro', async () => {
    const response = await asOwner(
      api().post(`/api/v1/customers/${customerB}/portal/access`),
    )
      .send({ localPart: 'clinica.sol' })
      .expect(409);
    expect(JSON.stringify(response.body)).toContain('PORTAL_EMAIL_TAKEN');
  });

  it('entra só com e-mail e senha, e a sessão pede a troca da senha', async () => {
    const response = await api()
      .post('/api/v1/portal/auth/login')
      .send({ email: accessEmail.toUpperCase(), password: temporaryPassword })
      .expect(200);
    const data = (response.body as Envelope<any>).data;
    portalToken = data.accessToken;
    portalRefresh = data.refreshToken;
    expect(data.me.mustChangePassword).toBe(true);
    expect(data.me.customer.id).toBe(customerA);
    expect(data.me.organization.slug).toBe(organizationSlug);
  });

  it('trocar a senha cumpre a troca obrigatória', async () => {
    await asCustomer(api().patch('/api/v1/portal/auth/password'))
      .send({ currentPassword: temporaryPassword, newPassword: NEW_PASSWORD })
      .expect(204);
    const me = await asCustomer(api().get('/api/v1/portal/me')).expect(200);
    expect((me.body as Envelope<any>).data.mustChangePassword).toBe(false);
    await api()
      .post('/api/v1/portal/auth/login')
      .send({ email: accessEmail, password: temporaryPassword })
      .expect(401);
  });

  it('guarda foto e assinatura só no perfil do próprio cliente', async () => {
    const vazio = await asCustomer(
      api().get('/api/v1/portal/me/profile'),
    ).expect(200);
    expect((vazio.body as Envelope<any>).data.avatar.available).toBe(false);

    const avatar = await asCustomer(api().put('/api/v1/portal/me/avatar'))
      .attach('file', imageFixture('avatar'), {
        filename: 'foto.png',
        contentType: 'image/png',
      })
      .expect(200);
    const comFoto = (avatar.body as Envelope<any>).data;
    expect(comFoto.avatar.available).toBe(true);
    const fotoUrl = new URL(comFoto.avatar.url);
    const foto = await api()
      .get(`/api/v1/storage/objects${fotoUrl.search}`)
      .buffer(true)
      .parse((res, done) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () => done(null, Buffer.concat(partes)));
      })
      .expect(200);
    /* WebP de verdade: a foto foi reprocessada, não guardada como veio. */
    const corpo = foto.body as Buffer;
    expect(corpo.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(corpo.subarray(8, 12).toString('ascii')).toBe('WEBP');

    const assinatura = await asCustomer(
      api().put('/api/v1/portal/me/signature'),
    )
      .attach('file', imageFixture('assinatura'), {
        filename: 'assinatura.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect((assinatura.body as Envelope<any>).data.signature.available).toBe(
      true,
    );
    /* Só o necessário para exibir: nenhum campo do storage sai na resposta. */
    expect(
      Object.keys((assinatura.body as Envelope<any>).data.signature).sort(),
    ).toEqual(['available', 'expiresAt', 'updatedAt', 'url']);

    const persisted = await prisma.customerPortalIdentity.findUniqueOrThrow({
      where: { id: identityId },
    });
    expect(persisted.signatureObjectKey).toContain(
      `customer-portal/${persisted.organizationId}/${identityId}/signature/`,
    );

    /* Trocar a assinatura apaga o objeto anterior. */
    const anterior = {
      bucket: persisted.signatureBucket!,
      objectKey: persisted.signatureObjectKey!,
    };
    await asCustomer(api().put('/api/v1/portal/me/signature'))
      .attach('file', imageFixture('assinatura-2'), {
        filename: 'assinatura.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(await storage.head(anterior)).toBeNull();

    /* JPEG não é assinatura. */
    const jpeg = await asCustomer(api().put('/api/v1/portal/me/signature'))
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect(JSON.stringify(jpeg.body)).toContain('FILE_INVALID');

    const removida = await asCustomer(
      api().delete('/api/v1/portal/me/signature'),
    ).expect(200);
    expect((removida.body as Envelope<any>).data.signature.available).toBe(
      false,
    );
  });

  it('separa os mundos: token de cliente não passa na equipe, e vice-versa', async () => {
    await asCustomer(
      api().get(`/api/v1/customers/${customerA}/portal/access`),
    ).expect(401);
    await asCustomer(api().get('/api/v1/customers')).expect(401);
    await asOwner(api().get('/api/v1/portal/me/profile')).expect(401);
    await asOwner(api().put('/api/v1/portal/me/avatar'))
      .attach('file', imageFixture('x'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(401);
  });

  it('outra organização não enxerga nem gerencia o acesso', async () => {
    await asOwner(
      api().get(`/api/v1/customers/${customerA}/portal/access`),
      ownerTokenC,
    ).expect(404);
    await asOwner(
      api().post(
        `/api/v1/customers/${customerA}/portal/identities/${identityId}/password`,
      ),
      ownerTokenC,
    ).expect(404);
  });

  it('e-mail repetido em outra organização exige o slug para entrar', async () => {
    const outro = await createCustomer(ownerTokenC, 'Cliente C');
    await asOwner(
      api().post(`/api/v1/customers/${outro}/portal/invitations`),
      ownerTokenC,
    )
      .send({ email: accessEmail, displayName: 'Homônimo' })
      .expect(201);
    const token = delivery.delivered.at(-1)!.token;
    await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token, password: NEW_PASSWORD })
      .expect(201);

    /* Ambíguo: sem slug, ninguém entra — nem o cliente certo. */
    await api()
      .post('/api/v1/portal/auth/login')
      .send({ email: accessEmail, password: NEW_PASSWORD })
      .expect(401);
    const comSlug = await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email: accessEmail, password: NEW_PASSWORD })
      .expect(200);
    expect((comSlug.body as Envelope<any>).data.me.customer.id).toBe(customerA);
    const outraOrg = await api()
      .post('/api/v1/portal/auth/login')
      .send({
        organizationSlug: organizationSlugC,
        email: accessEmail,
        password: NEW_PASSWORD,
      })
      .expect(200);
    expect((outraOrg.body as Envelope<any>).data.me.customer.id).toBe(outro);
  });

  it('nova senha pelo owner derruba as sessões e pede troca de novo', async () => {
    const response = await asOwner(
      api().post(
        `/api/v1/customers/${customerA}/portal/identities/${identityId}/password`,
      ),
    ).expect(200);
    const data = (response.body as Envelope<any>).data;
    expect(data.temporaryPassword).not.toBe(temporaryPassword);
    expect(data.identity.mustChangePassword).toBe(true);

    await asCustomer(api().get('/api/v1/portal/me')).expect(401);
    await api()
      .post('/api/v1/portal/auth/refresh')
      .send({ refreshToken: portalRefresh })
      .expect(401);
    const login = await api()
      .post('/api/v1/portal/auth/login')
      .send({
        organizationSlug,
        email: accessEmail,
        password: data.temporaryPassword,
      })
      .expect(200);
    expect((login.body as Envelope<any>).data.me.mustChangePassword).toBe(true);
  });

  it('desativado, o mesmo cliente pode ganhar o acesso de volta', async () => {
    await asOwner(
      api().post(
        `/api/v1/customers/${customerA}/portal/identities/${identityId}/disable`,
      ),
    ).expect(204);
    const reaberto = await asOwner(
      api().post(`/api/v1/customers/${customerA}/portal/access`),
    )
      .send({ localPart: 'clinica.sol' })
      .expect(201);
    expect((reaberto.body as Envelope<any>).data.identity.id).toBe(identityId);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'CUSTOMER_PORTAL_IDENTITY', entityId: identityId },
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'customer.portal.access.created',
        'customer.portal.access.password_reset',
        'customer.portal.access.reopened',
        'customer.portal.avatar.changed',
        'customer.portal.signature.removed',
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain(temporaryPassword);
  });

  async function organizationIdOf(customerId: string) {
    return (
      await prisma.customer.findUnique({
        where: { id: customerId },
        select: { organizationId: true },
      })
    )?.organizationId;
  }

  async function createTenant(marker: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `portal.app.${marker}.${suffix}@orbit.local`;
    const registration = await registerVerifiedOwner(app, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      firstName: 'Portal',
      lastName: 'Owner',
      password: INTERNAL_PASSWORD,
      organizationName: `Portal App ${marker} ${suffix}`,
      legalName: `Portal App ${marker} ${suffix} LTDA`,
      documentType: 'CNPJ',
      documentNumber: cnpj(),
      city: 'Recife',
      street: 'Rua Portal',
      stateCode: 'PE',
      planKey: 'ENTERPRISE_UNLIMITED',
    });
    await paidSubscriptionFixture(app, prisma, email);
    const token = (registration.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const organization = await asOwner(
      api().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    return {
      token,
      slug: (organization.body as Envelope<any>).data.slug as string,
    };
  }

  async function createCustomer(token: string, legalName: string) {
    const response = await asOwner(api().post('/api/v1/customers'), token)
      .send({ type: 'COMPANY', legalName })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }
});

function cnpj(): string {
  const base =
    Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('') +
    '0001';
  const digit = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      value
        .split('')
        .reduce((sum, item, index) => sum + Number(item) * weights[index]!, 0) %
      11;
    return rest < 2 ? `${0}` : `${11 - rest}`;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
