import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import { BillingCheckoutFulfillmentService } from '../src/modules/billing/billing-checkout-fulfillment.service';
import { BillingService } from '../src/modules/billing/billing.service';
import {
  BILLING_PROVIDER,
  ProviderCheckoutState,
  type CheckoutSessionRequest,
  type ProviderCheckoutSession,
  type ProviderPromotionTerms,
} from '../src/modules/billing/billing.types';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90_000);
const root = '/api/v1/corporate-admin/promotions';
const actor = randomUUID();
const priceId = 'price_adm05_synthetic';
const minor = 15_990;
const checkoutSessions = new Map<string, ProviderCheckoutSession>();
const providerPromotions = new Map<string, { id: string; active: boolean }>();
const secret = randomBytes(32).toString('base64url');
const principal = randomUUID();
const readSecret = randomBytes(32).toString('base64url');
const token = (key: string, value: string) => `orbit-ca1.local.${key}.${value}`;
const credential = (key: string, value: string, capabilities: string[]) => ({
  principalId: principal,
  keyId: key,
  capabilities,
  environment: 'local',
  revoked: false,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  secretSha256: createHash('sha256')
    .update(['orbit-corporate-admin.v1', 'local', key, value].join('\0'))
    .digest('hex'),
});
const activate = jest.fn((terms: ProviderPromotionTerms) => {
  const previous = providerPromotions.get(terms.id);
  if (previous) return Promise.resolve(previous.id);
  const remote = { id: 'promo_' + terms.id.replaceAll('-', ''), active: true };
  providerPromotions.set(terms.id, remote);
  return Promise.reject(
    new Error('synthetic response loss after successful write'),
  );
});
const deactivate = jest.fn((terms: ProviderPromotionTerms, id: string) => {
  const remote = providerPromotions.get(terms.id);
  if (!remote || remote.id !== id) throw new Error('unknown promotion');
  remote.active = false;
  return Promise.resolve();
});
const createCustomer = jest.fn(
  ({ organizationId }: { organizationId: string }) =>
    Promise.resolve({
      providerCustomerId: 'cus_' + organizationId.replaceAll('-', ''),
    }),
);
const createSession = jest.fn((input: CheckoutSessionRequest) => {
  const id = 'cs_test_' + input.checkoutAttemptId.replaceAll('-', '');
  const url = `https://checkout.stripe.test/c/${id}`;
  const expiresAt = input.promotion?.expiresAt ?? null;
  if (!checkoutSessions.has(id))
    checkoutSessions.set(id, {
      providerSessionId: id,
      state: ProviderCheckoutState.OPEN,
      rawStatus: 'open',
      url,
      expiresAt,
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: null,
      paymentStatus: 'unpaid',
      providerPriceId: input.priceId!,
      metadata: {
        checkoutAttemptId: input.checkoutAttemptId,
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        planCode: input.planCode,
        billingInterval: input.billingInterval,
      },
    });
  return Promise.resolve({ providerSessionId: id, url, expiresAt });
});
const provider = {
  name: 'STRIPE',
  mode: 'TEST',
  isEnabled: () => true,
  activatePromotion: activate,
  deactivatePromotion: deactivate,
  createCustomer,
  createCheckoutSession: createSession,
  retrieveCheckoutSession: (id: string) =>
    Promise.resolve(checkoutSessions.get(id)!),
  expireCheckoutSession: (id: string) => {
    const session = checkoutSessions.get(id)!;
    checkoutSessions.set(id, {
      ...session,
      state: ProviderCheckoutState.EXPIRED,
      rawStatus: 'expired',
    });
    return Promise.resolve();
  },
};

type Receipt = {
  operationId: string;
  pending: boolean;
  replayed: boolean;
  promotion: { id: string; version: number; code: string; status: string };
};
function data<T = Receipt>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

function terms(overrides: object = {}) {
  return {
    percentOff: 20,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    planCodes: ['PROFESSIONAL'],
    billingIntervals: ['MONTHLY'],
    totalLimit: 1,
    customerLimit: 1,
    audience: 'NEW_CUSTOMER',
    ...overrides,
  };
}

