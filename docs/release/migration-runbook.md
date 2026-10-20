# Database migration runbook

## Política

Migrations são forward-only, versionadas e executadas por um papel
administrativo separado. A aplicação nunca roda DDL. Faça backup antes de toda
mudança e não use `db push`, `migrate reset` ou seed demo em produção.

## Preflight PMOC obrigatório

Execute com acesso administrativo e registre apenas a contagem:

```sql
SELECT count(*) AS active_without_coverage
FROM pmoc_plans p
WHERE p.status = 'ACTIVE'
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM pmoc_equipment_coverages c
    WHERE c.organization_id = p.organization_id
      AND c.plan_id = p.id
      AND c.deleted_at IS NULL
  );
```

Resultado diferente de zero bloqueia a migration PR-36. Classifique os IDs em
canal restrito. Fixtures podem ser removidas apenas pelo mecanismo de cleanup
do ambiente de teste. Dados reais exigem owner, equipamento correto, evidência
da decisão e reparo transacional; a migration não cria coverage fictícia.

## Fresh database

1. Suba um PostgreSQL isolado e vazio, sem volume reutilizado.
2. Configure uma credencial administrativa temporária e uma runtime distinta.
3. Execute o artefato migrator, que faz bootstrap do papel, `prisma migrate
   deploy`, reconciliação completa de grants e `seed-plan-catalog` idempotente.
4. Confirme que `ESSENTIAL`, `PROFESSIONAL`,
   `PROFESSIONAL_INTELLIGENCE` e `ENTERPRISE_UNLIMITED` existem ativos.
5. Confirme `npx prisma migrate status`: nenhuma migration pendente.
6. Rode os audits de RLS/role abaixo e o E2E global serial.
7. Descarte o ambiente efêmero somente após registrar resultados e verificar o
   alvo exato; nunca aponte cleanup para o banco de desenvolvimento/produção.

## Upgrade database

1. Restaure um backup representativo sanitizado ou use o ambiente de staging.
2. Rode o preflight PMOC e corrija somente dados classificados.
3. Registre migration atual com `npx prisma migrate status`.
4. Faça o backup de upgrade.
5. Execute `npx prisma migrate deploy` uma vez e repita para provar idempotência.
6. Provisione roles, confirme zero pending e rode os E2E/smokes.

## RLS e role audit

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = 'orbit_app';

SELECT schemaname, tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND (rowsecurity = false OR forcerowsecurity = false)
ORDER BY tablename;
```

O primeiro resultado deve ser `false/false`. A segunda consulta deve retornar
zero tabelas tenant-owned; tabelas globais deliberadas precisam estar
documentadas e não podem conter dados de cliente.

## Grants e SECURITY DEFINER

```sql
SELECT routine_schema, routine_name, security_type
FROM information_schema.routines
WHERE specific_schema = 'public' AND security_type = 'DEFINER';

SELECT n.nspname, p.proname, p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef;
```

Cada função definer deve ter `search_path` fixo, `PUBLIC EXECUTE=false`, input
tenant-safe e grants somente ao papel necessário. Verifique especificamente as
funções de trial, portal e ledger de usage. `plan_usage_ledger` não pode expor
escrita arbitrária ao runtime fora das funções autorizadas.

## Invariante PR-36

A migration `20260914120000_pr36_active_pmoc_coverage_guard` faz preflight e
instala constraint triggers diferidos. A migration corretiva
`20260914160000_pr36_pmoc_coverage_trigger_fix` separa as funções por tipo de
linha para evitar cache incompatível de `NEW`/`OLD` no PL/pgSQL. Isso permite
criar coverage e ativar o plano na mesma transação, mas impede commit de PMOC
`ACTIVE` vazio e remoção da última coverage. A aplicação também valida antes
da leitura/mutação para erro público claro; o banco é a defesa final.
