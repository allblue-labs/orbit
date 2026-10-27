import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { nextPmocDueOnSql } from '../src/modules/pmoc/pmoc-schedule.sql';

// Tabelas temporárias: nenhum dado da aplicação é alterado. O PostgreSQL
// exercita a mesma expressão usada nas duas conclusões e a migração real.
describe('programação PMOC no PostgreSQL', () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  beforeAll(async () => {
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query(`
      BEGIN;
      CREATE TEMP TABLE pmoc_plans (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL,
        status text DEFAULT 'ACTIVE', deleted_at timestamptz,
        frequency_unit text DEFAULT 'MONTHS', frequency_amount int DEFAULT 1,
        last_executed_at timestamptz, next_due_on date, ends_on date,
        due_soon_notified_for date, overdue_notified_for date,
        updated_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
      CREATE TEMP TABLE pmoc_executions (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL, plan_id uuid NOT NULL,
        due_on date NOT NULL, status text NOT NULL, sequence_number int NOT NULL,
        updated_at timestamptz DEFAULT now(),
        UNIQUE(plan_id, due_on), UNIQUE(plan_id, sequence_number)
      ) ON COMMIT DROP;
    `);
  });
  afterEach(async () => {
    await db.query('ROLLBACK');
  });

  async function seed() {
    const planId = randomUUID();
    const organizationId = randomUUID();
    const cycleId = randomUUID();
    await db.query(
      `INSERT INTO pmoc_plans (id, organization_id, last_executed_at, next_due_on)
       VALUES ($1, $2, '2026-10-27T12:00:00Z', '2026-11-27')`,
      [planId, organizationId],
    );
    await db.query(
      `INSERT INTO pmoc_executions
       (id, organization_id, plan_id, due_on, status, sequence_number)
       VALUES ($1, $2, $3, '2026-11-27', 'COMPLETED', 2)`,
      [cycleId, organizationId, planId],
    );
    return { planId, organizationId, cycleId };
  }

  it.each([
    ['2026-11-27', '2026-10-27', 'MONTHS', '2026-12-27'],
    ['2026-10-27', '2026-10-27', 'MONTHS', '2026-11-27'],
    ['2026-10-27', '2026-11-03', 'MONTHS', '2026-12-03'],
    ['2027-01-31', '2026-12-31', 'MONTHS', '2027-02-28'],
    ['2028-01-31', '2027-12-31', 'MONTHS', '2028-02-29'],
    ['2028-02-29', '2028-02-28', 'YEARS', '2029-02-28'],
    ['2026-11-27', '2026-10-27', 'WEEKS', '2026-12-04'],
    ['2026-11-27', '2026-10-27', 'DAYS', '2026-11-28'],
  ])(
    'vencimento %s atendido em %s (%s) gera %s',
    async (due, performed, unit, expected) => {
      const { planId, organizationId, cycleId } = await seed();
      await db.query('UPDATE pmoc_executions SET due_on=$1 WHERE id=$2', [
        due,
        cycleId,
      ]);
      await db.query('UPDATE pmoc_plans SET frequency_unit=$1 WHERE id=$2', [
        unit,
        planId,
      ]);
      const sql = Prisma.sql`UPDATE pmoc_plans
      SET next_due_on=${nextPmocDueOnSql(new Date(`${performed}T12:00:00Z`), cycleId)}
      WHERE id=${planId}::uuid AND organization_id=${organizationId}::uuid
      RETURNING next_due_on::text`;
      const result = await db.query<{ next_due_on: string }>(
        sql.text,
        sql.values,
      );
      expect(result.rows[0]?.next_due_on).toBe(expected);
      // Prova que o índice único não suprime o novo ciclo após a antecipação.
      await db.query(
        `INSERT INTO pmoc_executions
       (id, organization_id, plan_id, due_on, status, sequence_number)
       SELECT $1, organization_id, id, next_due_on, 'PENDING', 3
       FROM pmoc_plans WHERE id=$2`,
        [randomUUID(), planId],
      );
      const pending = await db.query(
        `SELECT id FROM pmoc_executions WHERE plan_id=$1 AND status='PENDING'`,
        [planId],
      );
      expect(pending.rowCount).toBe(1);
    },
  );

  it('recupera os planos afetados, respeita vigência/estado e preserva histórico sem duplicar', async () => {
    const broken = await seed();
    const anotherOrganization = await seed();
    const ended = await seed();
    const suspended = await seed();
    const deleted = await seed();
    const healthy = await seed();
    await db.query(`UPDATE pmoc_plans SET ends_on='2026-11-30' WHERE id=$1`, [
      ended.planId,
    ]);
    await db.query(`UPDATE pmoc_plans SET status='SUSPENDED' WHERE id=$1`, [
      suspended.planId,
    ]);
    await db.query(`UPDATE pmoc_plans SET deleted_at=now() WHERE id=$1`, [
      deleted.planId,
    ]);
    await db.query(
      `INSERT INTO pmoc_executions
       (id, organization_id, plan_id, due_on, status, sequence_number)
       VALUES ($1, $2, $3, '2026-12-27', 'PENDING', 3)`,
      [randomUUID(), healthy.organizationId, healthy.planId],
    );
    const before = await db.query(
      `SELECT * FROM pmoc_executions WHERE status='COMPLETED' ORDER BY id`,
    );
    const migration = readFileSync(
      join(
        __dirname,
        '../prisma/migrations/20261027180000_pmoc_restore_next_execution/migration.sql',
      ),
      'utf8',
    );
    await db.query(migration);
    await db.query(migration);
    const pending = await db.query<{
      plan_id: string;
      organization_id: string;
      due_on: string;
      sequence_number: number;
    }>(
      `SELECT plan_id, organization_id, due_on::text, sequence_number FROM pmoc_executions WHERE status='PENDING'`,
    );
    expect(pending.rowCount).toBe(3);
    for (const plan of [broken, anotherOrganization, healthy]) {
      expect(pending.rows).toContainEqual({
        plan_id: plan.planId,
        organization_id: plan.organizationId,
        due_on: '2026-12-27',
        sequence_number: 3,
      });
    }
    const after = await db.query(
      `SELECT * FROM pmoc_executions WHERE status='COMPLETED' ORDER BY id`,
    );
    expect(after.rows).toEqual(before.rows);
  });
});
