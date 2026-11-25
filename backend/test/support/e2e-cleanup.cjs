const { Client } = require('pg');

/**
 * Isolamento entre execuções completas do E2E.
 *
 * As suítes criam tenants reais para provar RLS. Sem remover apenas esses
 * tenants, jobs e sessões de execuções anteriores passam a ser consumidos por
 * workers posteriores e o banco cresce indefinidamente no gate 10x.
 * O filtro é por prefixes de e-mail exclusivos dos fixtures — nunca por data,
 * nome genérico ou TRUNCATE — portanto dados de desenvolvimento ficam fora.
 */
module.exports = async function cleanupE2eTenants() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for E2E cleanup');
  }

  const url = new URL(connectionString);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^orbit_e2e_[a-f0-9]{16}$/.test(process.env.ORBIT_E2E_DATABASE ?? '') ||
    url.pathname.slice(1) !== process.env.ORBIT_E2E_DATABASE ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  ) {
    throw new Error(
      'E2E requires the disposable database runner: npm run test:e2e',
    );
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query(`
      SELECT id
        FROM users
       WHERE email ~ '^(fixture\\.|manifest\\.e2e\\.|render\\.e2e\\.|portal\\.e2e\\.|inv\\.|quotes\\.|conc\\.|financial\\.|rep\\.|rls\\.|auto\\.|pmoc\\.|professional\\.|evidence\\.|rvt\\.|qr\\.|assignment\\.|mobile\\.sign\\.|push\\.|offline\\.|mobile\\.field\\.|field\\.execution\\.|artifact\\.|analytics\\.|entitlements\\.|subscriptions\\.|billing\\.)'
         AND email LIKE '%@orbit.local'
    `);
    const ids = users.rows.map(({ id }) => id);
    if (ids.length > 0) {
      const organizations = await client.query(
        'SELECT id FROM organizations WHERE owner_user_id = ANY($1::uuid[])',
        [ids],
      );
      const organizationIds = organizations.rows.map(({ id }) => id);
      if (organizationIds.length > 0) {
        await client.query(
          'DELETE FROM customer_portal_password_resets WHERE organization_id = ANY($1::uuid[])',
          [organizationIds],
        );
        await client.query(
          'DELETE FROM customer_portal_invitations WHERE organization_id = ANY($1::uuid[])',
          [organizationIds],
        );
        await client.query(
          'DELETE FROM customer_portal_sessions WHERE organization_id = ANY($1::uuid[])',
          [organizationIds],
        );
        await client.query(
          'DELETE FROM customer_portal_identities WHERE organization_id = ANY($1::uuid[])',
          [organizationIds],
        );
      }
      await client.query(
        'DELETE FROM organizations WHERE owner_user_id = ANY($1::uuid[])',
        [ids],
      );
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
};
