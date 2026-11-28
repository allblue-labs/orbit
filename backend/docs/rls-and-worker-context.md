# RLS efetiva e contexto de worker (PR-26.6)

Como o Orbit isola inquilinos no banco, com que papel a aplicação conecta, e
como um job de fundo reabre o contexto correto.

Resolve os achados **A-01** e **A-02** da revisão arquitetural PR-26.5.

O documento registra a arquitetura da PR-26.6. As credenciais, permissões e
políticas atuais estão no [runbook da Etapa 03](../../docs/release/rls-pgbouncer.md).

---

## O problema, em uma frase cada

**A-02** — o papel do banco era o `POSTGRES_USER` do contêiner, isto é, um
superusuário. Superusuário tem `BYPASSRLS`. As 68 tabelas com
`FORCE ROW LEVEL SECURITY` nunca tiveram uma política avaliada; o isolamento
real era só o `WHERE organization_id` da aplicação.

**A-01** — o worker montava o escopo de unidade como
`job.businessUnitId ? [job.businessUnitId] : []`. Um relatório gerencial de
organização inteira não tem unidade, então abria contexto com
`app.business_unit_ids` vazio. Sob RLS de verdade, isso faz toda tabela
recortada por unidade devolver **zero linha** — e o relatório fecha `READY`,
com hash válido e números zerados. 299 dos 315 jobs de relatório no banco de
desenvolvimento estavam nessa condição.

Os dois são o mesmo problema visto de dois lados: o segundo só era invisível
porque o primeiro desligava a política que o revelaria.

---

## Os dois papéis

| | Papel | Variável | Faz |
|---|---|---|---|
| **Administrativo** | `POSTGRES_USER` (superusuário do contêiner) | `DATABASE_URL` | migrations, DDL, políticas, `GRANT`, provisionamento, scripts de seed |
| **Runtime** | `orbit_app` (padrão) | `APP_DATABASE_URL` | só DML, sujeito a toda política |

O papel de runtime é criado e **reconciliado a cada deploy** por
`src/scripts/provision-database-roles.ts`, que o serviço `migrate` do
`docker-compose` executa logo depois de `prisma migrate deploy`:

```
prisma migrate deploy && node dist/src/scripts/provision-database-roles.js
```

Os atributos são reafirmados em toda execução:

```sql
ALTER ROLE orbit_app WITH
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
```

Se alguém conceder `SUPERUSER` para depurar um incidente e esquecer de
remover, o próximo deploy desfaz.

### O que o runtime recebe, e o que não recebe

Recebe `SELECT, INSERT, UPDATE, DELETE` em todas as tabelas, `USAGE` no schema,
`EXECUTE` nas funções, e `ALTER DEFAULT PRIVILEGES` para cobrir a tabela que a
próxima migration criar.

**Não** recebe:

- posse de tabela — dono escapa de RLS em tabela sem `FORCE`, e essa dúvida não
  precisa existir;
- `TRUNCATE` — contorna gatilhos e a política de `DELETE`;
- `CREATE` no schema, `REFERENCES`, `TRIGGER`;
- acesso a `_prisma_migrations`, que a aplicação nunca lê.

### Provando em runtime

A aplicação pergunta ao Postgres, na subida, com que papel acabou de conectar:

```sql
SELECT current_user::text, rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname = current_user;
```

Com papel restrito, registra e segue. Com papel que contorna, avisa alto — e
com `DATABASE_ENFORCE_RESTRICTED_ROLE=true` (como no `docker-compose`) **recusa
subir**. É verificação de invariante, não decoração: `rolbypassrls` pode ser
concedido depois, fora do deploy.

### Migrar continua usando a credencial administrativa

`prisma.config.ts` lê `DATABASE_URL`. Nada muda para `prisma validate`,
`prisma generate` ou `prisma migrate` — eles precisam de DDL, e DDL é do
administrador. Só o `PrismaService` da aplicação prefere `APP_DATABASE_URL`.

---

## As classes de política

Levantadas do catálogo do banco, não da leitura das migrations:

| Classe | Predicado | Tabelas |
|---|---|---|
| **Organização** | `organization_id = app_current_organization_id()` | 40 — `customers`, `management_reports`, `pmoc_executions`, `storage_files`, `domain_events`, `background_jobs`… |
| **Unidade obrigatória** | organização **e** `business_unit_id = ANY(app_current_business_unit_ids())` | 17 — `operations`, `assets`, `quotes`, `financial_entries`, `inventory_movements`, `inventory_balances`, `artifact_executions`, `artifact_manifests`, `pmoc_plans`, `reports`… |
| **Unidade opcional** | organização e (`business_unit_id IS NULL` **ou** na lista) | 7 — `scheduling_events`, `notifications`, `contacts`, `products`, `audit_logs`… |
| **Herdada do pai** | `EXISTS` no agregado, que já é filtrado | `operation_users`, `operation_history`, `scheduling_recurrences`… |
| **Global, sem RLS** | — | `plans`, `modules`, `users`, `credentials`, `sessions`, `mfa_factors`, `password_reset_tokens`, `identity_invitations` |

