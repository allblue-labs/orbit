/**
 * Justiça entre organizações na fila, contra o Postgres real.
 *
 * A aplicação roda com o papel restrito; o cenário (organizações e jobs) é
 * plantado com o cliente administrativo. O que se prova:
 *
 * - quem tem menos jobs rodando no grupo passa na frente;
 * - o teto por organização vale somando réplicas que reivindicam ao mesmo
 *   tempo (é a trava consultiva por grupo);
 * - o grupo `ai` respeita o limite de taxa por organização;
 * - o grupo `fiscal` não aceita a mesma chave duas vezes, nem depois de
 *   concluída — só um job `DEAD` libera a chave.
 */
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { BackgroundJobQueue } from '../src/modules/jobs/background-job.queue';
import {
  JOB_QUEUES,
  type JobQueue,
} from '../src/modules/jobs/background-job.types';
import {
  QUEUE_GROUPS,
  type QueueGroupConfig,
} from '../src/modules/jobs/queue-groups';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const PDF = JOB_QUEUES.documentExport;

async function organization(label: string) {
  const admin = adminPrisma();
  const email = `fair-${label}-${randomUUID()}@example.test`;
  const user = await admin.user.create({
    data: {
      email,
      normalizedEmail: email,
      firstName: 'Fila',
      lastName: label,
      displayName: `Fila ${label}`,
      status: 'ACTIVE',
    },
  });
  const plan = await admin.plan.findFirstOrThrow({ where: { isActive: true } });
  const org = await admin.organization.create({
    data: {
      ownerUserId: user.id,
      planId: plan.id,
      slug: `fair-${label}-${randomUUID()}`,
      displayName: `Fila ${label}`,
      primarySegment: 'HVAC',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
    },
  });
  const unit = await admin.businessUnit.create({
    data: {
      organizationId: org.id,
      slug: 'matriz',
      type: 'HEADQUARTERS',
      isPrimary: true,
      legalName: `Fila ${label} LTDA`,
      documentType: 'CNPJ',
      documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
      city: 'Recife',
      street: 'Rua da Fila',
      status: 'ACTIVE',
    },
  });
  return { org: org.id, unit: unit.id };
}

/** Planta um job pendente, com a idade dada em segundos. */
async function plant(
  queue: string,
  owner: { org: string; unit: string },
  ageSeconds: number,
  extra: { jobKey?: string; status?: string } = {},
) {
  const id = randomUUID();
  await adminPrisma().$executeRaw`
    INSERT INTO background_jobs (
      id, organization_id, business_unit_id, scope, business_unit_ids,
      queue, job_key, payload, status, correlation_id, available_at,
      created_at, updated_at
    ) VALUES (
      ${id}::uuid, ${owner.org}::uuid, ${owner.unit}::uuid, 'BUSINESS_UNIT',
      ARRAY[${owner.unit}::uuid], ${queue}, ${extra.jobKey ?? id}, '{}'::jsonb,
      ${extra.status ?? 'PENDING'}, ${id},
      now() - ${ageSeconds} * interval '1 second',
      now() - ${ageSeconds} * interval '1 second', now()
    )`;
  return id;
}

describe('Fila: justiça entre organizações (e2e)', () => {
  let queue: BackgroundJobQueue;
  let close: () => Promise<void>;

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    queue = app.get(BackgroundJobQueue);
    close = () => app.close();
  });

  afterAll(async () => {
    await close();
    await disconnectAdminPrisma();
  });

  beforeEach(async () => {
    await adminPrisma().$executeRaw`
      DELETE FROM background_jobs WHERE queue IN (${PDF}, 'ai.teste')`;
  });

  it('quem tem menos jobs rodando passa na frente, e o teto por organização segura o resto', async () => {
    const barulhenta = await organization('a');
    const vizinha = await organization('b');
    for (let i = 0; i < 6; i++) await plant(PDF, barulhenta, 600 - i);
    const daVizinha = await plant(PDF, vizinha, 10);

    const group = QUEUE_GROUPS.pdf;
    const claimed = [];
    for (let i = 0; i < 4; i++)
      claimed.push(await queue.claim(group, [PDF], `replica-${i}`));

    /* A barulhenta pegou a 1ª (mais antiga); a vizinha, a 2ª — mesmo tendo
       chegado dez minutos depois —; a 3ª volta para a barulhenta; a 4ª não
       existe: a barulhenta está no teto de 2 e a vizinha não tem mais nada. */
    expect(claimed.map((job) => job?.organizationId ?? null)).toEqual([
      barulhenta.org,
      vizinha.org,
      barulhenta.org,
      null,
    ]);
    expect(claimed[1]?.id).toBe(daVizinha);
  });

  it('cinco réplicas ao mesmo tempo não passam do teto de 2 por organização', async () => {
    const barulhenta = await organization('c');
    for (let i = 0; i < 10; i++) await plant(PDF, barulhenta, 100 - i);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        queue.claim(QUEUE_GROUPS.pdf, [PDF], `paralela-${i}`),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(
      QUEUE_GROUPS.pdf.perOrganizationLimit,
    );
    const [counted] = await adminPrisma().$queryRaw<{ running: number }[]>`
      SELECT count(*)::int AS running FROM background_jobs
       WHERE organization_id = ${barulhenta.org}::uuid AND status = 'RUNNING'`;
    expect(counted?.running).toBe(2);
  });

  it('o grupo ai respeita o limite de taxa por organização', async () => {
    const org = await organization('d');
    for (let i = 0; i < 4; i++) await plant('ai.teste', org, 50 - i);
    const ai: QueueGroupConfig = {
      ...QUEUE_GROUPS.ai,
      perOrganizationLimit: 10,
      rateLimit: {
        perOrganization: { max: 2, windowMs: 60_000 },
        global: { max: 100, windowMs: 60_000 },
      },
    };
    const queues = ['ai.teste' as JobQueue];

    const first = await queue.claim(ai, queues, 'ia-1');
    const second = await queue.claim(ai, queues, 'ia-2');
    const third = await queue.claim(ai, queues, 'ia-3');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    /* Duas começaram no último minuto: a terceira espera a janela. */
    expect(third).toBeNull();
  });

  it('fiscal: a mesma chave não entra duas vezes, nem concluída; DEAD libera', async () => {
    const org = await organization('e');
    await plant('fiscal.nfe.emitir', org, 5, {
      jobKey: 'nfe-123',
      status: 'SUCCEEDED',
    });
    await expect(
      plant('fiscal.nfe.emitir', org, 4, { jobKey: 'nfe-123' }),
    ).rejects.toThrow();

    await adminPrisma().$executeRaw`
      UPDATE background_jobs SET status = 'DEAD'
       WHERE queue = 'fiscal.nfe.emitir' AND organization_id = ${org.org}::uuid`;
    await expect(
      plant('fiscal.nfe.emitir', org, 3, { jobKey: 'nfe-123' }),
    ).resolves.toBeDefined();
  });
});
