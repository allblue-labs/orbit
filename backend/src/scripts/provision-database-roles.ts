/**
 * Cria e reconcilia o papel de **runtime** do Orbit.
 *
 * ## Por que existe
 *
 * O papel que o `docker-compose` cria é o superusuário do contêiner: o
 * `POSTGRES_USER` do `postgres:17-alpine` nasce com `SUPERUSER` e, portanto,
 * com `BYPASSRLS`. Enquanto a aplicação conectar com ele, as 68 tabelas com
 * `FORCE ROW LEVEL SECURITY` são decorativas — nenhuma política é avaliada, e
 * o isolamento que funciona é só o da camada de aplicação.
 *
 * Este script separa os dois papéis:
 *
 * - **administrativo** (`DATABASE_URL`) — dono do schema, roda migrations, DDL
 *   e este próprio provisionamento;
 * - **runtime** (`APP_DATABASE_URL`) — `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`,
 *   sem `CREATEDB`/`CREATEROLE`, sem posse de tabela. Só DML, e sujeito a toda
 *   política.
 *
 * ## Idempotente de propósito
 *
 * Roda a cada `docker compose up` logo depois do `prisma migrate deploy`, e
 * pode rodar mil vezes: cria o papel se faltar, reajusta atributos e senha,
 * concede o que ainda não foi concedido. É assim que uma tabela nova, criada
 * pela migration da semana que vem, ganha os `GRANT`s sem passo manual — e o
 * `ALTER DEFAULT PRIVILEGES` cobre o intervalo até a próxima execução.
 *
 * ## O que ele deliberadamente não faz
 *
 * Não transfere posse de tabela para o papel de runtime. Dono de tabela escapa
 * de RLS quando a tabela não tem `FORCE`; deixar a posse com o administrador
 * remove essa dúvida inteira.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';

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
  const adminUrl = required('DATABASE_URL');
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
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    await admin.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    );
    await admin.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`,
    );

    /** Cobre o que a próxima migration criar antes deste script rodar de novo. */
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
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
      'billing_customers',
      /**
       * A caixa de entrada guarda que um evento já foi processado. Apagá-la
       * devolveria o segundo efeito quando o provedor reentregar semanas
       * depois — que é exatamente o que ela existe para impedir.
       */
      'billing_webhook_events',
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

    /** O razão de uso não é corrigido nem por `UPDATE`: só acrescido. */
    await admin.query(
      `DO $$
         BEGIN
           IF to_regclass('public.plan_usage_events') IS NOT NULL THEN
             EXECUTE 'REVOKE UPDATE ON TABLE public.plan_usage_events FROM ${role}';
           END IF;
         END $$`,
    );

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
