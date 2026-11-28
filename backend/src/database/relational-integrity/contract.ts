import { rvtGuardsSql } from './rvt-guards';
import manifest from './rules.json';
export interface ScopeRule {
  name: string;
  table: string;
  column: string;
  parent: string;
  kind: string;
  unit: boolean;
  delete?: string;
  otherColumn?: string;
  otherParent?: string;
}
export const scopeRules: readonly ScopeRule[] = manifest.rules;
export { manifest };
export const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

/** Manifest identifiers are versioned source, never request/config input. */
export function violationSql(rule: ScopeRule): string {
  const left = `c.${quote(rule.column)} = p.id`;
  const mismatch =
    rule.kind === 'global-or-tenant'
      ? 'p.organization_id IS NOT NULL AND p.organization_id IS DISTINCT FROM c.organization_id'
      : 'p.organization_id IS DISTINCT FROM c.organization_id';
  if (rule.kind === 'junction')
    return `SELECT count(*)::text AS violations FROM public.${quote(rule.table)} c JOIN public.${quote(rule.parent)} p ON ${left} JOIN public.${quote(rule.otherParent!)} q ON c.${quote(rule.otherColumn!)}=q.id WHERE p.organization_id IS DISTINCT FROM q.organization_id`;
  return `SELECT count(*)::text AS violations FROM public.${quote(rule.table)} c LEFT JOIN public.${quote(rule.parent)} p ON ${left} WHERE c.${quote(rule.column)} IS NOT NULL ${rule.kind === 'composite' ? 'AND c.organization_id IS NOT NULL' : ''} AND (p.id IS NULL OR (${mismatch})${rule.unit ? ' OR c.business_unit_id IS DISTINCT FROM p.business_unit_id' : ''})`;
}

function uniqueIndexSql(
  table: string,
  columns: string[],
  suffix: string,
): string {
  const match = columns
    .map(
      (column, index) =>
        `i.indkey[${index}]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='${column}')`,
    )
    .join(' AND ');
  return `DO $index$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid='public.${table}'::regclass AND i.indisunique AND i.indisvalid AND i.indimmediate AND i.indnkeyatts=${columns.length} AND i.indpred IS NULL AND i.indexprs IS NULL AND ${match}) THEN CREATE UNIQUE INDEX ${quote('pr12_' + table + '_' + suffix + '_key')} ON public.${quote(table)} (${columns.map(quote).join(',')}); END IF; END $index$;`;
}

function lookupIndexSql(rule: ScopeRule, columns: string[]): string {
  const att = (name: string) =>
    `(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='${name}')`;
  const match = `(i.indkey[0]=${att(rule.column)} OR (i.indkey[0]=${att('organization_id')} AND i.indkey[1]=${att(rule.column)}))`;
  return `DO $lookup$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid='public.${rule.table}'::regclass AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND ${match}) THEN CREATE INDEX ${quote(rule.name + '_lookup')} ON public.${quote(rule.table)} (${columns.map(quote).join(',')}); END IF; END $lookup$;`;
}

