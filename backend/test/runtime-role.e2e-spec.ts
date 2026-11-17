import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { EnvironmentProvider } from '../src/providers';

/** Real PostgreSQL privileges, not a mock of pg_roles. Each role is disposable. */
describe('production runtime database role', () => {
  const role = `runtime_probe_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(32).toString('hex');
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  let db: PrismaService;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    const url = new URL(process.env.APP_DATABASE_URL!);
    url.username = role;
    url.password = password;
    const values: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      APP_DATABASE_URL: url.href,
      DATABASE_ENFORCE_RESTRICTED_ROLE: 'false',
    };
    const environment: EnvironmentProvider = {
      get: (key) => {
        if (!values[key]) throw new Error(`Missing ${key}`);
        return values[key];
      },
      getOptional: (key) => values[key],
    };
    db = new PrismaService(environment);
  });
  afterAll(async () => {
    await db?.$disconnect();
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });

  it('accepts a restricted role without an administrative URL', async () => {
    await expect(db.onModuleInit()).resolves.toBeUndefined();
  });
  it.each(['SUPERUSER', 'BYPASSRLS', 'CREATEDB', 'CREATEROLE', 'REPLICATION'])(
    'refuses %s before HTTP startup even when enforcement is disabled',
    async (attribute) => {
      await admin.query(`ALTER ROLE ${role} ${attribute}`);
      try {
        await expect(db.onModuleInit()).rejects.toThrow(
          'privilégios administrativos',
        );
      } finally {
        await admin.query(`ALTER ROLE ${role} NO${attribute}`);
      }
    },
  );
  it('refuses a privileged membership even with NOINHERIT', async () => {
    await admin.query(`ALTER ROLE ${role} NOINHERIT`);
    await admin.query(`GRANT pg_read_all_data TO ${role}`);
    try {
      await expect(db.onModuleInit()).rejects.toThrow('privileged_membership');
    } finally {
      await admin.query(`REVOKE pg_read_all_data FROM ${role}`);
      await admin.query(`ALTER ROLE ${role} INHERIT`);
    }
  });
  it('refuses ownership that would permit disabling table RLS', async () => {
    await admin.query(`CREATE TABLE public.runtime_probe (id integer)`);
    await admin.query(
      `ALTER TABLE public.runtime_probe ENABLE ROW LEVEL SECURITY`,
    );
    await admin.query(
      `ALTER TABLE public.runtime_probe FORCE ROW LEVEL SECURITY`,
    );
    await admin.query(`ALTER TABLE public.runtime_probe OWNER TO ${role}`);
    try {
      await expect(db.onModuleInit()).rejects.toThrow(
        'owns_application_objects',
      );
    } finally {
      await admin.query('DROP TABLE public.runtime_probe');
    }
  });
  it('restricted role cannot create roles or application tables', async () => {
    await expect(
      db.$executeRawUnsafe('CREATE ROLE forbidden_runtime_admin'),
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe(
        'CREATE TABLE public.forbidden_runtime_table(id integer)',
      ),
    ).rejects.toThrow();
    await expect(db.onModuleInit()).resolves.toBeUndefined();
  });
});
