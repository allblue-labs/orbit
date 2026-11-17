import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { manifest, migrationSql, scopeRules, violationSql } from './contract';
describe('Relational integrity contract', () => {
  it('keeps the reviewed migration reproducible from its manifest', () => {
    expect(
      readFileSync(
        resolve(
          __dirname,
          '../../../prisma/migrations/20261117100000_relational_tenant_integrity/migration.sql',
        ),
        'utf8',
      ),
    ).toBe(migrationSql());
  });
  it('classifies every baseline scoped scalar relation without weakening global identity', () => {
    expect(manifest.baselineForeignKeys).toHaveLength(455);
    for (const fk of manifest.baselineForeignKeys) {
      if (
        fk.child_org === null ||
        fk.parent_org === null ||
        fk.fields.length !== 1
      )
        continue;
      const covered =
        scopeRules.some(
          (rule) =>
            rule.table === fk.child &&
            rule.parent === fk.parent &&
            rule.column === fk.fields[0],
        ) ||
        manifest.existingComposite.some(
          (rule) =>
            rule.child === fk.child &&
            rule.parent === fk.parent &&
            rule.fields.includes(fk.fields[0]!),
        ) ||
        manifest.rebindableIdentityExceptions.some(
          (rule) =>
            rule.table === fk.child &&
            rule.parent === fk.parent &&
            rule.column === fk.fields[0],
        );
      expect(covered).toBe(true);
    }
    expect(manifest.identityRlsExceptions).toEqual([
      'sessions',
      'identity_invitations',
    ]);
  });
  it('uses bounded administrative preflight and validates all new FKs atomically', () => {
    const sql = migrationSql();
    expect(sql.startsWith('-- Generated')).toBe(true);
    expect(sql).toContain('SET LOCAL row_security=off');
    expect(sql).toContain("SET LOCAL lock_timeout = '10s'");
    expect(sql).toContain('SET NULL ("customer_id")');
    expect(sql).toContain(
      'SECURITY DEFINER SET search_path=pg_catalog SET row_security=off',
    );
    expect(sql).not.toMatch(
      /DELETE FROM|DISABLE ROW LEVEL|NO FORCE|UPDATE public\./,
    );
    expect(sql.endsWith('COMMIT;\n')).toBe(true);
    for (const rule of scopeRules.filter((r) => r.kind === 'composite'))
      expect(sql).toContain(`VALIDATE CONSTRAINT "${rule.name}"`);
  });
  it('reports rule/count only and retains nullable global parents as intentional', () => {
    const global = scopeRules.find((r) => r.kind === 'global-or-tenant')!;
    expect(violationSql(global)).toContain('p.organization_id IS NOT NULL AND');
    expect(violationSql(global)).not.toMatch(/SELECT c\.\*|SELECT p\.\*/);
  });
});
