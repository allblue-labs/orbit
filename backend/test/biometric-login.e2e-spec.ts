import { paidSubscriptionFixture } from './support/paid-subscription-fixture';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Entrar com a biometria — equipe e cliente, web (WebAuthn) e app (segredo
 * do aparelho).
 *
 * O WebAuthn é provado com um autenticador de software que assina de verdade:
 * a verificação de origem, RP ID, desafio de uso único e assinatura é a da
 * biblioteca, sem atalho. Contra o PostgreSQL real com o papel de runtime.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { SoftAuthenticator } from './support/soft-authenticator';

jest.setTimeout(180_000);

const ORIGIN = 'http://localhost:3000';
const RP_ID = 'localhost';
const PASSWORD = 'Orbit#Biometria@2026';
const CUSTOMER_PASSWORD = 'Orbit#Cliente@2026';

interface Envelope<T> {
  data: T;
}

describe('Entrar com a biometria (e2e)', () => {
  const prisma = adminPrisma();
  const previousOrigin = process.env.FRONTEND_ORIGIN;
  let app: INestApplication<App>;
  let ownerToken: string;
  let customerId: string;
  let identityId: string;
  let accessEmail: string;
  let portalToken: string;

  const api = () => request(app.getHttpServer());
  const bearer = (test: request.Test, token: string) =>
    test.set('Authorization', `Bearer ${token}`);
  const data = (response: request.Response) =>
    (response.body as Envelope<any>).data;
  async function confirmation(
    action: string,
    audience: 'team' | 'portal' = 'team',
  ): Promise<string> {
    const team = audience === 'team';
    const path = team
      ? '/api/v1/identity/me/security-confirmation'
      : '/api/v1/portal/me/biometrics/confirmation';
    const response = await bearer(
      api().post(path),
      team ? ownerToken : portalToken,
    )
      .send({ action, currentPassword: team ? PASSWORD : CUSTOMER_PASSWORD })
      .expect(200);
    return (response.body as Envelope<{ confirmation: string }>).data
      .confirmation;
  }

  beforeAll(async () => {
    process.env.FRONTEND_ORIGIN = ORIGIN;
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

    const suffix = randomUUID().slice(0, 8);
    const email = `biometria.${suffix}@orbit.local`;
    const registration = await registerVerifiedOwner(app, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      firstName: 'Bio',
      lastName: 'Owner',
      password: PASSWORD,
      organizationName: `Biometria ${suffix}`,
      legalName: `Biometria ${suffix} LTDA`,
      documentType: 'CNPJ',
      documentNumber: cnpj(),
      city: 'Recife',
      street: 'Rua Bio',
      stateCode: 'PE',
      planKey: 'ENTERPRISE_UNLIMITED',
    });
    await paidSubscriptionFixture(app, prisma, email);
    ownerToken = data(registration).accessToken;

    customerId = data(
      await bearer(api().post('/api/v1/customers'), ownerToken)
        .send({ type: 'COMPANY', legalName: 'Clínica Bio' })
        .expect(201),
    ).id;
    const access = data(
      await bearer(
        api().post(`/api/v1/customers/${customerId}/portal/access`),
        ownerToken,
      )
        .send({ localPart: 'clinica.bio' })
        .expect(201),
    );
    identityId = access.identity.id;
    accessEmail = access.identity.email;
    const login = data(
      await api()
        .post('/api/v1/portal/auth/login')
        .send({ email: accessEmail, password: access.temporaryPassword })
        .expect(200),
    );
    portalToken = login.accessToken;
    await bearer(
      api().post('/api/v1/portal/me/biometrics/confirmation'),
      portalToken,
    )
      .send({
        action: 'DEVICE_REGISTER',
        currentPassword: access.temporaryPassword,
      })
      .expect(403);
    await bearer(api().patch('/api/v1/portal/auth/password'), portalToken)
      .send({
        currentPassword: access.temporaryPassword,
        newPassword: CUSTOMER_PASSWORD,
      })
      .expect(204);
  });

  afterAll(async () => {
    process.env.FRONTEND_ORIGIN = previousOrigin;
    await app?.close();
    await disconnectAdminPrisma();
  });

  describe('equipe na web (WebAuthn)', () => {
    const authenticator = new SoftAuthenticator(RP_ID, ORIGIN);

    it('cadastra a passkey com confirmação de uso único e guarda só a chave pública', async () => {
      await api()
        .post('/api/v1/identity/me/biometrics/webauthn/registration/options')
        .expect(401);
      const options = data(
        await bearer(
          api().post(
            '/api/v1/identity/me/biometrics/webauthn/registration/options',
          ),
          ownerToken,
        ).expect(200),
      );
      expect(options.options.rp.id).toBe(RP_ID);
      expect(options.options.authenticatorSelection.userVerification).toBe(
        'required',
      );
      const body = {
        challengeId: options.challengeId,
        response: authenticator.register(options.options.challenge),
      };
      await bearer(
        api().post('/api/v1/identity/me/biometrics/webauthn/registration'),
        ownerToken,
      )
        .send(body)
        .expect(403);
      const proof = await confirmation('PASSKEY_REGISTER');
      await bearer(
        api().post('/api/v1/identity/me/biometrics/devices'),
        ownerToken,
      )
        .set('x-orbit-security-confirmation', proof)
        .send({ deviceId: 'fixture-device' })
        .expect(403);
      const created = data(
        await bearer(
          api().post('/api/v1/identity/me/biometrics/webauthn/registration'),
          ownerToken,
        )
          .set('x-orbit-security-confirmation', proof)
          .set(
            'User-Agent',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36',
          )
          .send(body)
          .expect(201),
      );
      expect(created).toMatchObject({
        kind: 'WEBAUTHN',
        label: 'Chrome no Mac',
      });

      /* O mesmo desafio não cadastra duas vezes. */
      await bearer(
        api().post('/api/v1/identity/me/biometrics/webauthn/registration'),
        ownerToken,
      )
        .set('x-orbit-security-confirmation', proof)
        .send(body)
        .expect(403);

      const stored = await prisma.identityBiometricCredential.findUniqueOrThrow(
        {
          where: { id: created.id },
        },
      );
      expect(stored.webauthnCredentialId).toBe(authenticator.id);
      expect(stored.secretHash).toBeNull();
    });

    it('entra sem e-mail, e o desafio vale uma vez', async () => {
      const options = data(
        await api()
          .post('/api/v1/identity/biometrics/webauthn/authentication/options')
          .expect(200),
      );
      const response = authenticator.authenticate(options.options.challenge);
      const session = data(
        await api()
          .post('/api/v1/identity/biometrics/webauthn/authentication')
          .send({ challengeId: options.challengeId, response })
          .expect(200),
      );
      expect(session.accessToken).toBeTruthy();
      await bearer(
        api().get('/api/v1/identity/me'),
        session.accessToken,
      ).expect(200);

      /* Repetir a resposta capturada não abre outra sessão. */
      await api()
        .post('/api/v1/identity/biometrics/webauthn/authentication')
        .send({ challengeId: options.challengeId, response })
        .expect(401);
    });

    it('recusa assinatura feita para outra origem', async () => {
      const options = data(
        await api()
          .post('/api/v1/identity/biometrics/webauthn/authentication/options')
          .expect(200),
      );
      await api()
        .post('/api/v1/identity/biometrics/webauthn/authentication')
        .send({
          challengeId: options.challengeId,
          response: authenticator.authenticate(
            options.options.challenge,
            'https://phishing.example',
          ),
        })
        .expect(401);
    });

    it('a passkey de um cliente não entra como equipe', async () => {
      const client = new SoftAuthenticator(RP_ID, ORIGIN);
      const options = data(
        await bearer(
          api().post(
            '/api/v1/portal/me/biometrics/webauthn/registration/options',
          ),
          portalToken,
        ).expect(200),
      );
      await bearer(
        api().post('/api/v1/portal/me/biometrics/webauthn/registration'),
        portalToken,
      )
        .set(
          'x-orbit-security-confirmation',
          await confirmation('PASSKEY_REGISTER', 'portal'),
        )
        .send({
          challengeId: options.challengeId,
          response: client.register(options.options.challenge),
        })
        .expect(201);

      const team = data(
        await api()
          .post('/api/v1/identity/biometrics/webauthn/authentication/options')
          .expect(200),
      );
      await api()
        .post('/api/v1/identity/biometrics/webauthn/authentication')
        .send({
          challengeId: team.challengeId,
          response: client.authenticate(team.options.challenge),
        })
        .expect(401);

      /* E no portal ela entra — como o cliente, só o cliente. */
      const portal = data(
        await api()
          .post(
            '/api/v1/portal/auth/biometrics/webauthn/authentication/options',
          )
          .expect(200),
      );
      /* Desafio de equipe não serve no portal. */
      await api()
        .post('/api/v1/portal/auth/biometrics/webauthn/authentication')
        .send({
          challengeId: team.challengeId,
          response: client.authenticate(team.options.challenge),
        })
        .expect(401);
      const session = data(
        await api()
          .post('/api/v1/portal/auth/biometrics/webauthn/authentication')
          .send({
            challengeId: portal.challengeId,
            response: client.authenticate(portal.options.challenge),
          })
          .expect(200),
      );
      expect(session.me.customer.id).toBe(customerId);
    });
  });

  describe('app (segredo do aparelho)', () => {
    it('equipe: entra e o segredo troca a cada uso', async () => {
      const enrolled = data(
        await bearer(
          api().post('/api/v1/identity/me/biometrics/devices'),
          ownerToken,
        )
          .set(
            'x-orbit-security-confirmation',
            await confirmation('DEVICE_REGISTER'),
          )
          .send({ deviceId: 'device-owner-0001', label: 'iPhone do owner' })
          .expect(201),
      );
      const stored = await prisma.identityBiometricCredential.findUniqueOrThrow(
        {
          where: { id: enrolled.credentialId },
        },
      );
      expect(stored.secretHash).not.toContain(enrolled.secret);

      const first = data(
        await api()
          .post('/api/v1/identity/biometrics/devices/login')
          .send({
            credentialId: enrolled.credentialId,
            secret: enrolled.secret,
            deviceId: 'device-owner-0001',
          })
          .expect(200),
      );
      expect(first.accessToken).toBeTruthy();
      expect(first.deviceSecret).not.toBe(enrolled.secret);

      /* O segredo usado não vale mais; o novo vale. */
      await api()
        .post('/api/v1/identity/biometrics/devices/login')
        .send({ credentialId: enrolled.credentialId, secret: enrolled.secret })
        .expect(401);
      await api()
        .post('/api/v1/identity/biometrics/devices/login')
        .send({
          credentialId: enrolled.credentialId,
          secret: first.deviceSecret,
        })
        .expect(200);

      /* Cadastrar de novo no mesmo aparelho substitui. */
      const again = data(
        await bearer(
          api().post('/api/v1/identity/me/biometrics/devices'),
          ownerToken,
        )
          .set(
            'x-orbit-security-confirmation',
            await confirmation('DEVICE_REGISTER'),
          )
          .send({ deviceId: 'device-owner-0001' })
          .expect(201),
      );
      const list = data(
        await bearer(
          api().get('/api/v1/identity/me/biometrics'),
          ownerToken,
        ).expect(200),
      );
      expect(list.filter((item: any) => item.kind === 'DEVICE')).toHaveLength(
        1,
      );

      /* Remover encerra a biometria. */
      await bearer(
        api().delete(`/api/v1/identity/me/biometrics/${again.credentialId}`),
        ownerToken,
      )
        .set(
          'x-orbit-security-confirmation',
          await confirmation('BIOMETRIC_REVOKE'),
        )
        .expect(204);
      await api()
        .post('/api/v1/identity/biometrics/devices/login')
        .send({ credentialId: again.credentialId, secret: again.secret })
        .expect(401);
    });

    it('cliente: entra como ele mesmo e cai quando o owner mexe no acesso', async () => {
      const enrolled = data(
        await bearer(
          api().post('/api/v1/portal/me/biometrics/devices'),
          portalToken,
        )
          .set(
            'x-orbit-security-confirmation',
            await confirmation('DEVICE_REGISTER', 'portal'),
          )
          .send({ deviceId: 'device-client-0001', label: 'Android' })
          .expect(201),
      );
      /* Credencial de cliente não serve na porta da equipe. */
      await api()
        .post('/api/v1/identity/biometrics/devices/login')
        .send({ credentialId: enrolled.credentialId, secret: enrolled.secret })
        .expect(401);

      const session = data(
        await api()
          .post('/api/v1/portal/auth/biometrics/devices/login')
          .send({
            credentialId: enrolled.credentialId,
            secret: enrolled.secret,
          })
          .expect(200),
      );
      expect(session.me.customer.id).toBe(customerId);
      expect(session.deviceSecret).not.toBe(enrolled.secret);

      const list = data(
        await bearer(
          api().get('/api/v1/portal/me/biometrics'),
          session.accessToken,
        ).expect(200),
      );
      expect(list.map((item: any) => item.kind).sort()).toEqual([
        'DEVICE',
        'WEBAUTHN',
      ]);

      /* O owner gera uma senha nova: a biometria espera a senha temporária. */
      await bearer(
        api().post(
          `/api/v1/customers/${customerId}/portal/identities/${identityId}/password`,
        ),
        ownerToken,
      ).expect(200);
      await api()
        .post('/api/v1/portal/auth/biometrics/devices/login')
        .send({
          credentialId: enrolled.credentialId,
          secret: session.deviceSecret,
        })
        .expect(401);
    });
  });
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