export function migrationSql(): string {
  const sql = [
    "-- Generated from database/relational-integrity/rules.json. Do not hand-edit.\nBEGIN;\nSET LOCAL row_security=off;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '10min';",
  ];
  // Fail before DDL and data changes. Counts/identifiers only, never tenant values.
  for (const rule of scopeRules)
    sql.push(
      `DO $preflight$ BEGIN IF (${violationSql(rule).replace('SELECT count(*)::text AS violations', 'SELECT count(*)')} ) > 0 THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Relational integrity preflight failed: ${rule.name}'; END IF; END $preflight$;`,
    );
  const parents = [
    ...new Set(
      scopeRules.flatMap((r) => [
        r.parent,
        ...(r.otherParent ? [r.otherParent] : []),
      ]),
    ),
  ].sort();
  // An immutable tenant key also closes races for global/indirect guards under
  // REPEATABLE READ. Objects move by authorized create/copy, never reparenting.
  sql.push(
    `CREATE FUNCTION public.pr12_immutable_tenant() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Tenant ownership is immutable'; END IF; RETURN NEW; END $$;`,
  );
  for (const table of parents)
    sql.push(
      `CREATE TRIGGER pr12_immutable_tenant BEFORE UPDATE OF organization_id ON public.${quote(table)} FOR EACH ROW EXECUTE FUNCTION public.pr12_immutable_tenant();`,
    );
  const scopedParents = [
    ...new Set(
      scopeRules.filter((r) => r.kind === 'composite').map((r) => r.parent),
    ),
  ].sort();
  for (const table of scopedParents)
    sql.push(uniqueIndexSql(table, ['id', 'organization_id'], 'org'));

  for (const table of [
    ...new Set(scopeRules.filter((r) => r.unit).map((r) => r.parent)),
  ].sort())
    sql.push(
      uniqueIndexSql(
        table,
        ['id', 'organization_id', 'business_unit_id'],
        'unit',
      ),
    );
  for (const rule of scopeRules.filter((r) => r.kind === 'composite')) {
    const cols = [
      rule.column,
      'organization_id',
      ...(rule.unit ? ['business_unit_id'] : []),
    ];
    const targets = [
      'id',
      'organization_id',
      ...(rule.unit ? ['business_unit_id'] : []),
    ];
    const action = (
      {
        c: 'CASCADE',
        r: 'RESTRICT',
        a: 'NO ACTION',
        n: `SET NULL (${quote(rule.column)})`,
        d: 'SET DEFAULT',
      } as Record<string, string>
    )[rule.delete!];
    sql.push(
      `ALTER TABLE public.${quote(rule.table)} ADD CONSTRAINT ${quote(rule.name)} FOREIGN KEY (${cols.map(quote).join(',')}) REFERENCES public.${quote(rule.parent)} (${targets.map(quote).join(',')}) ON DELETE ${action} ON UPDATE RESTRICT NOT VALID;`,
    );
    sql.push(lookupIndexSql(rule, cols));
  }
  sql.push(`CREATE FUNCTION public.pr12_check_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
DECLARE parent_org uuid; other_org uuid; ref uuid; matched bigint;
BEGIN
  ref := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  IF ref IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT organization_id FROM public.%I WHERE id=$1 FOR KEY SHARE',TG_ARGV[0]) INTO parent_org USING ref;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched<>1 THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Related record scope is invalid',CONSTRAINT=TG_NAME; END IF;
  IF TG_ARGV[2]='global-or-tenant' THEN
    IF parent_org IS NOT NULL AND parent_org IS DISTINCT FROM (to_jsonb(NEW)->>'organization_id')::uuid THEN
      RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Related record scope is invalid',CONSTRAINT=TG_NAME;
    END IF;
  ELSE
    ref := (to_jsonb(NEW)->>TG_ARGV[4])::uuid;
    IF ref IS NULL THEN RETURN NEW; END IF;
    EXECUTE format('SELECT organization_id FROM public.%I WHERE id=$1 FOR KEY SHARE',TG_ARGV[3]) INTO other_org USING ref;
    GET DIAGNOSTICS matched = ROW_COUNT;
    IF matched<>1 THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Related record scope is invalid',CONSTRAINT=TG_NAME; END IF;
    IF parent_org IS DISTINCT FROM other_org THEN
      RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Related record scope is invalid',CONSTRAINT=TG_NAME;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pr12_check_scope() FROM PUBLIC;`);
  for (const rule of scopeRules.filter((r) => r.kind !== 'composite')) {
    const args = [
      rule.parent,
      rule.column,
      rule.kind,
      rule.otherParent ?? '',
      rule.otherColumn ?? '',
    ]
      .map((x) => `'${x}'`)
      .join(',');
    sql.push(
      `CREATE TRIGGER ${quote(rule.name)} BEFORE INSERT OR UPDATE ON public.${quote(rule.table)} FOR EACH ROW EXECUTE FUNCTION public.pr12_check_scope(${args});`,
    );
    sql.push(lookupIndexSql(rule, [rule.column]));
  }
  for (const rule of scopeRules.filter((r) => r.kind === 'composite'))
    sql.push(
      `ALTER TABLE public.${quote(rule.table)} VALIDATE CONSTRAINT ${quote(rule.name)};`,
    );
  sql.push(rvtGuardsSql);
  // Trigger guards have no VALIDATE CONSTRAINT; recheck after DDL has locked
  // writers to close the interval between the initial preflight and installation.
  for (const rule of scopeRules.filter((r) => r.kind !== 'composite'))
    sql.push(
      `DO $validate$ BEGIN IF (${violationSql(rule).replace('SELECT count(*)::text AS violations', 'SELECT count(*)')}) > 0 THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Relational integrity validation failed: ${rule.name}'; END IF; END $validate$;`,
    );
  sql.push(`DO $permissions$ DECLARE item record; BEGIN
    FOR item IN SELECT DISTINCT p.oid::regprocedure AS signature,r.rolname FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='public' AND p.proname IN ('pr12_check_scope','pr12_rvt_asset_scope','pr12_rvt_occurrence_assets') AND a.grantee<>p.proowner
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.signature,item.rolname); END LOOP;
  END $permissions$;`);
  sql.push('COMMIT;\n');
  return sql.join('\n');
}
