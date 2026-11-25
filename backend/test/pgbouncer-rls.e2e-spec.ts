import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import type { UUID } from '../src/contracts';
import { RlsTransaction } from '../src/database';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { generateUuidV7 } from '../src/utils';

const suite = process.env.ORBIT_PGBOUNCER_E2E ? describe : describe.skip;
jest.setTimeout(120_000);

suite('PostgreSQL RLS through PgBouncer transaction pooling', () => {
  const apps: INestApplication<App>[] = [];
  let pool: Pool;
  let a: Awaited<ReturnType<typeof tenant>>;
  let b: Awaited<ReturnType<typeof tenant>>;
  let aSecondUnit: string;

  const get = (index: number, token: string, path: string) =>
    request(apps[index]!.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  async function tenant(documentNumber: string) {
    const email = `pool-${randomUUID()}@example.test`;
    const login = await registerVerifiedOwner(apps[0]!, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      password: 'Synthetic#Only@2026',
      firstName: 'Orbit',
      lastName: 'Pool',
      organizationName: `Organização ${documentNumber}`,
      legalName: `Organização ${documentNumber}`,
      documentType: 'CNPJ',
      documentNumber,
      city: 'Recife',
      street: 'Rua da Aurora',
      stateCode: 'PE',
    });
    const { accessToken } = (login.body as { data: { accessToken: string } })
      .data;
    const owner = await adminPrisma().user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      select: {
        id: true,
        ownedOrganizations: {
          select: { id: true, businessUnits: { select: { id: true } } },
        },
      },
    });
    const org = owner.ownedOrganizations[0]!;
    return {
      token: accessToken,
      user: owner.id,
      org: org.id,
      unit: org.businessUnits[0]!.id,
    };
  }

  async function scope(client: PoolClient, who: typeof a) {
    await client.query(
      `
      SELECT set_config('app.actor_type','INTERNAL_USER',true),
        set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true),
        set_config('app.business_unit_id',$3,true), set_config('app.business_unit_ids',$3,true),
        set_config('app.is_platform_admin','false',true)`,
      [who.user, who.org, who.unit],
    );
  }

  beforeAll(async () => {
    if (
      !/^orbit-pool-e2e-[a-f0-9]+$/.test(
        process.env.ORBIT_PGBOUNCER_E2E ?? '',
      ) ||
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_')
    )
      throw new Error('Disposable runner required');
    pool = new Pool({
      connectionString: process.env.APP_DATABASE_URL,
      max: 256,
      connectionTimeoutMillis: 12_000,
      idleTimeoutMillis: 0,
    });
    for (let index = 0; index < 2; index++) {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const app = module.createNestApplication<INestApplication<App>>();
      apps.push(app);
      configureApiVersioning(app);
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
    }
    a = await tenant('11222333000181');
    b = await tenant('12345678000195');
    aSecondUnit = (
      await adminPrisma().businessUnit.create({
        data: {
          organizationId: a.org,
          slug: 'segunda-unidade',
          legalName: 'Segunda filial',
          documentType: 'CNPJ',
          documentNumber: '11222333000181',
          city: 'Recife',
          street: 'Rua de teste',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await pool?.end();
    for (const app of apps) await app.close();
    await disconnectAdminPrisma();
  });

  it('rejects foreign tenants, foreign units, unscoped functions and borrowed job/file references', async () => {
    const insert = (
      id: string,
      org: string,
      unit: string,
      job: string | null = null,
    ) => [id, org, unit, randomUUID(), job];
    const sql = `INSERT INTO document_exports(id,organization_id,business_unit_id,kind,entity_id,job_id,correlation_id,expires_at)
      VALUES($1,$2,$3,'QUOTE',$4,$5,'pool-rls',now()+interval '1 hour')`;
    const foreignJob = await adminPrisma().backgroundJob.create({
      data: {
        organizationId: b.org,
        businessUnitId: b.unit,
        businessUnitIds: [b.unit],
        scope: 'BUSINESS_UNIT',
        queue: 'pool.test',
        jobKey: randomUUID(),
        correlationId: 'pool-rls',
      },
    });
    const exports = [
      { organizationId: a.org, businessUnitId: a.unit },
      { organizationId: a.org, businessUnitId: aSecondUnit },
      { organizationId: b.org, businessUnitId: b.unit },
    ].map((data) => ({
      ...data,
      id: generateUuidV7(),
      kind: 'QUOTE',
      entityId: randomUUID(),
      correlationId: 'pool-rls',
      expiresAt: new Date(Date.now() + 60_000),
    }));
    await adminPrisma().documentExport.createMany({ data: exports });
    const otherUnitFile = await adminPrisma().storageFile.create({
      data: {
        organizationId: a.org,
        businessUnitId: aSecondUnit,
        provider: 'LOCAL',
        bucket: 'fixture',
        objectKey: randomUUID(),
        fileName: 'relatorio.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1n,
        status: 'AVAILABLE',
        sha256: 'a'.repeat(64),
        metadata: { documentExportId: exports[0]!.id },
      },
    });
    await get(1, b.token, `/api/v1/document-exports/${exports[0]!.id}`).expect(
      404,
    );
    const client = await pool.connect();
    try {
      await expect(
        client.query('SELECT app_document_exports_in_progress($1)', [b.org]),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('BEGIN');
      await scope(client, a);
      const visible = await client.query<{ id: string }>(
        'SELECT id FROM document_exports ORDER BY id',
      );
      expect(visible.rows.map(({ id }) => id)).toEqual([exports[0]!.id]);
      const hidden = exports.slice(1).map(({ id }) => id);
      const update = await client.query(
        'UPDATE document_exports SET file_name=$1 WHERE id=ANY($2::uuid[])',
        ['bad', hidden],
      );
      const deletion = await client.query(
        'DELETE FROM document_exports WHERE id=ANY($1::uuid[])',
        [hidden],
      );
      expect(update.rowCount).toBe(0);
      expect(deletion.rowCount).toBe(0);
      for (const [statement, parameters, code] of [
        [sql, insert(randomUUID(), b.org, b.unit), '42501'],
        [sql, insert(randomUUID(), a.org, aSecondUnit), '42501'],
        [sql, insert(randomUUID(), a.org, a.unit, foreignJob.id), '23503'],
        [
          'UPDATE document_exports SET organization_id=$1, business_unit_id=$2 WHERE id=$3',
          [b.org, b.unit, exports[0]!.id],
          '42501',
        ],
        [
          'UPDATE document_exports SET storage_file_id=$1 WHERE id=$2',
          [otherUnitFile.id, exports[0]!.id],
          '23503',
        ],
      ] as const) {
        await client.query('SAVEPOINT cross_scope');
        await expect(
          client.query(statement, [...parameters]),
        ).rejects.toMatchObject({
          code,
        });
        await client.query('ROLLBACK TO SAVEPOINT cross_scope');
        await client.query('RELEASE SAVEPOINT cross_scope');
      }
      await client.query(sql, insert(randomUUID(), a.org, a.unit));
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('fails closed if an open ambient transaction receives a different request context', async () => {
    const app = apps[0]!;
    const contexts = app.get(RequestContextStorage);
    const rls = app.get(RlsTransaction);
    const context = (tenant: typeof a) =>
      new RequestContext({
        requestId: randomUUID(),
        userId: tenant.user as UUID,
        organizationId: tenant.org as UUID,
        businessUnitId: tenant.unit as UUID,
        businessUnitIds: [tenant.unit as UUID],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      });
    await expect(
      contexts.run(context(a), () =>
        rls.runAmbient(async () => {
          await contexts.run(context(b), () =>
            rls.run((tx) => tx.organization.findMany()),
          );
        }),
      ),
    ).rejects.toThrow('An open transaction cannot change its RLS context');
  });

  it('keeps the backend pool bounded while 256 clients and two HTTP replicas alternate tenant context', async () => {
    const start = performance.now();
    const pids = new Set<number>();
    const raw = async (index: number) => {
      const who = index % 2 ? a : b;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await scope(client, who);
        const scoped = await client.query<{ pid: number; ids: string[] }>(
          'SELECT pg_backend_pid() AS pid, ARRAY(SELECT id FROM organizations) AS ids',
        );
        pids.add(scoped.rows[0]!.pid);
        expect(scoped.rows[0]!.ids).toEqual([who.org]);
        await client.query(index % 3 ? 'COMMIT' : 'ROLLBACK');
        const reset = await client.query<{
          org: string | null;
          jobs: boolean;
          users: string;
          units: string | null;
          actor: string | null;
        }>(
          `SELECT NULLIF(current_setting('app.organization_id',true),'') AS org,
            NULLIF(current_setting('app.business_unit_ids',true),'') AS units,
            NULLIF(current_setting('app.actor_type',true),'') AS actor,
            app_is_job_worker() AS jobs, (SELECT count(*) FROM users) AS users`,
        );
        expect(reset.rows[0]).toEqual({
          org: null,
          units: null,
          actor: null,
          jobs: false,
          users: '0',
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };
    await Promise.all([
      ...Array.from({ length: 256 }, (_, index) => raw(index)),
      ...Array.from({ length: 24 }, (_, index) =>
        get(
          index % 2,
          index % 2 ? a.token : b.token,
          '/api/v1/organizations/current',
        ).expect(200),
      ),
    ]);
    expect(pool.totalCount).toBe(256);
    expect(pids.size).toBeLessThanOrEqual(4);
    console.info(
      `PgBouncer: 256 clients, ${pids.size} server connections, ${Math.round(performance.now() - start)} ms`,
    );
  });
});
