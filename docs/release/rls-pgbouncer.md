# Etapa 03 — RLS e PgBouncer

## Release

A imagem do PgBouncer é gerada na estação de build ou no CI. O Dockerfile verifica o SHA-256 do tarball upstream 1.26.1. O lock da release registra o digest da imagem publicada junto aos digests da API, dos consumers, do migrador e do frontend.

Antes de aplicar a release, qualifique o upgrade com o snapshot sanitizado de staging e preencha `APP_DATABASE_PASSWORD`, `WORKER_DATABASE_PASSWORD` e `DOCUMENTS_DATABASE_PASSWORD` com três senhas distintas compatíveis com URL. `openssl rand -hex 32` gera valores para as duas novas credenciais. O migrador cria e reconcilia os papéis usando `DIRECT_DATABASE_URL`. API, worker e documentos recebem somente a própria `DATABASE_URL`, com destino `pgbouncer:6432` e `pgbouncer=true`.

Atualize os scripts `deploy.sh` e `deployment_preflight.py` com o Compose e o lock da mesma release. Execute `deploy.sh --check` antes de colocar a stack no ar. Para a primeira aplicação destas migrations, reserve uma janela de manutenção e pare `api`, `worker` e `documents` antes de executar o deploy. Essas versões antigas acessam tabelas de identidade que passam a exigir contexto. A API da nova release depende do pooler saudável. O healthcheck usa uma consulta real com o papel restrito via SCRAM. PostgreSQL e PgBouncer ficam em redes internas e o frontend continua atrás da API.

Se o preflight das relações de exportação encontrar vínculos inconsistentes, a migration aborta com `DOCUMENT_EXPORT_SCOPE_PREFLIGHT_FAILED`. O erro não imprime identificadores. Investigue os vínculos no banco administrativo antes de tentar novamente. Os índices desta etapa usam `lock_timeout` de cinco segundos. Programe a atualização para uma janela de baixa atividade e confira a condição do migrador antes de reiniciar a API.

## Controles

- No banco qualificado, 161 das 164 tabelas em `public` têm `ENABLE` e `FORCE ROW LEVEL SECURITY`. `modules` e `pmoc_plan_name_options` são catálogos somente leitura para o runtime. `_prisma_migrations` é restrita ao migrador. O schema não contém views ou materialized views.
- O PostgreSQL aceita o sinal de consumo da fila apenas dos papéis que integram `orbit_queue_worker`. `orbit_app` fica fora desse grupo na stack. O modo combinado existe para os testes descartáveis.
- O provisionamento mantém os grants de tabelas condicionados a RLS forçada, com leitura explícita nos dois catálogos globais. Concede funções privilegiadas por assinatura e retira `EXECUTE` de gatilhos. Os resolvedores novos de identidade e a contagem de exports usam owners dedicados sem login.
- O contexto do tenant usa `set_config(..., true)` em uma transação. As chamadas que reutilizam uma transação ambiente precisam manter o mesmo contexto. A autorização de negócio continua vinculada à identidade estabelecida no NestJS.
- As referências de exportação preservam organização, unidade e vínculo com o arquivo produzido. Se uma unidade for excluída fisicamente, a exportação daquela unidade segue a remoção da unidade.

## Qualificação local

```sh
docker build -t orbit-pgbouncer:rls-test deploy/pgbouncer
node scripts/verify-pgbouncer.mjs
python3 scripts/test_deployment_preflight.py
```

O runner usa um banco novo, PostgreSQL em tmpfs e um PgBouncer separado. Para o teste de pressão ele reduz o pool do papel da API a quatro conexões de servidor, abre 256 clientes simultâneos e intercala consultas de duas instâncias do NestJS. As suítes verificam leitura e escrita entre organizações e unidades, ausência de contexto após commit e rollback, além de claims concorrentes de jobs.

Passaram 2.411 testes unitários e as 64 suítes E2E do backend, executadas em lotes. A validação do Compose com imagens de produção em banco descartável também passou, incluindo o migrador, a inicialização do pooler e dos consumers, o login web e mobile e a resolução de QR de equipamento.

`EXPLAIN (ANALYZE, BUFFERS)` no PostgreSQL 17 descartável, como `orbit_app`, comparou a segunda execução de cada consulta com e sem o índice. A consulta de exportações filtrou organização e unidade em 50 mil registros. A consulta de vínculo ativo filtrou usuário, ordenou por `joined_at, id` e selecionou o primeiro de 2 mil vínculos sintéticos.

| Consulta | Sem o índice novo | Com o índice novo |
|---|---:|---:|
| Exportações por unidade e organização | 4,59 ms | 0,15 ms |
| Primeiro vínculo ativo do usuário | 7,55 ms | 0,06 ms |

Na stack, os valores iniciais são 300 clientes, 16 conexões por banco/papel, quatro de reserva e 40 conexões de servidor por banco. A espera do pooler é de cinco segundos. A próxima qualificação em staging deve registrar filas de espera, duração de transações, uso de conexões e p95 das rotas. Confirme os índices com `EXPLAIN (ANALYZE, BUFFERS)` executado pelo papel restrito com volume representativo.
