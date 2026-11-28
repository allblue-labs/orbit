import { paidSubscriptionFixture } from './support/paid-subscription-fixture';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Entrar com a biometria — equipe e cliente, web (WebAuthn) e app (assinatura por chave
 * de dispositivo).
 *
 * O WebAuthn é provado com um autenticador de software que assina de verdade:
 * a verificação de origem, RP ID, desafio de uso único e assinatura é a da
 * biblioteca, sem atalho. Contra o PostgreSQL real com o papel de runtime.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { deviceProofFixture } from './support/device-proof-fixture';
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
  let ownerId: string;
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
    ({ id: ownerId } = await prisma.user.findUniqueOrThrow({
      where: { email },
    }));

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
      const deviceKey = deviceProofFixture();
      const enrollment = data(
        await bearer(
          api().post('/api/v1/identity/me/biometrics/devices/options'),
          ownerToken,
        ).expect(200),
      );
      await bearer(
        api().post('/api/v1/identity/me/biometrics/devices'),
        ownerToken,
      )
        .set('x-orbit-security-confirmation', proof)
        .send({
          deviceId: 'fixture-device',
          publicKey: deviceKey.publicKey,
          ...deviceKey.prove(enrollment),
        })
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

  describe('app (chave do aparelho)', () => {
    const teamAuth = '/api/v1/identity/biometrics/devices/authentication';
    const portalAuth = '/api/v1/portal/auth/biometrics/devices/authentication';
    async function enroll(audience: 'team' | 'portal', deviceId: string) {
      const path = `/api/v1/${audience === 'team' ? 'identity' : 'portal'}/me/biometrics/devices`;
      const token = audience === 'team' ? ownerToken : portalToken;
      const key = deviceProofFixture();
      const options = data(
        await bearer(api().post(`${path}/options`), token).expect(200),
      );
      const { credentialId } = data(
        await bearer(api().post(path), token)
          .set(
            'x-orbit-security-confirmation',
            await confirmation('DEVICE_REGISTER', audience),
          )
          .send({ deviceId, publicKey: key.publicKey, ...key.prove(options) })
          .expect(201),
      ) as { credentialId: string };
      return { credentialId, ...key };
    }

    async function loginOptions(path: string, credentialId: string) {
      return data(
        await api().post(`${path}/options`).send({ credentialId }).expect(200),
      ) as {
        challengeId: string;
        challenge: string;
      };
    }

    it('revoga segredos legados dos dois públicos e preserva passkeys na migração', async () => {
      const { organizationId } =
        await prisma.customerPortalIdentity.findUniqueOrThrow({
          where: { id: identityId },
        });
      const sql = readFileSync(
        resolve(
          __dirname,
          '../prisma/migrations/20261126110000_device_biometric_key_proofs/migration.sql',
        ),
        'utf8',
      );
      const connection = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await connection.connect();
      try {
        // DDL e fixtures ficam na mesma transação e são desfeitos ao terminar.
        await connection.query('BEGIN');
        await connection.query(`
          ALTER TABLE identity_biometric_credentials DROP CONSTRAINT identity_biometric_kind_check;
          ALTER TABLE customer_portal_biometric_credentials DROP CONSTRAINT portal_biometric_kind_check;
          ALTER TABLE identity_biometric_credentials
            ADD CONSTRAINT identity_biometric_kind_check CHECK (
              (kind = 'DEVICE' AND secret_hash ~ '^[0-9a-f]{64}$') OR kind = 'WEBAUTHN'
            );
          ALTER TABLE customer_portal_biometric_credentials
            ADD CONSTRAINT portal_biometric_kind_check CHECK (
              (kind = 'DEVICE' AND secret_hash ~ '^[0-9a-f]{64}$') OR kind = 'WEBAUTHN'
            );
        `);
        const [legacyTeam, webTeam, legacyPortal, webPortal] = Array.from(
          { length: 4 },
          () => randomUUID(),
        );
        await connection.query(
          `INSERT INTO identity_biometric_credentials
           (id, user_id, kind, label, device_id, secret_hash, webauthn_credential_id, public_key)
           VALUES ($1, $2, 'DEVICE', 'Celular', 'legacy-team', repeat('a', 64), NULL, NULL),
                  ($3, $2, 'WEBAUTHN', 'Web', NULL, NULL, $3::uuid::text, decode('0102', 'hex'))`,
          [legacyTeam, ownerId, webTeam],
        );
        await connection.query(
          `INSERT INTO customer_portal_biometric_credentials
           (id, organization_id, customer_id, portal_identity_id, kind, label, device_id, secret_hash, webauthn_credential_id, public_key)
           VALUES ($1, $2, $3, $4, 'DEVICE', 'Celular', 'legacy-portal', repeat('b', 64), NULL, NULL),
                  ($5, $2, $3, $4, 'WEBAUTHN', 'Web', NULL, NULL, $5::uuid::text, decode('0304', 'hex'))`,
          [legacyPortal, organizationId, customerId, identityId, webPortal],
        );
        await connection.query(sql.replace(/^BEGIN;|COMMIT;\s*$/g, ''));
        const result = await connection.query(
          `SELECT kind, revoked_at IS NOT NULL AS revoked, secret_hash IS NULL AS cleared, encode(public_key, 'hex') AS key
             FROM identity_biometric_credentials WHERE id IN ($1, $2)
           UNION ALL
           SELECT kind, revoked_at IS NOT NULL, secret_hash IS NULL, encode(public_key, 'hex')
             FROM customer_portal_biometric_credentials WHERE id IN ($3, $4)
           ORDER BY key`,
          [legacyTeam, webTeam, legacyPortal, webPortal],
        );
        expect(result.rows.filter((row) => row.kind === 'DEVICE')).toEqual(
          Array.from({ length: 2 }, () => ({
            kind: 'DEVICE',
            revoked: true,
            cleared: true,
            key: null,
          })),
        );
        expect(result.rows.filter((row) => row.kind === 'WEBAUTHN')).toEqual([
          { kind: 'WEBAUTHN', revoked: false, cleared: true, key: '0102' },
          { kind: 'WEBAUTHN', revoked: false, cleared: true, key: '0304' },
        ]);
      } finally {
        await connection.query('ROLLBACK');
        await connection.end();
      }
    });

    it('equipe: valida assinatura, impede reuso concorrente e substitui a chave', async () => {
      const enrolled = await enroll('team', 'device-owner-0001');
      const { credentialId } = enrolled;
      const stored = await prisma.identityBiometricCredential.findUniqueOrThrow(
        {
          where: { id: credentialId },
        },
      );
      expect(Buffer.from(stored.publicKey!).toString('base64url')).toBe(
        enrolled.publicKey,
      );
      expect(stored.secretHash).toBeNull();

      const options = await loginOptions(teamAuth, credentialId);
      await api()
        .post(teamAuth)
        .send({ credentialId, ...deviceProofFixture().prove(options) })
        .expect(401);
      const body = { credentialId, ...enrolled.prove(options) };
      const results = await Promise.all([
        api().post(teamAuth).send(body),
        api().post(teamAuth).send(body),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
      expect(data(results.find((result) => result.status === 200)!)).toEqual(
        expect.objectContaining({ accessToken: expect.any(String) }),
      );
      const expired = await loginOptions(teamAuth, credentialId);
      await prisma.authChallenge.update({
        where: { id: expired.challengeId },
        data: { expiresAt: new Date(0) },
      });
      await api()
        .post(teamAuth)
        .send({ credentialId, ...enrolled.prove(expired) })
        .expect(401);

      const again = await enroll('team', 'device-owner-0001');
      const list = data(
        await bearer(
          api().get('/api/v1/identity/me/biometrics'),
          ownerToken,
        ).expect(200),
      );
      expect(list.filter((item: any) => item.kind === 'DEVICE')).toHaveLength(
        1,
      );
      const revoked = await loginOptions(teamAuth, credentialId);
      await api()
        .post(teamAuth)
        .send({ credentialId, ...enrolled.prove(revoked) })
        .expect(401);

      await bearer(
        api().delete(`/api/v1/identity/me/biometrics/${again.credentialId}`),
        ownerToken,
      )
        .set(
          'x-orbit-security-confirmation',
          await confirmation('BIOMETRIC_REVOKE'),
        )
        .expect(204);
      const removed = await loginOptions(teamAuth, again.credentialId);
      await api()
        .post(teamAuth)
        .send({ credentialId: again.credentialId, ...again.prove(removed) })
        .expect(401);
    });

    it('cliente: isola a audiência e invalida o acesso após troca de senha', async () => {
      const enrolled = await enroll('portal', 'device-client-0001');
      const { credentialId } = enrolled;
      const options = await loginOptions(portalAuth, credentialId);
      const wrongAudience = await loginOptions(teamAuth, credentialId);
      await api()
        .post(portalAuth)
        .send({ credentialId, ...enrolled.prove(wrongAudience) })
        .expect(401);

      const body = { credentialId, ...enrolled.prove(options) };
      await api().post(teamAuth).send(body).expect(401);
      const session = data(await api().post(portalAuth).send(body).expect(200));
      expect(session.me.customer.id).toBe(customerId);
      await api().post(portalAuth).send(body).expect(401);

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

      await bearer(
        api().post(
          `/api/v1/customers/${customerId}/portal/identities/${identityId}/password`,
        ),
        ownerToken,
      ).expect(200);
      const afterPasswordChange = await loginOptions(portalAuth, credentialId);
      await api()
        .post(portalAuth)
        .send({ credentialId, ...enrolled.prove(afterPasswordChange) })
        .expect(401);
    });

    it.each([
      '/api/v1/identity/biometrics/devices/login',
      '/api/v1/portal/auth/biometrics/devices/login',
    ])('recusa o protocolo antigo de segredo no endpoint %s', async (path) => {
      await api()
        .post(path)
        .send({ credentialId: randomUUID(), secret: 'legacy' })
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