describe('ADM-05.A promotions with restricted database role and simulated Stripe', () => {
  let app: INestApplication<App>;
  let billing: BillingService;
  let fulfillment: BillingCheckoutFulfillmentService;
  let storage: RequestContextStorage;
  let planId: string;
  let catalogVersion: number;
  const db = adminPrisma();
  const auth = (test: request.Test, readOnly = false) =>
    test.set(
      'Authorization',
      'Bearer ' +
        (readOnly ? token('reader', readSecret) : token('writer', secret)),
    );
  const http = () => request(app.getHttpServer());
  const get = (suffix = '') => auth(http().get(root + suffix), true);
  const send = (route: string, body: object, key = randomUUID()) =>
    auth(http().post(root + route))
      .set('X-Nexus-Administrator-Id', actor)
      .set('Idempotency-Key', key)
      .send(body);
  const edit = (id: string, body: object) =>
    auth(http().patch(root + '/' + id))
      .set('X-Nexus-Administrator-Id', actor)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const context = <T>(organizationId: string, work: () => Promise<T>) =>
    storage.run(
      new RequestContext({
        requestId: randomUUID(),
        actorType: 'SYSTEM',
        userId: null,
        organizationId: organizationId as never,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );
  const checkout = (
    id: string,
    promotionCode?: string,
    billingInterval: 'MONTHLY' | 'ANNUAL' = 'MONTHLY',
  ) =>
    context(id, () =>
      billing.createCheckoutSession({
        organizationId: id,
        planCode: 'PROFESSIONAL',
        billingInterval,
        promotionCode,
      }),
    );

  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    const old = { ...process.env };
    delete process.env.ORBIT_DEPLOYMENT;
    process.env.ORBIT_CORPORATE_ADMIN_ENABLED = 'true';
    process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS = JSON.stringify([
      credential('writer', secret, [
        'promotions:create',
        'promotions:update',
        'promotions:activate',
        'promotions:deactivate',
      ]),
      credential('reader', readSecret, ['promotions:read']),
    ]);
    const plan = await db.plan.findUniqueOrThrow({
      where: { key: 'PROFESSIONAL' },
    });
    planId = plan.id;
    catalogVersion = plan.catalogVersion;
    const commercial = plan.commercial as Prisma.JsonObject & {
      prices: Record<string, Prisma.JsonObject>;
    };
    await db.plan.update({
      where: { id: plan.id },
      data: {
        commercial: {
          ...commercial,
          prices: {
            ...commercial.prices,
            MONTHLY: { amountMinor: minor, stripePriceId: priceId },
            ANNUAL: {
              amountMinor: minor * 12,
              stripePriceId: 'price_adm05_annual',
            },
          },
        },
      },
    });
    await db.planStripePrice.upsert({
      where: { id: priceId },
      create: {
        id: priceId,
        planCode: 'PROFESSIONAL',
        billingInterval: 'MONTHLY',
        amountMinor: minor,
      },
      update: {},
    });
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(BILLING_PROVIDER)
        .useValue(provider)
        .compile();
      app = module.createNestApplication<INestApplication<App>>();
      configureApiVersioning(app);
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
      billing = app.get(BillingService);
      fulfillment = app.get(BillingCheckoutFulfillmentService);
      storage = app.get(RequestContextStorage);
    } finally {
      for (const key of [
        'ORBIT_DEPLOYMENT',
        'ORBIT_CORPORATE_ADMIN_ENABLED',
        'ORBIT_CORPORATE_ADMIN_CREDENTIALS',
      ]) {
        if (old[key] === undefined) delete process.env[key];
        else process.env[key] = old[key];
      }
    }
  });
  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  async function tenant(
    label: string,
    paid = false,
    billingInterval = 'MONTHLY',
  ) {
    const email = `${label}-${randomUUID()}@example.test`;
    const owner = await db.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Owner',
        lastName: 'Fixture',
        displayName: 'Synthetic owner',
        status: 'ACTIVE',
      },
    });
    const organization = await db.organization.create({
      data: {
        ownerUserId: owner.id,
        planId,
        slug: label + '-' + randomUUID(),
        displayName: 'Synthetic tenant',
        primarySegment: 'HVAC_R',
        status: 'ACTIVE',
      },
    });
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 86_400_000);
    const base = {
      organizationId: organization.id,
      planCode: 'PROFESSIONAL',
      catalogVersion,
      entitlementsSnapshot: snapshotOf(
        planDefinition('PROFESSIONAL'),
      ) as unknown as Prisma.InputJsonValue,
      billingInterval,
      billingAnchorAt: from,
      currentPeriodStart: from,
      currentPeriodEnd: to,
      startedAt: from,
    };
    if (paid)
      await db.organizationSubscription.create({
        data: {
          ...base,
          status: 'CANCELED',
          endedAt: from,
          providerSubscriptionId: 'sub_old_' + randomUUID(),
          provider: 'STRIPE',
        },
      });
    await db.organizationSubscription.create({
      data: { ...base, status: 'PENDING_PAYMENT' },
    });
    return organization.id;
  }

  async function campaign(code: string, overrides: object = {}) {
    const payload = {
      code,
      name: 'Promoção sintética',
      terms: terms(overrides),
      reason: 'ADMINISTRATIVE',
    };
    return data(await send('', payload).expect(201)).promotion;
  }

  async function activateCampaign(promotion: Receipt['promotion']) {
    const command = {
      reason: 'CAMPAIGN_LAUNCH',
      expectedVersion: promotion.version,
    };
    const key = randomUUID();
    const pending = data(
      await send('/' + promotion.id + '/activate', command, key).expect(202),
    );
    expect(pending).toMatchObject({
      pending: true,
      promotion: { status: 'ACTIVATING' },
    });
    const done = data(
      await send('/' + promotion.id + '/activate', command, key).expect(200),
    );
    expect(done).toMatchObject({
      operationId: pending.operationId,
      pending: false,
      replayed: true,
      promotion: { status: 'ACTIVE', providerMode: 'TEST' },
    });
    return done.promotion;
  }

  it('manages drafts with capability checks, version control, stable idempotency and sanitized audit', async () => {
    const payload = {
      code: 'Verao-ADM05',
      name: 'Verão de teste',
      terms: terms(),
      reason: 'ADMINISTRATIVE',
    };
    await auth(http().post(root), true)
      .set('X-Nexus-Administrator-Id', actor)
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(403);
    await send('', {
      ...payload,
      terms: { ...payload.terms, amountOffMinor: 2000, currency: 'BRL' },
    }).expect(400);
    const key = randomUUID();
    const first = data(await send('', payload, key).expect(201));
    expect(
      data(
        await send('', { ...payload, code: 'VERAO-ADM05' }, key).expect(201),
      ),
    ).toMatchObject({ operationId: first.operationId, replayed: true });
    const mismatch = await send('', { ...payload, name: 'Outro' }, key).expect(
      409,
    );
    expect(mismatch.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_MISMATCH' },
    });
    const id = first.promotion.id;
    await edit(id, {
      name: 'Ajuste',
      reason: 'CORRECTION',
      expectedVersion: 999,
    }).expect(409);
    await edit(id, {
      name: 'Ajuste',
      reason: 'CORRECTION',
      expectedVersion: 1,
    }).expect(200);
    const list = await get('?status=DRAFT&code=verao&page=1&pageSize=1').expect(
      200,
    );
    expect(data(list)).toMatchObject({
      total: 1,
      items: [{ id, name: 'Ajuste', version: 2 }],
    });
    expect(data(await get('/' + id).expect(200))).toMatchObject({
      code: 'VERAO-ADM05',
      status: 'DRAFT',
    });
    expect(providerPromotions.size).toBe(0);
    expect(createCustomer).not.toHaveBeenCalled();
    const audit = await db.auditLog.findFirst({
      where: { action: 'CORPORATE_PROMOTION_RESULT', entityId: id },
    });
    expect(audit).toMatchObject({
      userId: null,
      metadata: {
        technicalPrincipalId: principal,
        declaredNexusAdministratorId: actor,
      },
    });
    expect(JSON.stringify(audit)).not.toContain(key);
  });

  it('recovers Stripe activation, serializes the last slot, and commits only verified discount evidence', async () => {
    const draft = await campaign('CONCORRENCIA');
    const active = await activateCampaign(draft);
    expect(providerPromotions.size).toBe(1);
    const first = await tenant('first');
    const second = await tenant('second');
    const results = await Promise.allSettled([
      checkout(first, active.code),
      checkout(second, active.code),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const winner = results[0]?.status === 'fulfilled' ? first : second;
    const loser = winner === first ? second : first;
    const session = await checkout(winner, active.code.toLowerCase());
    const reserved = await get(
      '/' + active.id + '/redemptions?status=RESERVED',
    ).expect(200);
    expect(data(reserved)).toMatchObject({
      total: 1,
      items: [
        {
          organizationId: winner,
          status: 'RESERVED',
          originalMinor: minor,
          discountMinor: null,
        },
      ],
    });
    expect(reserved.text).not.toContain('promo_');
    await provider.expireCheckoutSession(session.providerSessionId);
    await fulfillment.expirePromotion(session.providerSessionId);
    const next = await checkout(loser, active.code);
    expect(
      data(
        await get('/' + active.id + '/redemptions?status=RELEASED').expect(200),
      ),
    ).toMatchObject({ total: 1 });
    const remote = checkoutSessions.get(next.providerSessionId)!;
    const providerId = providerPromotions.get(active.id)!.id;
    const complete = {
      ...remote,
      state: ProviderCheckoutState.COMPLETE,
      rawStatus: 'complete',
      paymentStatus: 'paid',
      providerSubscriptionId: 'sub_adm05',
    };
    const evidence = {
      providerId,
      originalMinor: minor,
      discountMinor: 3000,
      totalMinor: minor - 3000,
      currency: 'brl',
    };
    checkoutSessions.set(next.providerSessionId, {
      ...complete,
      promotionEvidence: { ...evidence, providerId: 'promo_wrong' },
    });
    await expect(fulfillment.fulfill(next.providerSessionId)).rejects.toThrow(
      'CHECKOUT_PROMOTION_MISMATCH',
    );
    checkoutSessions.set(next.providerSessionId, {
      ...complete,
      promotionEvidence: evidence,
    });
    await fulfillment.fulfill(next.providerSessionId);
    await fulfillment.fulfill(next.providerSessionId);
    await edit(active.id, {
      terms: terms({ percentOff: 25 }),
      reason: 'CORRECTION',
      expectedVersion: active.version,
    }).expect(409);
    const closed = data(
      await send('/' + active.id + '/deactivate', {
        reason: 'CAMPAIGN_ENDED',
        expectedVersion: active.version,
      }).expect(200),
    );
    expect(closed).toMatchObject({ promotion: { status: 'INACTIVE' } });
    expect(
      data(
        await get('/' + active.id + '/redemptions?status=CONFIRMED').expect(
          200,
        ),
      ),
    ).toMatchObject({
      total: 1,
      items: [
        {
          organizationId: loser,
          originalMinor: minor,
          discountMinor: 3000,
          status: 'CONFIRMED',
        },
      ],
    });
    await expect(
      checkout(await tenant('after-close'), active.code),
    ).rejects.toThrow('promotion is unavailable');
  });

  it('supports fixed BRL and repeated monthly offers, enforcing audience, windows and original checkout path', async () => {
    const fixed = await activateCampaign(
      await campaign('RETORNO', {
        percentOff: undefined,
        amountOffMinor: 2500,
        currency: 'BRL',
        durationMonths: 3,
        audience: 'EXISTING_CUSTOMER',
        totalLimit: 2,
      }),
    );
    const newcomer = await tenant('newcomer');
    const returning = await tenant('returning', true);
    await expect(checkout(newcomer, fixed.code)).rejects.toThrow(
      'promotion is unavailable',
    );
    const annual = await tenant('annual', true, 'ANNUAL');
    await expect(checkout(annual, fixed.code, 'ANNUAL')).rejects.toThrow(
      'promotion is unavailable',
    );
    const session = await checkout(returning, fixed.code);
    const remote = checkoutSessions.get(session.providerSessionId)!;
    checkoutSessions.set(session.providerSessionId, {
      ...remote,
      state: ProviderCheckoutState.COMPLETE,
      rawStatus: 'complete',
      paymentStatus: 'paid',
      providerSubscriptionId: 'sub_adm05fixed',
      promotionEvidence: {
        providerId: providerPromotions.get(fixed.id)!.id,
        originalMinor: minor,
        discountMinor: 2500,
        totalMinor: minor - 2500,
        currency: 'brl',
      },
    });
    await fulfillment.fulfill(session.providerSessionId);
    const used = await db.organizationSubscription.findUniqueOrThrow({
      where: { id: remote.metadata.subscriptionId! },
    });
    const now = new Date();
    await db.organizationSubscription.update({
      where: { id: used.id },
      data: { status: 'CANCELED', endedAt: now },
    });
    await db.organizationSubscription.create({
      data: {
        organizationId: returning,
        planCode: used.planCode,
        billingInterval: used.billingInterval,
        catalogVersion: used.catalogVersion,
        entitlementsSnapshot:
          used.entitlementsSnapshot as Prisma.InputJsonValue,
        status: 'PENDING_PAYMENT',
        billingAnchorAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 86_400_000),
        startedAt: now,
      },
    });
    await expect(checkout(returning, fixed.code)).rejects.toThrow(
      'promotion is unavailable',
    );
    await expect(
      checkout(await tenant('another-returning', true), fixed.code),
    ).resolves.toHaveProperty('providerSessionId');
    expect(activate.mock.calls.at(-1)?.[0]).toMatchObject({
      percentOff: null,
      amountOffMinor: 2500,
      durationMonths: 3,
    });
    const future = await activateCampaign(
      await campaign('FUTURO', {
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    await expect(
      checkout(await tenant('before-start'), future.code),
    ).rejects.toThrow('promotion is unavailable');
    const expired = await campaign('EXPIRADA', {
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await send('/' + expired.id + '/activate', {
      reason: 'CAMPAIGN_LAUNCH',
      expectedVersion: expired.version,
    }).expect(409);
    const original = await checkout(newcomer);
    expect(original.url).toContain('checkout.stripe.test');
    expect(createSession.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'promotion',
    );
  });
});
