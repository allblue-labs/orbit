import { OPERATIONAL_PURGE_TABLES, purgeOrder } from './purge-tables';
describe('exclusão operacional após prazo de retorno', () => {
  it('preserva conta, cobrança, consentimentos e memória antifraude', () => {
    for (const table of [
      'organization_subscriptions',
      'billing_invoices',
      'subscription_trial_grants',
      'organization_legal_acceptances',
      'organization_memberships',
      'roles',
      'storage_deletion_jobs',
    ])
      expect(OPERATIONAL_PURGE_TABLES as readonly string[]).not.toContain(
        table,
      );
    for (const table of [
      'customers',
      'assets',
      'operations',
      'field_evidence',
      'storage_files',
      'audit_logs',
      'customer_portal_sessions',
    ])
      expect(OPERATIONAL_PURGE_TABLES as readonly string[]).toContain(table);
  });
  it('remove dependências antes dos pais e ignora relações externas à operação', () => {
    expect(
      purgeOrder(
        ['customers', 'assets', 'operations'],
        [
          { child: 'assets', parent: 'customers' },
          { child: 'operations', parent: 'assets' },
          { child: 'operations', parent: 'business_units' },
        ],
      ),
    ).toEqual(['operations', 'assets', 'customers']);
  });
  it('recusa ciclo em vez de fazer exclusão parcial', () => {
    expect(() =>
      purgeOrder(
        ['a', 'b'],
        [
          { child: 'a', parent: 'b' },
          { child: 'b', parent: 'a' },
        ],
      ),
    ).toThrow('RETENTION_FOREIGN_KEY_CYCLE');
  });
});
