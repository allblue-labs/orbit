/**
 * O migrador usa DIRECT_DATABASE_URL para reconciliar os papéis de runtime.
 * A fase bootstrap cria o papel base antes das migrations. A reconciliação
 * posterior confere tabelas com RLS forçada, catálogos somente leitura e as
 * assinaturas autorizadas de funções privilegiadas. API e consumidores
 * entram pelo PgBouncer com a própria DATABASE_URL.
 */
import { directDatabaseUrl } from './direct-database-url';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { runtimeDefinerFunctions } from './database-function-grants';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${key} is missing`);
  }
  return value;
};

/** `name` vem de variável de ambiente: citar é obrigatório, não estético. */
const quoteIdentifier = (name: string): string =>
  `"${name.replace(/"/g, '""')}"`;

const quoteLiteral = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

interface RoleAttributes {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
}

async function provision(): Promise<void> {
  const adminUrl = directDatabaseUrl();
  const appUser = required('APP_DATABASE_USER');
  const appPassword = required('APP_DATABASE_PASSWORD');

  if (appPassword.length < 12) {
    throw new Error(
      'APP_DATABASE_PASSWORD must contain at least 12 characters',
    );
  }

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    const database = (
      await admin.query<{ current_database: string }>(
        'SELECT current_database()',
      )
    ).rows[0]!.current_database;

    const role = quoteIdentifier(appUser);

    const existing = await admin.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = $1',
      [appUser],
    );

    if (existing.rowCount === 0) {
      await admin.query(
        `CREATE ROLE ${role} WITH LOGIN PASSWORD ${quoteLiteral(appPassword)}`,
      );
      console.log(`[provision] papel ${appUser} criado`);
    } else {
      await admin.query(
        `ALTER ROLE ${role} WITH LOGIN PASSWORD ${quoteLiteral(appPassword)}`,
      );
      console.log(`[provision] papel ${appUser} reconciliado`);
    }

    /**
     * Os atributos são reafirmados a cada execução.
     *
     * Se alguém conceder `SUPERUSER` para depurar um incidente e esquecer de
     * remover, o próximo deploy desfaz — que é exatamente o comportamento que
     * se quer de um invariante de segurança.
     */
    await admin.query(
      `ALTER ROLE ${role} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`,
    );

    await admin.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO ${role}`,
    );

    /**
     * Fresh databases need the role before migration 20260826180000, whose
     * GRANT statements intentionally name it. The migrator calls this narrow
     * phase first and performs the full grant reconciliation after every
     * migration has created its tables/functions.
     */
    if (process.env.DATABASE_ROLE_BOOTSTRAP_ONLY === 'true') {
      console.log(
        JSON.stringify({
          stage: 'database-role-bootstrapped',
          runtimeRole: appUser,
          rolsuper: false,
          rolbypassrls: false,
        }),
      );
      return;
    }

    await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);

    /**
     * DML, e só DML.
     *
     * Sem `TRUNCATE` (contorna gatilho e RLS de `DELETE`), sem `REFERENCES`,
     * sem `TRIGGER`, sem `CREATE` no schema. O runtime lê e escreve linhas; ele
     * não muda a forma do banco.
     */
    const tablesForRuntime = await admin.query<{
      table_name: string;
      scoped: boolean;
    }>(`
      SELECT c.relname AS table_name, c.relrowsecurity AND c.relforcerowsecurity AS scoped
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')`);
    for (const table of tablesForRuntime.rows) {
      const qualified = `public.${quoteIdentifier(table.table_name)}`;
      if (table.scoped) {
        await admin.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${qualified} TO ${role}`,
        );
      } else {
        await admin.query(
          `REVOKE ALL ON TABLE ${qualified} FROM PUBLIC, ${role}`,
        );
        if (['modules', 'pmoc_plan_name_options'].includes(table.table_name)) {
          await admin.query(`GRANT SELECT ON TABLE ${qualified} TO ${role}`);
        }
      }
    }
    await admin.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    );
    // Reconcile privileges by the effective signature, including on upgrades.
    await admin.query('BEGIN');
    await admin.query('SET LOCAL search_path = pg_catalog, public');
    const routines = await admin.query<{
      signature: string;
      definer: boolean;
      trigger: boolean;
    }>(`
      SELECT p.oid::regprocedure::text AS signature, p.prosecdef AS definer,
             p.prorettype IN ('trigger'::regtype,'event_trigger'::regtype) AS trigger
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f'`);
    for (const routine of routines.rows) {
      const scope = `FUNCTION ${routine.signature.startsWith('public.') ? routine.signature : `public.${routine.signature}`}`;
      if (routine.trigger || routine.definer) {
        await admin.query(`REVOKE EXECUTE ON ${scope} FROM PUBLIC, ${role}`);
      }
      if (
        !routine.trigger &&
        (!routine.definer || runtimeDefinerFunctions.has(routine.signature))
      ) {
        await admin.query(`GRANT EXECUTE ON ${scope} TO ${role}`);
      }
    }
    await admin.query(
      `REVOKE TEMPORARY ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC, ${role}`,
    );
    await admin.query('COMMIT');

    const combined =
      process.env.NODE_ENV !== 'production' &&
      process.env.DATABASE_ALLOW_COMBINED_ROLE === 'true';
    await admin.query(
      `${combined ? 'GRANT orbit_queue_worker TO' : 'REVOKE orbit_queue_worker FROM'} ${role}`,
    );
    for (const [workerName, passwordKey] of [
      ['orbit_worker', 'WORKER_DATABASE_PASSWORD'],
      ['orbit_documents', 'DOCUMENTS_DATABASE_PASSWORD'],
    ] as const) {
      const password = process.env[passwordKey]?.trim();
      if (!password && process.env.NODE_ENV !== 'production') continue;
      if (!password || password.length < 12 || password === appPassword) {
        throw new Error(
          `${passwordKey} must be a distinct password of at least 12 characters`,
        );
      }
      const worker = quoteIdentifier(workerName!);
      const { rowCount } = await admin.query(
        'SELECT 1 FROM pg_roles WHERE rolname=$1',
        [workerName],
      );
      if (!rowCount) await admin.query(`CREATE ROLE ${worker}`);
      await admin.query(
        `ALTER ROLE ${worker} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD ${quoteLiteral(password)}`,
      );
      await admin.query(`GRANT ${role}, orbit_queue_worker TO ${worker}`);
    }
    if (process.env.WORKER_DATABASE_PASSWORD) {
      await admin.query(
        'GRANT EXECUTE ON FUNCTION public.app_purge_expired_tenant_table(uuid,text) TO orbit_worker',
      );
    }
    if (combined) {
      await admin.query(
        `GRANT EXECUTE ON FUNCTION public.app_purge_expired_tenant_table(uuid,text) TO ${role}`,
      );
    }
    /** Cobre o que a próxima migration criar antes deste script rodar de novo. */
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${role}`,
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM ${role}`,
    );

    /**
     * A tabela de migrations fica fora do alcance do runtime.
     *
     * A aplicação nunca a lê nem escreve; deixá-la acessível só ofereceria uma
     * superfície a mais para quem chegasse com a credencial de runtime.
     */
    await admin.query(`REVOKE ALL ON TABLE _prisma_migrations FROM ${role}`);

    /**
     * Tabelas de memória: acrescidas, nunca apagadas.
     *
     * O `GRANT` amplo acima cobre estas como cobre todas as outras, e é por
     * isso que a exceção mora **aqui**, depois dele. Cada uma existe para
     * lembrar de algo que já aconteceu:
     *
     * - o razão de uso responde por que a cota foi consumida — corrigir um
     *   engano é evento novo, não linha reescrita;
     * - o registro de avaliação **é** o antifraude: apagá-lo devolveria um
     *   segundo período de teste a quem já usou o seu.
     *
     * Sem `DELETE`, um defeito na aplicação não tem como reescrever história.
     * `organization_subscriptions` também não aceita `DELETE`: o histórico de
     * assinaturas é preservado encerrando a linha, e não removendo-a.
     */
    for (const table of [
      'plan_usage_events',
      'subscription_trial_grants',
      'organization_subscriptions',
      'organization_legal_acceptances',
      'billing_customers',
      /**
       * A caixa de entrada guarda que um evento já foi processado. Apagá-la
       * devolveria o segundo efeito quando o provedor reentregar semanas
       * depois — que é exatamente o que ela existe para impedir.
       */
      'billing_webhook_events',
      'platform_tenant_provisionings',
      'email_outbound_messages',
      'email_provider_messages',
      'email_feedback_events',
      'email_suppressions',
    ]) {
      await admin.query(
        `DO $$
           BEGIN
             IF to_regclass('public.${table}') IS NOT NULL THEN
               EXECUTE 'REVOKE DELETE ON TABLE public.${table} FROM ${role}';
             END IF;
           END $$`,
      );
    }

    /** Razão de uso e comprovantes de aceite são somente acrescidos. */
    await admin.query(
      `DO $$
         BEGIN
           IF to_regclass('public.plan_usage_events') IS NOT NULL THEN
             EXECUTE 'REVOKE UPDATE ON TABLE public.plan_usage_events FROM ${role}';
           END IF;
           IF to_regclass('public.organization_legal_acceptances') IS NOT NULL THEN
             EXECUTE 'REVOKE UPDATE ON TABLE public.organization_legal_acceptances FROM ${role}';
           END IF;
         END $$`,
    );

    await admin.query(`DO $$ BEGIN
      IF to_regclass('public.account_document_registrations') IS NOT NULL THEN
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.account_document_registrations FROM ${role}';
      END IF;
    END $$`);

    await admin.query(`DO $$ BEGIN
      IF to_regclass('public.account_email_owners') IS NOT NULL THEN
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.account_email_owners FROM ${role}';
      END IF;
    END $$`);

    const attributes = (
      await admin.query<RoleAttributes>(
        'SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1',
        [appUser],
      )
    ).rows[0];

    if (!attributes) throw new Error(`Role ${appUser} disappeared mid-flight`);

    if (attributes.rolsuper || attributes.rolbypassrls) {
      throw new Error(
        `Role ${appUser} still bypasses RLS (rolsuper=${attributes.rolsuper}, rolbypassrls=${attributes.rolbypassrls})`,
      );
    }

    const tables = (
      await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM information_schema.table_privileges
         WHERE grantee = $1 AND table_schema = 'public' AND privilege_type = 'SELECT'`,
        [appUser],
      )
    ).rows[0]!.count;

    console.log(
      JSON.stringify({
        stage: 'database-roles-provisioned',
        database,
        runtimeRole: appUser,
        rolsuper: attributes.rolsuper,
        rolbypassrls: attributes.rolbypassrls,
        tablesGranted: Number(tables),
      }),
    );
  } finally {
    await admin.end();
  }
}

provision().catch((error: unknown) => {
  console.error(
    `[provision] falhou: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
