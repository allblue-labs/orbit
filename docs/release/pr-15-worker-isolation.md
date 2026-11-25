# PR-15 — Workers, storage e observabilidade

O Compose usa a mesma imagem de backend em três processos. O Nginx continua
encaminhando requisições somente para o serviço API.

| Serviço | Responsabilidade | Pool PostgreSQL por réplica |
| --- | --- | ---: |
| `api` | Requisições, autorização e enfileiramento | 20 |
| `worker` | Entrega e materialização de notificações, manutenção e demais filas | 6 |
| `documents` | Renderização de artefatos e composição de relatórios | 4 |

Cada processo tem seu pool e seu limite de CPU e memória. O worker geral
processa notificações separadamente das demais filas. Cada grupo reivindica
um job por vez, sem antecipar o claim de uma fila ocupada. O worker de
documentos processa um documento por vez. O orçamento nominal é de até 30
conexões para uma réplica de cada serviço. Some migrações, monitoramento e
outros clientes do banco antes de aumentar as réplicas. Configure os pools
com `DATABASE_POOL_MAX`, `WORKER_DATABASE_POOL_MAX` e
`DOCUMENTS_DATABASE_POOL_MAX`.

Os endpoints síncronos de PDFs gerados sob demanda continuam devolvendo
o arquivo na resposta. A API executa os renderizadores em threads sem
credenciais no ambiente, com até duas tarefas simultâneas e prazo de 30
segundos. Uma terceira solicitação recebe 503 enquanto os dois slots
estiverem ocupados. O código de renderização é o mesmo dos fluxos existentes.

O SDK S3 usa até duas tentativas e um prazo total de 20 segundos, incluindo
leitura do corpo. O cancelamento destrói o stream e libera o socket. Cada
processo admite até 16 operações simultâneas, incluindo até quatro leituras
internas com teto de 64 MiB por objeto. Downloads por URL assinada continuam
diretos do navegador ao storage. As escritas continuam condicionadas à
inexistência da chave, e downloads assinados preservam a política atual.

## Implantação

Gere o lock da release com o script de build. Ele fixa a mesma imagem por
digest em `api`, `worker` e `documents`. Atualize o Compose, o lock e os
scripts de preflight e deploy antes de usar `deploy.sh --check`. Para
qualificar a release, as duas filas precisam ter consumidores ativos e
readiness recente. São três processos com credencial restrita do banco.
PostgreSQL persiste os jobs existentes e continua sem porta pública.

O Compose aguarda a API saudável para subir os consumidores. Ao voltar a
uma versão anterior cujo HTTP também consumia jobs, pare `worker` e
`documents` antes de restaurar a API com o Compose anterior. Mantenha
`SUBSCRIPTION_DATA_RETENTION_ENABLED=false` no ambiente em que a pendência
externa da PR-13 ainda se aplica.

## Monitoramento

As linhas estruturadas `worker_queue_snapshot` registram profundidade por
estado, idade do job pronto mais antigo, memória RSS e p95 do event loop.
O cálculo exclui jobs cujo horário ainda não chegou. Os resultados e
latências de storage são registrados em `storage_request`, por provedor
e operação. O monitor também agrega os resultados de push por provedor.
O driver Docker `local` guarda os registros com rotação de
10 MiB e três arquivos por serviço. O PostgreSQL guarda o estado e as
tentativas da fila. O monitor pode guardar os agregados em SQLite no host por 30 dias,
preservando as séries após recriar containers.

Execute o monitor a cada minuto no host de implantação, com o lock ativo.
O código de saída 2 sinaliza alerta ao monitoramento. Use um diretório
persistente com acesso restrito para guardar o histórico.

```bash
set -o pipefail
docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml \
  logs --since 3m --no-color --no-log-prefix api worker documents \
  | python3 ~/orbit-bootstrap/bin/worker-observability.py --history /var/lib/orbit-monitor/worker.sqlite3
```

O monitor sinaliza snapshot ausente, dead letters, idade acima de um minuto
em notificações ou cinco minutos nas demais filas, e taxa de falhas de
storage de pelo menos 10% com cinco ou mais operações na janela. Timeout,
saturação e falha contam para a taxa. Ausência esperada de um objeto em
`HEAD` tem resultado `missing` separado.

## Dead letters

As tentativas em execução renovam o lease a cada 30 segundos. Após cinco
minutos sem renovação, o worker devolve a tentativa abandonada à fila ou
marca `DEAD` se o orçamento acabou. Operações de fechamento exigem o lease
original, o que impede uma tentativa antiga de alterar a linha retomada.
O job mantém o contexto do tenant. Processadores de documentos reaproveitam
resultados duráveis já emitidos no retry. Uma entrega externa que foi
aceita imediatamente antes da perda do recibo ainda pode ser repetida.
Use os recibos do provedor para investigar esse caso.

Use o comando dentro de um container da release com o mesmo papel restrito.
Os comandos de leitura exibem estado e códigos, sem payload do cliente.

```bash
docker compose exec -T worker node dist/src/scripts/inspect-job-queue.js snapshot
docker compose exec -T worker node dist/src/scripts/inspect-job-queue.js dead artifact.render
```

O reprocessamento usa a [API interna de DLQ](operacao-etapa-04.md#dlq-interna).

Após corrigir a causa, o replay permite uma tentativa adicional de artefato
ou relatório com falha transitória identificada ou lease expirado. Preserva
o mesmo job, escopo e contagem de tentativas. A operação recusa uma duplicata
em andamento ou um pedido mais recente com a mesma chave. Falhas permanentes
exigem corrigir os dados pelo fluxo de produto. Para push e outros efeitos
externos, confira o estado da entrega antes de pedir uma nova ação pelo
fluxo de origem.

## Validação

O ensaio com PostgreSQL descartável, quatro clientes HTTP concorrentes e oito
renderizações consecutivas mediu 566 respostas da rota de prontidão. O p95
foi de 13,28 ms. O maior p95 do event loop em janelas de 250 ms foi de
13,63 ms. A API atingiu 349 MiB de RSS e foram observadas oito conexões
dos três processos durante a espera do storage. O job de notificação
sintético terminou em 148 ms, durante o bloqueio do corpo da resposta do
storage. O cancelamento fechou esse corpo em 2,36 s com prazo de teste de
2,5 s. O ensaio também confirmou o PDF retornado pelo HTTP e o replay com
rejeição de escrita pelo lease antigo.

Passaram 34 testes direcionados em seis suítes, TypeScript, ESLint dos
arquivos alterados, os testes do preflight e a persistência dos alertas
em SQLite. O disco da VM Docker estava cheio e bloqueou o build local da
imagem. O gate do CI inclui o build e a subida dos dois novos containers.
O ensaio local usou o backend compilado e a entrega de push foi simulada.

[Registro do ensaio](evidence/pr-15-worker-isolation.json).
