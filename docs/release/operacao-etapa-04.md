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

## Gate de release em staging

Execute a sequência depois da aprovação da suíte Web. A medição usa o mesmo
staging, o mesmo túnel e o mesmo conjunto sintético nos dois momentos. Use 20
contas com tokens distintos, distribuídas por pelo menos duas organizações,
e um orçamento diferente por conta. Confira acesso ao orçamento e à sua
exportação. Use tokens que cubram o ensaio e renove-os antes da candidata
se necessário, mantendo organização, orçamento e ordem. Mantenha Stripe em
modo de teste ou desligado e desligue entregas externas no cenário.

### Publicação da branch e medição de referência

No Mac, na raiz do Orbit, publique a branch com os commits de teste e a
correção Web. Abra o túnel SSH antes de começar a janela de manutenção.

```bash
git merge-base --is-ancestor 02ba697f HEAD
git push origin HEAD:refs/heads/feat/features-and-backlogs
umask 077
export ORBIT_GATE_DIR=$(mktemp -d /private/tmp/orbit-gate.XXXXXX)
export ORBIT_STAGING_HOST=ninja@192.168.18.200
export ORBIT_BASE_SHA=$(git rev-parse 3a2c5418)
export ORBIT_CANDIDATE_SHA=$(git rev-parse HEAD)
ssh -fNT -M -S "$ORBIT_GATE_DIR/ssh-control" -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
  -L 127.0.0.1:16001:127.0.0.1:6001 "$ORBIT_STAGING_HOST"
curl -fsS http://127.0.0.1:16001/api/v1/release
```

Salve os atores em `$ORBIT_GATE_DIR/actors.json` com modo `600`. Use os
campos `organizationId`, `quoteId` e `token` em cada objeto do array. Use
apenas contas e documentos de teste. Os tokens ficam nesse diretório privado.

```bash
chmod 600 "$ORBIT_GATE_DIR/actors.json"
node --input-type=module - <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.ORBIT_GATE_DIR;
const actors = JSON.parse(readFileSync(join(dir, 'actors.json'), 'utf8'));
const profile = {
  environment: 'staging',
  dataset: 'orbit-release-gate',
  baseUrl: 'http://127.0.0.1:16001/api/v1',
  concurrency: [5, 10, 20],
  secondsPerStage: 60,
  actors,
};
const save = (file, config) =>
  writeFileSync(join(dir, file), JSON.stringify({ ...profile, ...config }), {
    mode: 0o600,
    flag: 'wx',
  });
save('baseline.json', {
  expectedCommit: process.env.ORBIT_BASE_SHA,
  poolMode: 'legacy-direct',
  expectCorrelation: false,
});
save('candidate.json', {
  expectedCommit: process.env.ORBIT_CANDIDATE_SHA,
  poolMode: 'pgbouncer',
  poolMetrics: join(dir, 'pool.json'),
});
JS
node scripts/qualify-staging-load.mjs "$ORBIT_GATE_DIR/baseline.json" \
  > "$ORBIT_GATE_DIR/baseline-result.json"
```

A referência `3a2c5418` usa PostgreSQL direto. O runner aceita métricas do
pool ausentes nessa revisão específica. O resultado deve ter `issues: []`
antes da promoção. Se o SHA do servidor já mudou, obtenha a referência em
uma cópia descartável da revisão antiga com o mesmo dataset e o mesmo
endereço de medição.

### Promoção da release candidata

Qualifique as migrations com o snapshot sanitizado conforme a seção anterior
e siga a preparação de senhas do [runbook do PgBouncer](rls-pgbouncer.md).
No Mac, a partir do mesmo diretório, use uma worktree limpa para publicar as
imagens com digests atestados no Docker Hub.

```bash
git worktree add --detach "$ORBIT_GATE_DIR/source" "$ORBIT_CANDIDATE_SHA"
(
  cd "$ORBIT_GATE_DIR/source"
  ORBIT_BUILD_BACKUP_IMAGE=false ORBIT_RELEASE_OUTPUT="$ORBIT_GATE_DIR/images" \
    bash deploy/staging/bin/build-push.sh
)
ssh "$ORBIT_STAGING_HOST" \
  'umask 077; mkdir -p ~/orbit-release-candidate ~/orbit-bootstrap/bin ~/orbit-bootstrap/nginx'
scp "$ORBIT_GATE_DIR/source/"{docker-compose.yml,docker-compose.staging.yml} \
  "$ORBIT_GATE_DIR/images/"{docker-compose.lock.yml,release.json} \
  "$ORBIT_STAGING_HOST:~/orbit-release-candidate/"
scp "$ORBIT_GATE_DIR/source/deploy/staging/bin/"{deploy.sh,deployment_preflight.py,collect-worker-observability.sh,worker-observability.py,activate-tls.sh,configure-proxy-origin.py} \
  "$ORBIT_STAGING_HOST:~/orbit-bootstrap/bin/"
scp "$ORBIT_GATE_DIR/source/deploy/staging/nginx/"{00-orbit-common.conf,proxy-common.inc,orbit-tls.conf} \
  "$ORBIT_STAGING_HOST:~/orbit-bootstrap/nginx/"
ssh -t "$ORBIT_STAGING_HOST"
```

