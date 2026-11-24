import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { RlsTransaction, PrismaService } from '../src/database';
import { BackgroundJobQueue } from '../src/modules/jobs/background-job.queue';
import { JOB_QUEUES } from '../src/modules/jobs/background-job.types';
import { buildQueueGroups } from '../src/modules/jobs/queue-groups';
import type { EnvironmentProvider } from '../src/providers';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const suite = process.env.ORBIT_PGBOUNCER_E2E ? describe : describe.skip;
jest.setTimeout(120_000);

suite('Queue claims over PgBouncer', () => {
  const clients: PrismaService[] = [];
  const group = buildQueueGroups().pdf;
  const queue = JOB_QUEUES.documentExport;

  function connect(url: string) {
    const environment = {
      getOptional: (key: string) =>
        ({
          NODE_ENV: 'test',
          APP_DATABASE_URL: url,
          DATABASE_POOL_MAX: '8',
          DATABASE_ENFORCE_RESTRICTED_ROLE: 'true',
        })[key],
    } as EnvironmentProvider;
    const prisma = new PrismaService(environment);
    clients.push(prisma);
    return prisma;
  }

  beforeAll(() => {
    if (
      !/^orbit-pool-e2e-[a-f0-9]+$/.test(
        process.env.ORBIT_PGBOUNCER_E2E ?? '',
      ) ||
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_')
    )
      throw new Error('Disposable runner required');
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
    await disconnectAdminPrisma();
  });

  it('shares the tenant ceiling across consumers, releases transaction locks and refuses API worker authority', async () => {
    const admin = adminPrisma();
    const plan = await admin.plan.findFirstOrThrow({ select: { id: true } });
    const orgs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const email = `queue-${randomUUID()}@example.test`;
      const owner = await admin.user.create({
        data: {
          email,
          normalizedEmail: email,
          firstName: 'Queue',
          lastName: 'Pool',
          displayName: 'Queue Pool',
          status: 'ACTIVE',
        },
      });
      const org = await admin.organization.create({
        data: {
          ownerUserId: owner.id,
          planId: plan.id,
          slug: randomUUID(),
          displayName: 'Queue Pool',
          primarySegment: 'HVAC',
        },
      });
      orgs.push(org.id);
      await admin.backgroundJob.createMany({
        data: Array.from({ length: 6 }, () => ({
          organizationId: org.id,
          businessUnitIds: [],
          scope: 'ORGANIZATION',
          queue,
          jobKey: randomUUID(),
          correlationId: 'pool-e2e',
        })),
      });
    }
    const app = connect(process.env.APP_DATABASE_URL!);
    const worker = connect(process.env.ORBIT_PG_WORKER_URL!);
    const documents = connect(process.env.ORBIT_PG_DOCUMENTS_URL!);
    await Promise.all(clients.map((client) => client.onModuleInit()));
    const consumers = [worker, documents].map(
      (client) => new BackgroundJobQueue(client, {} as RlsTransaction),
    );
    const forbidden = new BackgroundJobQueue(app, {} as RlsTransaction);
    await expect(
      forbidden.claim(group, [queue], randomUUID()),
    ).resolves.toBeNull();
    const claims = await Promise.all(
      Array.from({ length: 36 }, (_, index) =>
        consumers[index % 2]!.claim(group, [queue], randomUUID()),
      ),
    );
    const ids = claims.flatMap((job) => (job ? [job.id] : []));
    expect(ids).toHaveLength(orgs.length * group.perOrganizationLimit);
    expect(new Set(ids).size).toBe(ids.length);
    for (const organizationId of orgs)
      expect(
        claims.filter((job) => job?.organizationId === organizationId),
      ).toHaveLength(group.perOrganizationLimit);

    const pool = new Pool({
      connectionString: process.env.ORBIT_PG_WORKER_URL,
    });
    try {
      const [scope] = (
        await pool.query<{ worker: boolean; acquired: boolean }>(
          "SELECT app_is_job_worker() AS worker, pg_try_advisory_xact_lock(hashtextextended('orbit:jobs:claim:pdf',0)) AS acquired",
        )
      ).rows;
      expect(scope).toEqual({ worker: false, acquired: true });
    } finally {
      await pool.end();
    }
  });
});