A classe **unidade obrigatória** é a que A-01 atingia: escopo vazio, zero linha.

Nenhuma política existente precisou ser corrigida. A única alteração foi a de
`background_jobs`, descrita a seguir, e ela **acrescenta** um caminho em vez de
afrouxar os existentes.

> As tabelas de identidade sem RLS continuam sendo o achado **A-12** da revisão,
> e continuam dívida separada: elas participam do bootstrap de autenticação, que
> começa antes de existir contexto confiável. `IdentityRepository` já monta o
> contexto progressivamente (`app.user_id` → organização → unidades) e funciona
> sob o papel restrito sem alteração.

---

## Reivindicar um job

Aqui há um problema genuíno de ordem: descobrir de que organização é o próximo
job **é o objetivo** da consulta. Não dá para declarar o contexto antes de
saber qual é. E `background_jobs` isola por organização, então uma consulta sem
contexto passou a devolver zero linha com o papel restrito.

A saída é um predicado próprio:

```sql
CREATE FUNCTION app_is_job_worker() RETURNS boolean ...
  SELECT COALESCE(NULLIF(current_setting('app.job_worker', true), '')::boolean, false);
```

que aparece em **uma única política**, a de `background_jobs`:

```sql
USING (app_is_platform_admin() OR app_is_job_worker()
       OR organization_id = app_current_organization_id())
```

Três coisas o distinguem de elevação de privilégio:

1. não é `app_is_platform_admin()`, e não é concedido a ninguém — é um ajuste
   local à transação, declarado só por `BackgroundJobQueue`;
2. abre `background_jobs` e **nada mais**. Há teste que confirma: com
   `app.job_worker` ligado, `operations` e `customers` continuam em zero;
3. sai de cena no commit (`set_config(..., true)`).

**Enfileirar** não usa nada disso. Acontece dentro de uma requisição HTTP, ou de
um job já reaberto pelo worker — sempre há contexto —, então passa pela
política normal de organização.

| Operação | Contexto |
|---|---|
| `enqueue` (com ou sem transação do chamador) | tenant |
| `claim`, `requeueStalled`, `succeed`, `fail`, `find` | `app.job_worker` |
| execução do processador | tenant, reaberto do job |

---

## O escopo do job

`business_unit_id IS NULL` significava, ao mesmo tempo, "nenhuma unidade" e
"todas as unidades". Agora o job declara qual dos dois:

```ts
type JobScope =
  | { scope: 'BUSINESS_UNIT'; businessUnitId: string }
  | { scope: 'ORGANIZATION'; businessUnitIds: readonly string[] };
```

União discriminada: o estado ambíguo é **irrepresentável** em TypeScript. O
banco repete a regra, para que nem um `INSERT` cru consiga criá-lo:

```sql
CHECK (
  (scope = 'BUSINESS_UNIT'
   AND business_unit_id IS NOT NULL
   AND business_unit_ids = ARRAY[business_unit_id])
  OR (scope = 'ORGANIZATION' AND business_unit_id IS NULL)
)
```

### Onde as unidades são resolvidas, e por quê

**No enfileiramento**, a partir do escopo de quem pediu — não no worker.

Duas razões. A primeira é o impasse: consultar `business_units` para descobrir
as unidades da organização exige, pela própria política daquela tabela, já
saber quais unidades se pode ver. Resolver no worker seria pedir a chave que
está dentro do cofre.

A segunda é semântica, e é a mais importante: um relatório "da organização
inteira" cobre **as unidades que o solicitante podia ver**. Nem mais — senão o
motor de relatórios vira a maneira mais fácil de ler a filial à qual você não
tem acesso; nem menos. É a mesma decisão que o Management Reports já tomava
para `capabilities` e `permissions`: a autorização do pedido viaja com o
trabalho, em vez de ser recarregada quando o worker acorda.

### Classificação dos processadores

