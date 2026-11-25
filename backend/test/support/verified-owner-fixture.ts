import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ICryptoProvider } from '../../src/contracts';
import { CRYPTO_PROVIDER } from '../../src/providers';
import { adminPrisma } from './admin-prisma';
import { paidSubscriptionFixture } from './paid-subscription-fixture';

/**
 * O cadastro passou a exigir um plano. Suíte que não escolhe plano recebe o
 * completo, já pago — o que ela testa é a funcionalidade, não a assinatura.
 * Quem informa `planKey` controla o próprio cenário de cobrança.
 */
const DEFAULT_PLAN_KEY = 'ENTERPRISE_UNLIMITED';

/** Business fixtures explicitly complete the same confirmation flow as a real owner.
 * Privileged token inspection is restricted to the runner's disposable database.
 * No test-only bypass is installed in the application or authentication code.
 */
export async function registerVerifiedOwner<
  T extends { email: string; password: string; client?: string },
>(app: INestApplication<App>, input: T) {
  if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
    throw new Error('Disposable database required');
  const http = () => request(app.getHttpServer());
  const choosesPlan = 'planKey' in input;
  const registration = await http()
    .post('/api/v1/identity/register')
    .send(choosesPlan ? input : { ...input, planKey: DEFAULT_PLAN_KEY })
    .expect(201);
  const pending = (registration.body as { data: Record<string, unknown> }).data;
  if (
    pending.status !== 'EMAIL_VERIFICATION_REQUIRED' ||
    pending.email !== input.email.trim().toLowerCase() ||
    'accessToken' in pending ||
    'refreshToken' in pending
  )
    throw new Error('Fixture expected pending registration without tokens');
  const admin = adminPrisma();
  const user = await admin.user.findUniqueOrThrow({
    where: { normalizedEmail: input.email.trim().toLowerCase() },
  });
  const delivery = await admin.identityEmailDelivery.findFirstOrThrow({
    where: { userId: user.id, purpose: 'EMAIL_VERIFICATION' },
    orderBy: { createdAt: 'desc' },
  });
  const { token } = JSON.parse(
    app
      .get<ICryptoProvider>(CRYPTO_PROVIDER)
      .decrypt(delivery.encryptedPayload!),
  ) as { token: string };
  await http()
    .post('/api/v1/identity/email/verify')
    .send({ token })
    .expect(204);
  if (!choosesPlan) await paidSubscriptionFixture(app, admin, user.email);
  return http()
    .post('/api/v1/identity/login')
    .send({
      email: input.email,
      password: input.password,
      client: input.client ?? 'WEB',
    })
    .expect(200);
}