No Ubuntu, edite `/opt/stacks/orbit/.env` no próprio host. Preserve as
credenciais existentes. Confirme `COMPOSE_PROFILES=hotpath`,
`REDIS_HOTPATH_ENABLED=true` e uma senha hexadecimal própria em
`REDIS_HOTPATH_PASSWORD`. Preencha `PGBOUNCER_STATS_PASSWORD` e as senhas
separadas de worker e documentos. Para a prova do Sentry, configure o DSN de
staging em `SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging` e uma chave aleatória
independente em `SENTRY_TENANT_HASH_KEY`. Gere valores novos com
`openssl rand -hex 32` no terminal privado. Mantenha a rotina de backup
em R2 reservada à produção, com `BACKUP_DATABASE_PASSWORD` vazio em staging.

Na janela de manutenção, verifique o pacote e interrompa os serviços antigos
antes das migrations. O migrador usa `DIRECT_DATABASE_URL` para a conexão
administrativa direta. O runtime novo entra pelo PgBouncer com papéis
restritos. Se o migrador falhar, mantenha a janela aberta e examine seus logs
antes de iniciar o runtime. Um rollback após as migrations exige conferir a
compatibilidade do schema com a revisão de destino.

```bash
set -euo pipefail
cd /opt/stacks/orbit
install -m 600 "$HOME/orbit-release-candidate/docker-compose.yml" docker-compose.yml
install -m 600 "$HOME/orbit-release-candidate/docker-compose.staging.yml" docker-compose.staging.yml
install -m 600 "$HOME/orbit-release-candidate/docker-compose.lock.yml" docker-compose.lock.yml
install -m 600 "$HOME/orbit-release-candidate/release.json" release.json
bash "$HOME/orbit-bootstrap/bin/deploy.sh" --check
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml -f docker-compose.staging.yml --profile hotpath)
"${compose[@]}" pull
sudo install -m 644 "$HOME/orbit-bootstrap/nginx/00-orbit-common.conf" /etc/nginx/conf.d/00-orbit-common.conf
sudo install -m 644 "$HOME/orbit-bootstrap/nginx/proxy-common.inc" /etc/nginx/orbit-proxy.inc
sudo bash "$HOME/orbit-bootstrap/bin/activate-tls.sh"
"${compose[@]}" stop frontend api worker documents
bash "$HOME/orbit-bootstrap/bin/deploy.sh"
"${compose[@]}" up -d --wait --wait-timeout 90 redis-hotpath
"${compose[@]}" ps --all api worker documents frontend migrate pgbouncer redis-hotpath
migration=$("${compose[@]}" ps --all --quiet migrate)
test "$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$migration")" = exited:0
"${compose[@]}" exec -T pgbouncer /usr/local/bin/orbit-pgbouncer healthcheck
"${compose[@]}" exec -T redis-hotpath sh -ec 'REDISCLI_AUTH="$REDIS_HOTPATH_PASSWORD" redis-cli -e ping'
curl -fsS http://127.0.0.1:6001/health/ready | python3 -c 'import json,sys; d=json.load(sys.stdin); p=d.get("data", d); assert p["status"]=="ok"; assert p["checks"]=={"postgres":"ok","jobs":"ok","redis":"ok"}; print(p["checks"])'
systemctl is-enabled orbit-backup.timer || true
systemctl is-active orbit-backup.timer || true
```

### Comparação de latência

Com os serviços saudáveis, inicie a coleta no Mac em outro terminal com as
mesmas variáveis `ORBIT_GATE_DIR` e `ORBIT_STAGING_HOST`. O stream usa
uma sessão SSH e cada gravação local substitui o arquivo de modo atômico.
Mantenha essa coleta rodando até o fechamento do ensaio.

```bash
umask 077
while IFS= read -r line; do
  printf '%s\n' "$line" > "$ORBIT_GATE_DIR/pool.next"
  mv "$ORBIT_GATE_DIR/pool.next" "$ORBIT_GATE_DIR/pool.json"
done < <(
  ssh -T "$ORBIT_STAGING_HOST" 'bash -se' <<'REMOTE'
while :; do
  status=0
  bash "$HOME/orbit-bootstrap/bin/collect-worker-observability.sh" || status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then exit "$status"; fi
  sleep 5
done
REMOTE
)
```

