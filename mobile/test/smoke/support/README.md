# Harness de cenários dos smokes

## A regra

> **Nenhuma suíte de smoke reaproveita registro operacional mutável de outra.**

Cada suíte pede o cenário de que precisa e recebe recursos criados agora, só
para ela.

## Por que isto existe

Antes, cada suíte procurava "algum atendimento em determinado estado" no tenant
compartilhado:

```dart
final operationId = page.data.firstOrNull?.navigationContext.sourceId;  // não
```

Funciona até a primeira suíte mudar o estado de que outra dependia. Foi o que
aconteceu: uma execução concluiu atendimentos para conseguir fontes documentais,
e **`COMPLETED` é terminal** — `operation-state-machine.ts` declara
`COMPLETED: []`, sem transição de saída. Três suítes pararam de rodar de uma vez,
e não havia caminho de produto para desfazer.

O problema nunca foi falta de dados. Era a dependência de registros mutáveis
compartilhados.

## Como usar

```dart
final provisioner = await ScenarioProvisioner.connect();

// Um atendimento em andamento, designado a este profissional.
final scenario = await provisioner.operation(suite: 'FL05');

// Concluído, para os gates documentais.
final done = await provisioner.operation(
  suite: 'FL07',
  state: ScenarioState.completed,
);

// Sem designação: existe, mas fora do escopo de campo deste ator.
final foreign = await provisioner.operation(
  suite: 'FL05SCOPE',
  state: ScenarioState.open,
  assignToActor: false,
);
```

O cenário devolve `scenarioId`, `operationId`, `workItemId`, `organizationId`,
`businessUnitId`, `userId`, `code` e a `version` publicada pelo servidor.

## Tudo pelo produto

```text
POST  /operations                                          criar
PATCH /operations/:id/responsible-field-technician          designar
POST  /mobile/field/operations/:id/commands/start           iniciar
POST  /mobile/field/operations/:id/commands/complete        concluir
```

Comandos semânticos, com envelope completo — os mesmos que o aplicativo usa.
**Nada de SQL, nada de `PATCH status`.** Um cenário montado por fora testaria uma
realidade que o domínio não produz.

A `version` de cada comando vem da preparação lida naquele instante, nunca de um
relógio local: quem define versão é o servidor.

## Guard de ambiente

Provisionar é escrever no banco de alguém. Duas barreiras **independentes**, e
ambas precisam passar:

1. `ORBIT_SMOKE_ENV` declarado como `development` ou `test`;
2. a API em loopback.

A declaração é o que autoriza; o loopback é reforço. Deduzir ambiente pelo
hostname sozinho seria frágil — um túnel para produção também atende em
`localhost`. Falha fechada: qualquer dúvida bloqueia, com a razão dita.

```bash
flutter test --dart-define=ORBIT_SMOKE_ENV=development
```

## Contrato do ambiente externo

Antes da suíte, a stack oficial precisa comprovar:

- PostgreSQL saudável, acessível pela API e sem migrations pendentes;
- API saudável em loopback;
- Storage configurado e persistente;
- worker da API ativo para renderização e tarefas assíncronas.

Com o provider `LOCAL`, `ORBIT_API_URL` e `STORAGE_LOCAL_PUBLIC_URL` precisam
publicar a **mesma porta do host**. A URL assinada é consumida pelo processo
Flutter no host, não de dentro do container. Por exemplo, quando o Compose
publica a API em `6001`:

```bash
STORAGE_LOCAL_PUBLIC_URL=http://127.0.0.1:6001/api/v1 \
  docker compose up -d --build postgres migrate api

flutter test \
  --dart-define=ORBIT_SMOKE_ENV=development \
  --dart-define=ORBIT_API_URL=http://127.0.0.1:6001/api/v1
```

O health da API deve responder antes do segundo comando. Ter container ou porta
aberta, isoladamente, não prova readiness. Nenhuma credencial deve ser passada
na linha de comando; o Compose continua consumindo o `.env` local. A divergência
histórica entre as portas `5432` e `5434` do PostgreSQL deve ser resolvida por
override efêmero quando aplicável, sem alterar o `.env` durante um closure gate.

## Isolamento e estados terminais

| suíte | cenário |
|---|---|
| FL-03 execução | um em andamento por teste |
| FL-04 assinatura | um em andamento por teste de aceite |
| FL-05 offline | um em andamento + um sem designação |
| FL-06 evidência | um em andamento + um dedicado ao limite de 20 |
| FL-07 documento | um concluído por gate |

Um cenário concluído **nunca** volta para uma suíte que precisa de andamento:
`ScenarioState.completed` é descartável por natureza.

## Identidade dos cenários

`scenarioId` é UUIDv7. O código do atendimento usa a **cauda aleatória**, não o
prefixo: os primeiros dígitos de um UUIDv7 são o carimbo de tempo, e dois
cenários criados no mesmo instante colidiriam num campo que é único. Isso
aconteceu, e o servidor recusou com "Operation code is already in use".

Os dados nascem reconhecíveis como teste:

```text
código: SMOKE-FL07-<12 hex>
título: [SMOKE-FL07] Cenário automatizado <12 hex>
```

## Falha no meio da provisão

`ScenarioProvisioningFailure` reporta o passo e os recursos já criados. Um
cenário parcial **não** é devolvido: reaproveitá-lo faria o teste medir um estado
que ninguém pediu.

## Limpeza

Não há. E é deliberado: o domínio preserva histórico, e não existe operação
segura de exclusão que não apague fato auditável. Inventar um rollback de
negócio para conveniência de teste seria pior do que o dado extra.

Cada execução cria de 1 a 8 atendimentos por suíte — hoje **20 ao todo** numa
rodada completa das cinco. São dados de desenvolvimento, marcados como smoke, e
crescem de forma previsível. Se o volume incomodar, a saída é reciclar o
ambiente, não deletar registros pelo banco.

## O que o harness não faz

- Não cria endpoint, botão, flag de debug ou caminho de reabertura.
- Não provisiona execução de PMOC ou RVT — criar uma só para preencher cobertura
  ultrapassaria o escopo, e a lacuna continua declarada.
- Não escreve no banco.
- Não reabre estado terminal.
