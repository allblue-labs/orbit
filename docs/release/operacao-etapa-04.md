# Etapa 04 — Operação e resposta a incidentes

## Correlação e privacidade

A referência `X-Correlation-Id` acompanha o ingresso, o proxy, o NestJS e as
tarefas assíncronas. Web e Flutter também reconhecem `X-Request-Id`.
Em suporte, use a referência exibida na interface e localize a mesma
`correlationId` nos logs de API, worker e documentos. Jobs carregam a
referência original e uma retomada administrativa tem sua própria referência
na trilha de auditoria.

Os containers emitem JSON com horário UTC, nível, papel de execução,
identificadores autenticados e duração. Os eventos usam campos permitidos.
O log de borda usa caminhos normalizados. Os coletores recebem métricas
agregadas. Controles de acesso e retenção dos logs devem acompanhar a
sensibilidade dos identificadores internos.

O Sentry é opcional. Configure `SENTRY_DSN` para o backend, `SENTRY_WEB_DSN`
para o servidor Next.js e `SENTRY_ENVIRONMENT` por ambiente. Um
`SENTRY_TENANT_HASH_KEY` independente habilita a tag de organização
pseudonimizada no backend. Em build cliente, passe `NEXT_PUBLIC_SENTRY_DSN`
e `NEXT_PUBLIC_SENTRY_ENVIRONMENT`. No app, use os
`--dart-define=ORBIT_SENTRY_DSN=...` e
`--dart-define=ORBIT_SENTRY_ENVIRONMENT=...`. Habilite primeiro em ambiente
de teste e confira um erro sintético. O filtro envia tipo de erro, referência
e frames autorizados. A coleta mobile desta etapa cobre exceções Dart.
A captura nativa exige qualificação própria do filtro de privacidade.

## Saúde e métricas

- `GET /health/live` confirma que o processo HTTP consegue responder.
- `GET /health/ready` confere PostgreSQL via PgBouncer e acesso à fila.
  O campo Redis fica `degraded` durante fail-open e o HTTP segue em 200.
  Falha em banco ou fila retorna 503. As sondas são consultadas via loopback.
- Os consumers gravam snapshots por papel. O coletor registra pendentes
  totais, prontos para execução, em execução e mortos por grupo.
  A média de espera corresponde à idade dos jobs já elegíveis ainda na fila.

Defina uma senha exclusiva em `PGBOUNCER_STATS_PASSWORD`. Instale
`collect-worker-observability.sh` e `worker-observability.py` no mesmo
diretório no host de operação. O usuário `orbit_stats` lê o console do
pooler pela rede interna. O coletor retorna código 2 se houver alertas.
As unidades `orbit-observability.service` e `orbit-observability.timer`
executam a coleta periódica, persistem o histórico e atualizam
`/var/lib/orbit-monitor/latest.json`. Encaminhe falhas da unidade ao
canal operacional que a equipe monitora.

```sh
~/orbit-bootstrap/bin/collect-worker-observability.sh \
  --history /var/lib/orbit-monitor/worker.sqlite3
```

Ao investigar, confira primeiro o grupo, a idade da fila, os clientes em
espera no pool e a saúde do consumer. Uma onda de jobs agendados para depois
aumenta os pendentes sem aumentar a espera dos jobs prontos.

## DLQ interna

Use um canal privado para chegar ao loopback do backend. Com uma sessão de
administrador global, consulte `GET /api/v1/admin/jobs` com `group`,
`queue`, `organizationId`, `code`, `from`, `through`, `limit`
ou `after`. Os dados do job ficam limitados a campos operacionais.
O histórico de falhas começa a ser registrado após a migration.

Use `POST /api/v1/admin/jobs/:id/requeue` com a geração exibida no registro.

```json
{"generation":0}
```

Para um lote de até 30 jobs, use `POST /api/v1/admin/jobs/requeue`
com `{"items":[{"id":"UUID","generation":0}]}`. A mesma geração só
pode ser reaberta uma vez. Consulte o registro de auditoria com a referência
do pedido. Para `REQUIRES_REVIEW`, confira a fonte da falha e o estado do
objeto do provedor antes de decidir o próximo passo. A retomada de exportação
verifica expiração, arquivo existente e vínculo com o job. Filas fiscais
dependem de reconciliação do efeito no provedor antes de receberem replay.

Consulte `GET /api/v1/admin/email-outboxes?source=identity` ou
`source=contact`. Para falha definitiva recuperável, use
`POST /api/v1/admin/email-outboxes/:source/:id/requeue`. Há uma retomada
manual por registro. A entrega segue as verificações de expiração, destinatário
e supressão do worker. Para conteúdo descartado ou token vencido, oriente o
titular a solicitar nova verificação ou recuperação pelo fluxo do produto.
Falhas com aceitação incerta exigem confirmar o estado do SES.

## Qualificação de staging

Use apenas uma cópia sanitizada, com duas organizações e pelo menos dois
equipamentos em unidades diferentes dentro de uma delas. O script restaura
em PostgreSQL descartável, aplica a cadeia de migrations e verifica RLS e
os papéis do runtime.

```sh
scripts/qualify-staging.sh /caminho/restrito/orbit-sanitizado.dump dono_do_banco
```

Para latência, prepare tokens curtos de usuários sintéticos e orçamentos
distintos. O arquivo de configuração tem permissão 600. Use um ambiente
staging dedicado ou um túnel para o loopback da API. Mantenha os limites
usuais de Redis e deixe notificações/billing externos desligados no cenário.

```json
{
  "environment": "staging",
  "dataset": "qualificacao-orbit-01",
  "baseUrl": "http://127.0.0.1:6001/api/v1",
  "expectedCommit": "SHA_COMPLETO_DA_RELEASE",
  "concurrency": [5, 10, 20],
  "secondsPerStage": 60,
  "poolMetrics": "/caminho/restrito/orbit-worker-metrics.json",
  "actors": [
    {"organizationId":"UUID","quoteId":"UUID","token":"TOKEN_SINTETICO"}
  ]
}
```

Registre a referência com a release anterior e o mesmo dataset. Atualize
`poolMetrics` com amostras do coletor ao longo de cada medição. Rode a
candidata com o SHA correspondente.

```sh
node scripts/qualify-staging-load.mjs /cofre/teste-referencia.json > /tmp/orbit-referencia.json
node scripts/qualify-staging-load.mjs /cofre/teste-candidato.json /tmp/orbit-referencia.json
```

O resultado apresenta p50, p95 e p99 de leitura, aceite da exportação e
conclusão do documento. A comparação exige amostras do pool, nenhuma falha
inesperada, nenhum período sustentado de espera e p95 de leitura e enqueue
dentro de 20% sobre a referência. Teste a queda e o retorno do Redis no
ambiente descartável e confira `degraded`, latência e recuperação.