| Fila | Escopo | Origem da unidade |
|---|---|---|
| `artifact.render` | `UNIT_SCOPED` | `execution.businessUnitId` |
| `artifact.manifest.issued` | `UNIT_SCOPED` | unidade do manifesto |
| `quote.status.changed` | `UNIT_SCOPED` | unidade do orçamento |
| `pmoc.due-check` | `UNIT_SCOPED` | unidade do plano |
| `automation.dispatch` | herda | escopo de quem emitiu o evento de domínio |
| `automation.action` | herda | escopo do despacho que a gerou (`inheritScope`) |
| `management-report.generate` | `UNIT_SCOPED` **ou** `ORGANIZATION_SCOPED` | filial escolhida, ou unidades do solicitante |

Fan-out herda: um job filho nunca enxerga mais do que o pai enxergava.

### Escopo vazio falha, não compõe zeros

```
scope = ORGANIZATION, business_unit_ids = {}  ──▶  DEAD
```

Só um job legado — enfileirado antes desta PR — pode chegar nessa condição.
Enterrar é o comportamento correto: repetir não inventaria o escopo perdido, e
executar produziria zeros indistinguíveis de zeros verdadeiros. O erro fica
registrado em `last_error` e no log estruturado.

Nenhum job legado sem escopo estava `PENDING` quando a migration rodou: os 322
registros com `business_unit_id` nulo já eram `SUCCEEDED` ou `DEAD`.

### Observabilidade

O worker registra, por job, sem payload e sem segredo:

```json
{
  "queue": "management-report.generate",
  "jobId": "01a0…",
  "organizationId": "01a0…",
  "scope": "ORGANIZATION",
  "businessUnitIds": ["01a0…", "01a0…"],
  "correlationId": "bc0d…",
  "attempt": 1,
  "outcome": "SUCCEEDED",
  "durationMs": 412
}
```

Escopo vazio sai como `ERROR` com o motivo — nunca como execução silenciosa.

---

## Como isso é testado

`test/rls.e2e-spec.ts` — 16 verificações que **não passam pela aplicação**. Uma
conexão `pg` com a credencial de runtime, `set_config` reproduzindo o que a
`RlsTransaction` declara, e contagem de linhas. Nenhum `WHERE organization_id`
é escrito em lugar nenhum da suíte: quem filtra é a política.

| Classe | O que prova |
|---|---|
| Papel | `rolsuper = false`, `rolbypassrls = false` |
| Sem contexto | zero linha em `operations`, `customers`, `management_reports` |
| Organização | contexto de A não enxerga cliente de B, enxerga o próprio |
| Unidade | contexto em A1 vê 2 ordens; em A1+A2, vê 3 |
| Escopo vazio | zero — a reprodução direta de A-01 |
| Cross-tenant | declarar a unidade de B dentro do contexto de A não abre nada |
| Escrita | `INSERT` para outra organização e para unidade fora do escopo → `row-level security` |
| Worker | `app.job_worker` abre a fila; `operations` e `customers` seguem em zero |
| Job organizacional | relatório sem filial nasce `ORGANIZATION` com as duas unidades |
| **Regressão A-01** | snapshot de organização inteira soma as duas filiais (3, não 0) |
| Vizinho | o relatório de B mostra 1, e nenhuma das 3 de A |
| Legado | job `ORGANIZATION` com lista vazia termina `DEAD` |

As demais 126 verificações continuam existindo e passaram a valer mais: rodam
com o papel restrito, então provam a aplicação **e** a política. O que monta
cenário — criar filial, plantar job, inspecionar o vizinho — usa
`test/support/admin-prisma.ts`, um cliente administrativo separado. É ato de
fora do sistema; usá-lo para exercitar o produto provaria só que o
superusuário funciona, que era exatamente a ilusão anterior.

---

## Operação

### Subindo do zero

`docker compose up` basta. O serviço `migrate` aplica as migrations e provisiona
o papel; a API sobe apontando para ele. Só é preciso definir
`APP_DATABASE_PASSWORD` no `.env` — o compose recusa subir sem ela.

### Banco que já existe

```bash
npm run build
npm run provision:db-roles          # idempotente
# aponte APP_DATABASE_URL para o papel novo e reinicie a API
```

### Conferindo

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'orbit_app';
--  orbit_app | f | f
```

### Rotação de senha

Rode o provisionamento com a nova `APP_DATABASE_PASSWORD` — `ALTER ROLE` é
idempotente — e atualize `APP_DATABASE_URL`.

---

## O que esta PR deliberadamente não fez

Fora de escopo, com PR própria: fuso do Scheduling (A-03/A-04), escopo de
unidade em Automations (A-05), autorização composta em Analytics (A-06),
atomicidade da ativação de PMOC (A-09), retenção da fila (A-10), dead-letter
visível (A-11), RLS nas tabelas de identidade (A-12), limpeza de órfãos de
storage (A-07) e alinhamento do drift de schema (A-14).
