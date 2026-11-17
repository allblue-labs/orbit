import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  manifest,
  scopeRules,
  violationSql,
} from '../src/database/relational-integrity/contract';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120000);
interface Scope {
  org: string;
  unit: string;
  customer: string;
  asset: string;
  config: string;
}
describe('PR-12 — real PostgreSQL relational boundaries and safe upgrade', () => {
  const admin = adminPrisma();
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const runtime = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  let userId: string,
    a: Scope,
    b: Scope,
    otherUnit: string,
    otherCustomer: string;
  async function fixture(): Promise<Scope> {
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const org = await admin.organization.create({
      data: {
        ownerUserId: userId,
        planId: plan.id,
        slug: `pr12-${randomUUID()}`,
        displayName: 'Integrity fixture',
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
        legalName: 'Fixture LTDA',
        documentType: 'CNPJ',
        documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
        city: 'Recife',
        street: 'Rua Teste',
        status: 'ACTIVE',
      },
    });
    const customer = await admin.customer.create({
      data: { organizationId: org.id, legalName: 'Fixture customer' },
    });
    const asset = await admin.asset.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        customerId: customer.id,
        name: 'Fixture equipment',
        category: 'HVAC',
      },
    });
    const config = await admin.rvtConfiguration.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        customerId: customer.id,
        code: `RVT-${randomUUID()}`,
        name: 'Fixture RVT',
        scheduleMode: 'ONE_TIME',
        coverageStart: new Date(),
        timezone: 'America/Recife',
        serviceLocation: {},
        createdById: userId,
      },
    });
    return {
      org: org.id,
      unit: unit.id,
      customer: customer.id,
      asset: asset.id,
      config: config.id,
    };
  }
  async function inScope<T>(
    scope: Scope,
    work: (tx: PoolClient) => Promise<T>,
  ): Promise<T> {
    const tx = await runtime.connect();
    try {
      await tx.query('BEGIN');
      await tx.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.business_unit_ids',$3,true),set_config('app.is_platform_admin','false',true)",
        [userId, scope.org, scope.unit],
      );
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  const configuration = (
    scope: Scope,
    customer = scope.customer,
    unit = scope.unit,
  ) =>
    inScope(scope, (tx) =>
      tx.query(
        `INSERT INTO rvt_configurations(id,organization_id,business_unit_id,customer_id,code,name,schedule_mode,coverage_start,timezone,service_location,created_by_id,updated_at) VALUES($1,$2,$3,$4,$5,'RVT','ONE_TIME',CURRENT_DATE,'America/Recife','{}',$6,now()) RETURNING id`,
        [randomUUID(), scope.org, unit, customer, randomUUID(), userId],
      ),
    );
  const link = (scope: Scope, asset: string) =>
    inScope(scope, (tx) =>
      tx.query(
        'INSERT INTO rvt_configuration_equipment(id,organization_id,configuration_id,asset_id) VALUES($1,$2,$3,$4)',
        [randomUUID(), scope.org, scope.config, asset],
      ),
    );
  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable DB only');
    const email = `pr12.${randomUUID()}@example.test`;
    userId = (
      await admin.user.create({
        data: {
          email,
          normalizedEmail: email,
          firstName: 'Fixture',
          lastName: 'Integrity',
          displayName: 'Fixture',
          status: 'ACTIVE',
        },
      })
    ).id;
    a = await fixture();
    b = await fixture();
    otherUnit = (
      await admin.businessUnit.create({
        data: {
          organizationId: a.org,
          slug: 'filial',
          type: 'BRANCH',
          legalName: 'Filial',
          documentType: 'CNPJ',
          documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
          city: 'Recife',
          street: 'Rua',
          status: 'ACTIVE',
        },
      })
    ).id;
    otherCustomer = (
      await admin.customer.create({
        data: { organizationId: a.org, legalName: 'Other customer' },
      })
    ).id;
  });
  afterAll(async () => {
    await runtime.end();
    await db.end();
    await disconnectAdminPrisma();
  });
  it('uses the restricted runtime role and retains the reviewed FK inventory', async () => {
    const role = await runtime.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const rows = await db.query<{ name: string }>(
      "SELECT conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='f' AND conname NOT LIKE 'pr12_%' AND conname NOT LIKE 'pr13_%' AND conname NOT LIKE 'ses_owner_%'",
    );
    expect(rows.rows.map((r) => r.name).sort()).toEqual(
      manifest.baselineForeignKeys.map((r) => r.conname).sort(),
    );
    const invalid = await db.query(
      "SELECT conname FROM pg_constraint WHERE conname LIKE 'pr12_%' AND NOT convalidated",
    );
    expect(invalid.rows).toHaveLength(0);
    const constraints = await db.query<{ name: string }>(
      "SELECT conname AS name FROM pg_constraint WHERE conname LIKE 'pr12_%'",
    );
    expect(constraints.rows.map((r) => r.name).sort()).toEqual(
      scopeRules
        .filter((r) => r.kind === 'composite')
        .map((r) => r.name)
        .sort(),
    );
    const execute = await runtime.query<{ allowed: boolean }>(
      "SELECT has_function_privilege(current_user,'public.pr12_check_scope()','EXECUTE') AS allowed",
    );
    expect(execute.rows[0]?.allowed).toBe(false);
  });
  it('rejects the exact audited A → customer B write even when RLS permits the child', async () => {
    await expect(configuration(a, b.customer)).rejects.toMatchObject({
      code: '23503',
    });
    await expect(
      configuration(
        { ...a, unit: [a.unit, b.unit].join(',') },
        a.customer,
        b.unit,
      ),
    ).rejects.toMatchObject({
      code: '23503',
    });
    await expect(configuration(a)).resolves.toMatchObject({ rowCount: 1 });
    await expect(configuration(b)).resolves.toMatchObject({ rowCount: 1 });
  });
  it('rejects cross-tenant customers in assets and cross-tenant RVT equipment', async () => {
    await expect(
      inScope(a, (tx) =>
        tx.query('UPDATE assets SET customer_id=$1 WHERE id=$2', [
          b.customer,
          a.asset,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(link(a, b.asset)).rejects.toMatchObject({ code: '23503' });
    await expect(link(a, a.asset)).resolves.toMatchObject({ rowCount: 1 });
  });
  it('rejects same-tenant RVT equipment belonging to another customer or unit', async () => {
    const wrong = await admin.asset.create({
      data: {
        organizationId: a.org,
        businessUnitId: a.unit,
        customerId: otherCustomer,
        name: 'Wrong customer',
        category: 'HVAC',
      },
    });
    await expect(link(a, wrong.id)).rejects.toMatchObject({ code: '23503' });
    const wrongUnit = await admin.asset.create({
      data: {
        organizationId: a.org,
        businessUnitId: otherUnit,
        customerId: a.customer,
        name: 'Wrong unit',
        category: 'HVAC',
      },
    });
    await expect(link(a, wrongUnit.id)).rejects.toMatchObject({
      code: '23503',
    });
  });
  it('enforces hierarchy unit equality independently of RLS unit grants', async () => {
    await expect(
      inScope({ ...a, unit: [a.unit, otherUnit].join(',') }, (tx) =>
        tx.query(
          `INSERT INTO rvt_occurrences(id,organization_id,business_unit_id,configuration_id,sequence_number,updated_at) VALUES($1,$2,$3,$4,100,now())`,
          [randomUUID(), a.org, otherUnit, a.config],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('rejects a foreign UUID embedded in the occurrence equipment array', async () => {
    await expect(
      inScope(a, (tx) =>
        tx.query(
          `INSERT INTO rvt_occurrences(id,organization_id,business_unit_id,configuration_id,sequence_number,equipment_ids,updated_at) VALUES($1,$2,$3,$4,101,$5,now())`,
          [randomUUID(), a.org, a.unit, a.config, [b.asset]],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('retains global checklist/template use but denies a tenant template from another tenant', async () => {
    const global = await admin.artifactTemplate.findFirstOrThrow({
      where: { organizationId: null },
    });
    const foreign = await admin.artifactTemplate.create({
      data: {
        organizationId: b.org,
        key: `PR12_${randomUUID()}`,
        name: 'Foreign template',
        artifactType: global.artifactType,
      },
    });
    const make = (id: string) =>
      inScope(a, (tx) =>
        tx.query(
          `INSERT INTO checklist_templates(id,organization_id,key,name,items,artifact_template_id,updated_at) VALUES($1,$2,$3,'Fixture','[]',$4,now())`,
          [randomUUID(), a.org, randomUUID(), id],
        ),
      );
    await expect(make(global.id)).resolves.toMatchObject({ rowCount: 1 });
    // Missing must not be mistaken for an existing global (NULL-tenant) row;
    // otherwise a concurrent parent INSERT could beat the original simple FK.
    const guard = scopeRules.find(
      (r) =>
        r.table === 'checklist_templates' &&
        r.column === 'artifact_template_id',
    )!;
    await expect(make(randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: guard.name,
    });
    await expect(make(foreign.id)).rejects.toMatchObject({ code: '23503' });
    await expect(
      admin.artifactTemplate.update({
        where: { id: foreign.id },
        data: { organizationId: a.org },
      }),
    ).rejects.toThrow();
  });
  it('preserves optional FK SET NULL without nulling the child tenant', async () => {
    const customer = await admin.customer.create({
      data: { organizationId: a.org, legalName: 'Disposable' },
    });
    const address = await admin.contact.create({
      data: {
        organizationId: a.org,
        customerId: customer.id,
        name: 'Optional',
      },
    });
    // Contact uses ON DELETE CASCADE. The existing optional asset relation uses SET NULL.
    const asset = await admin.asset.create({
      data: {
        organizationId: a.org,
        businessUnitId: a.unit,
        customerId: customer.id,
        name: 'Optional customer',
        category: 'HVAC',
      },
    });
    await admin.customer.delete({ where: { id: customer.id } });
    expect(
      await admin.asset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).toMatchObject({ organizationId: a.org, customerId: null });
    expect(
      await admin.contact.findUnique({ where: { id: address.id } }),
    ).toBeNull();
  });
  it('checks all rules with administrative visibility and no tenant payload', async () => {
    for (const rule of scopeRules)
      expect(
        (await db.query<{ violations: string }>(violationSql(rule))).rows[0]
          ?.violations,
      ).toBe('0');
  });
  it('refuses a dirty legacy upgrade atomically, then upgrades repaired data without deleting it', async () => {
    // Disposable fixture only: restore old constraints, reproducing the pre-PR schema.
    const client = await db.connect();
    const sql = readFileSync(
      resolve(
        __dirname,
        '../prisma/migrations/20261117100000_relational_tenant_integrity/migration.sql',
      ),
      'utf8',
    );
    try {
      const triggers = await client.query<{ table: string; name: string }>(
        "SELECT c.relname AS table,t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname LIKE 'pr12_%'",
      );
      for (const row of triggers.rows)
        await client.query(`DROP TRIGGER "${row.name}" ON "${row.table}"`);
      const constraints = await client.query<{ table: string; name: string }>(
        "SELECT c.relname AS table,k.conname AS name FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE k.conname LIKE 'pr12_%'",
      );
      for (const row of constraints.rows)
        await client.query(
          `ALTER TABLE "${row.table}" DROP CONSTRAINT "${row.name}"`,
        );
      const indexes = await client.query<{ table: string; name: string }>(
        "SELECT tablename AS table,indexname AS name FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'pr12_%'",
      );
      for (const index of indexes.rows)
        await client.query(`DROP INDEX public."${index.name}"`);
      for (const fn of [
        'pr12_check_scope',
        'pr12_immutable_tenant',
        'pr12_rvt_asset_scope',
        'pr12_rvt_occurrence_assets',
      ])
        await client.query(`DROP FUNCTION public.${fn}()`);
      const dirty = await configuration(a, b.customer);
      const dirtyId = (dirty.rows[0] as { id: string }).id;
      await expect(client.query(sql)).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK');
      expect(
        await admin.rvtConfiguration.findUniqueOrThrow({
          where: { id: dirtyId },
        }),
      ).toMatchObject({ customerId: b.customer });
      expect(
        (
          await client.query(
            "SELECT conname FROM pg_constraint WHERE conname LIKE 'pr12_%'",
          )
        ).rows,
      ).toHaveLength(0);
      await admin.rvtConfiguration.update({
        where: { id: dirtyId },
        data: { customerId: a.customer },
      });
      await client.query(sql);
      expect(
        await admin.rvtConfiguration.findUniqueOrThrow({
          where: { id: dirtyId },
        }),
      ).toMatchObject({ customerId: a.customer });
      await expect(configuration(a, b.customer)).rejects.toMatchObject({
        code: '23503',
      });
    } finally {
      client.release();
    }
  });
});