No terminal do gate, confirme a origem pública e rode a comparação após a
primeira amostra do pool. O runner valida o SHA, o dataset, o escopo por ator,
os documentos concluídos e a série do PgBouncer. Os relatórios trazem
p50, p95 e p99 de leituras, aceite da exportação e conclusão do documento.
A aprovação exige `issues: []`, seis ou mais amostras do pool a cada etapa
de 60 segundos, ausência de saturação sustentada e p95 de leituras e aceite
até 20% acima da referência. Encerre a coleta com Ctrl-C.

```bash
set -o pipefail
curl -fsS https://orbit.allblue-labs.com/api/v1/release
node scripts/qualify-staging-load.mjs "$ORBIT_GATE_DIR/candidate.json" \
  "$ORBIT_GATE_DIR/baseline-result.json" | tee "$ORBIT_GATE_DIR/candidate-result.json"
jq -s '
  .[0] as $base | .[1] as $candidate |
  [range(0; $candidate.results | length) as $i |
    ["reads", "enqueues", "exports"][] as $metric |
    {
      concorrencia: $candidate.results[$i].concurrency,
      metrica: $metric,
      referenciaMs: $base.results[$i][$metric],
      candidataMs: $candidate.results[$i][$metric],
      deltaP95Ms: ($candidate.results[$i][$metric].p95 - $base.results[$i][$metric].p95)
    }
  ]' "$ORBIT_GATE_DIR/baseline-result.json" "$ORBIT_GATE_DIR/candidate-result.json" \
  > "$ORBIT_GATE_DIR/comparativo.json"
```

### Evento real no Sentry

No Ubuntu, use o SDK e o filtro da própria imagem da API em um processo
avulso. O evento usa um tenant sintético e inclui valores de teste para
verificar a redação. O comando imprime somente IDs operacionais e a tag
esperada do tenant, calculada com HMAC. Use o DSN do projeto de staging.

```bash
cd /opt/stacks/orbit
docker compose exec -T api node - <<'JS'
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const sentry = require('@sentry/node');
const telemetry = require('./dist/src/observability/sentry.js');

async function main() {
  assert.equal(process.env.SENTRY_ENVIRONMENT, 'staging');
  assert.equal(process.env.ORBIT_PROCESS_ROLE, 'api');
  assert.ok(process.env.SENTRY_DSN?.trim());
  const key = process.env.SENTRY_TENANT_HASH_KEY;
  assert.ok(key?.trim());
  const requestId = randomUUID();
  const organizationId = randomUUID();
  const organizationTag = createHmac('sha256', key).update(organizationId).digest('hex').slice(0, 24);
  await telemetry.configureErrorReporting();
  sentry.setUser({ email: 'orbit-sentry-redaction@example.test' });
  sentry.addBreadcrumb({ message: 'orbit-redaction-check-token' });
  const error = new Error('orbit-sentry-redaction@example.test orbit-redaction-check-token');
  error.name = 'OrbitStagingReleaseGateError';
  telemetry.captureOrbitError(error, { requestId, organizationId });
  assert.ok(await sentry.flush(10_000), 'O SDK não terminou de enviar.');
  const eventId = sentry.lastEventId();
  assert.match(eventId ?? '', /^[a-f0-9]{32}$/);
  console.log(JSON.stringify({ eventId, correlationId: requestId, processRole: 'api', organizationTag }));
}
main().catch(() => { console.error('Falha na prova do Sentry.'); process.exitCode = 1; });
JS
```

No projeto de staging, abra **Issues**, filtre o ambiente `staging` e
pesquise por `correlationId:<ID>` com o valor impresso. Confira se o Event ID coincide e abra
os detalhes JSON do evento. Compare `organizationId` com `organizationTag`
e valide `processRole=api` e o `correlationId`. Procure os dois valores de
teste e verifique a ausência de usuário, corpo, cookies, cabeçalhos, anexos e
tokens. Guarde apenas o ID e o resultado da validação. Marque a issue de teste
como **Resolved** depois de conferir o recebimento. [Detalhes de eventos e issues do Sentry](https://docs.sentry.io/product/issues/issue-details/)

Encerre o túnel no Mac após registrar os resultados. Revogue os tokens de teste
e remova os arquivos de credenciais da pasta do gate quando não forem mais necessários.

```bash
ssh -S "$ORBIT_GATE_DIR/ssh-control" -O exit "$ORBIT_STAGING_HOST"
```
