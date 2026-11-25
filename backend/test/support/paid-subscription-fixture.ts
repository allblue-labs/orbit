import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { RequestContext, RequestContextStorage } from '../../src/context';
import type { UUID } from '../../src/contracts';
import { SubscriptionService } from '../../src/modules/subscription-plans/subscriptions/subscription.service';
import { SubscriptionStatus } from '../../src/modules/subscription-plans/subscriptions/subscription.types';
import { generateUuidV7 } from '../../src/utils';

/** Other feature suites need an already paid tenant, not free access to a paid plan. */
export async function paidSubscriptionFixture(
  app: INestApplication,
  prisma: PrismaClient,
  email: string,
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  const membership = await prisma.organizationMembership.findFirstOrThrow({
    where: { userId: user.id },
    select: { organizationId: true },
  });
  const organizationId = membership.organizationId;
  return app.get(RequestContextStorage).run(
    new RequestContext({
      requestId: generateUuidV7(),
      userId: user.id as UUID,
      organizationId: organizationId as UUID,
      businessUnitId: null,
      businessUnitIds: [],
      roles: ['OWNER'],
      permissions: ['*'],
      ip: null,
      userAgent: null,
      locale: 'pt-BR',
    }),
    async () => {
      const service = app.get(SubscriptionService);
      const current = await service.currentOrNull(organizationId);
      if (current?.status === SubscriptionStatus.PENDING_PAYMENT)
        await service.reportPaymentSucceeded(organizationId, current.version, {
          start: current.currentPeriodStart,
          end: current.currentPeriodEnd,
        });
    },
  );
}
