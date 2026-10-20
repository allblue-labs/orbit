# Orbit Operator — Mobile

Aplicativo de campo do Orbit Operations ERP. Flutter 3.44, Dart 3.12, Material 3
com tema próprio.

Consome **os endpoints reais do NestJS**. Nenhum mock, dado demo ou regra
inventada — o que não existe no backend está listado na seção 11.

Contratos compartilhados entre backend, web e mobile:
[`docs/orbit-contracts-manifest.md`](../docs/orbit-contracts-manifest.md).

---

## 1. Executar

```bash
cd mobile
flutter pub get

# Emulador Android / simulador iOS
make run-android
make run-ios

# Aparelho físico — só o arquivo local guarda o IP da sua máquina
cp config/local.example.json config/local.json   # primeira vez
make run-local

# Produção — copie, preencha um endpoint HTTPS real e mantenha local
cp config/production.example.json config/production.json
make build-android-prod
make build-ios-prod
```

A URL nunca é constante de código: chega por `--dart-define-from-file` e é lida em
`core/config/environment.dart`.

### Para onde apontar

| Alvo                            | `ORBIT_API_URL`                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Emulador Android                | `http://10.0.2.2:6001/api/v1` (o `localhost` da máquina, visto de dentro do emulador) |
| Simulador iOS                   | `http://localhost:6001/api/v1`                                                        |
| **Aparelho físico, mesma rede** | `http://<ip-da-máquina>:6001/api/v1`                                                  |

`config/local.json`, `config/staging.json` e `config/production.json` são
**ignorados pelo git**: IPs e destinos variam por máquina/ambiente. O que fica
versionado são presets de desenvolvimento e exemplos sem credenciais.

`config/local.json` contém somente URL e flavor — nunca token ou chave. O IP é da máquina de quem
desenvolve, não do projeto. O que está versionado é
`config/local.example.json`.

No VS Code, use as configurações `Orbit — Android Emulator`, `Orbit — iOS
Simulator` e `Orbit — aparelho físico/local`. No Android Studio, informe em
*Additional run args* o mesmo argumento do preset escolhido, por exemplo
`--dart-define-from-file=config/development.android.json`. Para iPhone físico,
selecione o device, mantenha-o na mesma rede da API e use `make run-local`;
somente `config/local.json` precisa mudar quando o IP do Mac mudar.

A API já escuta em `0.0.0.0` (`docker-compose.yml` publica
`0.0.0.0:${API_PORT}` e `main.ts` usa `HOST ?? '0.0.0.0'`), então não é preciso
mexer no backend — basta o aparelho estar na mesma rede e o firewall do macOS
liberar a porta.

**A porta é a publicada, não a interna.** O compose mapeia `${API_PORT}` para a
`5001` de dentro do container: é `${API_PORT}` que o aparelho enxerga. Confira
com `docker compose ps` antes de supor — apontar para a porta interna dá
"connection refused" e nenhuma mensagem no app que explique por quê.

### HTTP em rede local

Os dois sistemas bloqueiam HTTP em claro por padrão, e o bloqueio se manifesta
como falha de conexão genérica — vale saber onde está tratado:

| Sistema | Onde                                                                 | Alcance                                                   |
| ------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Android | `android/app/src/debug/` (manifesto + `network_security_config.xml`) | **só debug**; o APK de release continua exigindo HTTPS    |
| iOS     | `NSAllowsLocalNetworking` no `Info.plist`                            | só endereços de rede local; a internet continua sob HTTPS |

No iOS 14+ o sistema pede autorização de rede local na primeira chamada. Se
for negada, a permissão vive em _Ajustes › Orbit › Rede local_.

**Nada disso libera HTTP para a internet.** Não usamos
`NSAllowsArbitraryLoads` nem `usesCleartextTraffic` no manifesto principal.

---

## 2. Arquitetura

```
lib/
  app/providers.dart          composição de dependências (Riverpod)
  core/
    config/                   ambiente por --dart-define-from-file
    contracts/                espelho dos DTOs do backend
    errors/                   OrbitException
    location/                 GPS, coordenadas do atendimento, distância
    network/                  Dio + interceptors + renovação de sessão
    observability/            log sem dados sensíveis
    routing/                  GoRouter, shell canônico, guards
    storage/                  tokens (seguro) e cache de leitura
    theme/                    tema Orbit
    uploads/                  fila persistente de evidências
    widgets/                  marca, estados de seção, indicador de sincronismo
  features/
    authentication/  data · domain · application · presentation
    field/           Home operacional canônica, fila e execução
    operations/      data · application · presentation
    scheduling/      data · presentation
    profile/         presentation
```

Uma feature tem até quatro camadas, e o sentido é sempre o mesmo:

```
presentation (widgets)  →  application (providers)  →  data (repository)  →  core/network
```

**Widget nunca faz HTTP.** Ele observa um provider; o provider chama um
repository; o repository usa o cliente central. Isso é o que permite testar
regra sem árvore de widgets e trocar transporte sem tocar em tela.

### Fluxo de uma requisição

```
Repository
  → OrbitApiClient
    → RequestContextInterceptor   x-request-id, accept-language, x-timezone
    → AuthInterceptor             Bearer do secure storage; 401 → renova → repete
    → LoggingInterceptor          método, rota, status, duração, requestId
    → ErrorMappingInterceptor     DioException → OrbitException
  → NestJS
```

O `x-request-id` que o app gera é o mesmo que o `RequestIdInterceptor` do
backend registra: um erro no aparelho é rastreável no log do servidor.

---

## 3. Sessão e renovação

Tokens vivem **apenas** no `flutter_secure_storage` (Keychain /
EncryptedSharedPreferences). Nunca em `SharedPreferences`, nunca no cache de
leitura, nunca em log.

O backend **rotaciona o refresh token a cada uso**. Isso torna a corrida de
renovação um problema real: a Home dispara seis requisições em paralelo e, se
cada 401 disparasse o próprio refresh, a primeira rotacionaria o token e as
demais chegariam com um token já consumido — derrubando a sessão sem motivo.

`core/network/session_authenticator.dart` resolve com duas proteções:

1. **Chamada única em voo** — requisições concorrentes aguardam a mesma
   `Future` em vez de chamarem `/identity/refresh` cada uma.
2. **Janela de rotação (15 s)** — quem chega logo depois da rotação, ainda com o
   token antigo, recebe o par recém-emitido.

Coberto por teste: cinco 401 simultâneos → **uma** chamada ao backend.

Falha real de renovação limpa o armazenamento e emite `onExpired`; o
`AuthController` escuta e a navegação volta para o login.

### Restauração ao abrir

`restore()` lê as claims do token guardado e monta a sessão sem validar na
rede. Se o token estiver vencido, a primeira requisição dispara a renovação
pelo interceptor. O app abre rápido mesmo com rede ruim.

---

## 4. Perfis

O perfil é **derivado das permissões do backend**, não de configuração local.
Owner, Técnico em Campo e Responsável Técnico usam a mesma árvore visual e a
mesma navegação; permissões alteram dados e ações, nunca selecionam outra Home.

|                     | Todos os perfis autorizados                            |
| ------------------- | ------------------------------------------------------ |
| Aba 1               | Início                                                 |
| Home                | Dashboard operacional canônico de `/mobile/field/home` |
| Atendimentos        | Mesmo componente; projeção filtrada pelo backend       |
| Transição de status | Conforme permissão e `allowedActions`                  |

A interface esconde o que o backend recusaria (`PermissionGate`), mas **nunca
substitui a validação do servidor**.

---

## 5. Endpoints consumidos

| Endpoint                                  | Uso                                                  |
| ----------------------------------------- | ---------------------------------------------------- |
| `POST /identity/login`                    | autenticação (`client: MOBILE`)                      |
| `POST /identity/refresh`                  | renovação com rotação                                |
| `POST /identity/logout`                   | encerramento de sessão                               |
| `GET /identity/me`                        | perfil                                               |
| `GET /organizations/current`              | organização, plano e unidades                        |
| `GET /organizations/current/subscription` | capabilities e status da assinatura                  |
| `GET /operations`                         | listagem, filtros e contagens por status             |
| `GET /operations/:id`                     | detalhe (cliente, ativo, equipe, anexos, checklists) |
| `GET /operations/:id/timeline`            | linha do tempo                                       |
| `GET /operations/:id/history`             | auditoria                                            |
| `PATCH /operations/:id/status`            | transição de status                                  |
| `POST /operations/:id/attachments`        | envio de evidências (multipart, pela fila)           |
| `GET /checklist-executions?operationId=`  | checklists da operação                               |
| `GET /ai-executions?operationId=`         | assistência operacional                              |
| `GET /scheduling/agenda`                  | agenda do dia                                        |
| `GET /analytics/dashboard`                | KPIs do Owner                                        |
| `GET /notifications`                      | alertas não lidos                                    |

**Nenhuma métrica é calculada no app.** Onde há número, ou veio de um Read
Model do Analytics, ou é o `meta.total` que o backend devolveu ao contar a
própria consulta.

### Onde a autoridade fica

A máquina de estados da operação **não é replicada**. `OperationService.transitions`
é do backend; o app oferece as ações, envia a intenção e apresenta a recusa
quando ela vem — inclusive quando a transição é obviamente inválida. Reproduzir
a regra aqui criaria uma segunda fonte de verdade que diverge no primeiro
ajuste do servidor, e que fica desatualizada em cada aparelho até o usuário
atualizar o app.

Vale igual para o resto da execução em campo:

| Decisão                             | Quem decide                                                      |
| ----------------------------------- | ---------------------------------------------------------------- |
| Se a transição de status é válida   | backend (`transitions`)                                          |
| Se o usuário pode transicionar      | backend (`@Permissions`) — a UI só antecipa o que seria recusado |
| Se o anexo é aceito (tipo, tamanho) | backend — o app checa 20 MB só para não gastar rede à toa        |
| Se o plano cobre o recurso          | backend (`@Capabilities`, `@RequiresActivePlan`)                 |
| Se a operação pertence ao tenant    | backend (RLS)                                                    |
| Progresso do checklist              | backend                                                          |
| Ordem da listagem                   | backend                                                          |

O que é decidido no app é apresentação: o que cabe na tela, o que fica em
cache, quando reenviar um upload, quando ler o GPS.

---

## 6. Fila de uploads

Evidência capturada em campo não pode depender de rede no instante da captura.
A fila (`core/uploads/`) garante que o registro sobreviva a sinal fraco,
subsolo e ao fechamento do aplicativo.

```
captura (câmera / galeria / arquivos)
   → cópia para o diretório do app        ← o caminho original é temporário
   → UploadTask persistida em JSON
   → fila serial, uma por vez
   → POST /operations/:id/attachments     ← multipart, campo `file`, 20 MB
   → arquivo local apagado
```

### Decisões

**Cópia antes de enfileirar.** O caminho devolvido pela câmera aponta para um
arquivo temporário que o sistema pode remover. Sem a cópia, a fila encontraria
um arquivo inexistente na hora de enviar.

**Serial, não paralelo.** Em rede móvel, envios simultâneos reduzem a taxa de
sucesso e gastam mais bateria. Um por vez, na ordem de captura.

**Backoff exponencial** (5s, 10s, 20s, 40s…) para falhas recuperáveis: rede,
timeout, 5xx, 408 e 429.

**Falha definitiva não insiste.** 4xx que não seja 408/429 — 413 por tamanho,
403 por permissão, 400 por validação — para de tentar e pede ação. Repetir não
mudaria a resposta.

**Retomada por conexão.** A fila observa `connectivity_plus` e acorda quando a
rede volta. O sinal é uma dica, não prova: a confirmação continua sendo a
resposta do backend.

**"Enviando" vira "pendente" ao reabrir.** Se o app morreu no meio do envio,
não há confirmação — a tarefa é refeita.

**Progresso não vai para o disco.** Seria escrita a cada pacote; fica só em
memória, no fluxo que a interface observa.

### Estados

| Estado      | Significado                                   |
| ----------- | --------------------------------------------- |
| `pending`   | aguardando vez ou conexão                     |
| `uploading` | em envio, com progresso                       |
| `retrying`  | falhou de forma recuperável; espera o backoff |
| `completed` | aceita pelo backend                           |
| `failed`    | falha definitiva; exige ação                  |
| `cancelled` | cancelada pelo usuário                        |

O `SyncIndicator` no shell mostra o estado agregado — o técnico sabe, sem abrir
nada, se o que registrou já subiu.

**A fila só envia evidências.** Nenhuma mutação de operação é enfileirada:
evidência é acréscimo, mudança de status é decisão que exige validação do
servidor no momento em que acontece.

---

## 7. Offline

| Recurso             | Comportamento sem rede                  |
| ------------------- | --------------------------------------- |
| Lista de operações  | última página equivalente já consultada |
| Detalhe da operação | último detalhe visitado                 |
| Agenda              | último dia consultado                   |
| Evidências          | capturadas normalmente e enfileiradas   |
| Mudança de status   | **bloqueada** — exige rede              |

Regras:

- **403 não cai para o cache.** Recusa de acesso precisa ser vista, não
  mascarada por dado antigo.
- **Dado de cache é sempre datado.** O `StaleDataBanner` diz há quanto tempo
  foi salvo.
- **Nada sensível em cache.** Tokens só no armazenamento seguro.
- **Sem sincronização bidirecional.** Não há resolução de conflito porque não
  há escrita offline.

A interface `ReadCache` e o `UploadQueueStore` são os pontos de extensão para a
PR de sincronismo: trocar a implementação não muda quem os consome.

---

## 8. Localização

Infraestrutura apenas — **sem mapa e sem navegação**, conforme o escopo.

| Recurso                    | Situação                                           |
| -------------------------- | -------------------------------------------------- |
| Posição atual (GPS)        | ✓ `geolocator`, precisão média para poupar bateria |
| Coordenadas do atendimento | ✓ quando presentes em `Operation.location`         |
| Distância                  | ✓ linha reta (Haversine)                           |
| Tempo estimado             | **indisponível** — ver abaixo                      |

**Coordenadas.** `Operation.location` é `Json?` sem esquema no backend. O
extrator aceita as grafias usuais (`latitude`/`lat`, `longitude`/`lng`/`lon`,
aninhadas em `coordinates`/`geo`, números em texto com vírgula). Quando não
encontra, a tela diz que o atendimento não tem coordenadas — não estima.

**Tempo estimado** exige serviço de roteamento, com trânsito e malha viária.
Não existe no backend e não é escopo desta PR integrar um. Derivar da linha
reta seria número inventado apresentado como previsão. `estimatedTravelTime`
devolve `null` e a interface declara a ausência.

A leitura de GPS é `autoDispose`: só acontece enquanto a tela que a pede está
montada.

---

## 9. Assistência operacional

Origem: `GET /ai-executions?operationId=`. É o único caminho que o backend
oferece para IA ligada a uma operação.

`AiExecution.output` é JSON livre — o formato depende do agente e do `purpose`,
e o backend não publica esquema. O painel lê `summary`, `inconsistencies`,
`risks`, `alerts`, `recommendations` e `insights` **quando existem**, com
verificação em tempo de execução, e declara "formato não reconhecido" quando
não encontra nenhuma delas. Assumir estrutura quebraria no primeiro agente
diferente.

Sem a capability de IA no plano, o backend responde 403 e a seção mostra vazio
em vez de erro — é uma tela de execução, não um painel de diagnóstico.

**Nada é gerado no aplicativo.**

---

## 10. Qualidade

```bash
flutter analyze                    # sem issues
flutter test                       # 81 testes
flutter build apk --debug          # ok
flutter build ios --no-codesign    # ok
```

| Arquivo                      | O que garante                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `session_authenticator_test` | corrida de renovação, janela de rotação, expiração                                                       |
| `orbit_api_client_test`      | envelope, erros, request-id, token, 401 → refresh → repete                                               |
| `auth_controller_test`       | login, restauração, logout, perfis, admin sem tenant, troca de unidade                                   |
| `operations_repository_test` | contratos, filtros aceitos, cache offline, 403, conflito de transição                                    |
| `upload_queue_test`          | ordem serial, backoff, falha definitiva vs recuperável, cancelamento, persistência, retomada por conexão |
| `evidence_capture_test`      | cópia antes de enfileirar, tipo derivado do MIME, cancelamento da captura                                |
| `location_service_test`      | extração de coordenadas de JSON sem esquema, rejeição de valores inválidos, distância                    |
| `login_screen_test`          | validação, erro do backend, MFA sob demanda                                                              |
| `operations_screen_test`     | lista, vazio, offline, acesso negado, filtro                                                             |
| `field_actions_test`         | ações oferecidas, recusa do servidor apresentada, evidência pendente                                     |
| `orbit_logger_test`          | ausência de segredo em log                                                                               |

---

## 11. Ausente por falta de suporte no backend

Nada aqui foi contornado com mock.

### 11.1 Preencher checklist

`PATCH /checklist-executions/:id/answers`, `/complete` e `/cancel` existem. O
preenchimento exige um formulário dinâmico dirigido por
`templateSnapshot.items` (tipos, obrigatoriedade, opções) — trabalho de um
módulo próprio. O app **mostra** os checklists e o progresso calculado pelo
backend.

### 11.2 Ordenação da listagem

`OperationQueryDto` não aceita parâmetro de ordenação; o backend ordena por
`scheduledStart asc, createdAt desc`. Ordenar no cliente reordenaria apenas a
página atual e daria impressão falsa de ordem global — o controle não é
oferecido.

### 11.3 Atribuir técnico

`POST /operations/:id/assignments` exige um `userId`, mas não há endpoint que
liste os membros do tenant (`/identity/me` cobre só o próprio usuário,
`/platform-admin/users` é global e restrito ao administrador da plataforma).
Sem essa fonte, o campo seria um input de UUID cru. Falta no backend:
`GET /organizations/current/members` ou equivalente.

### 11.4 "Operações atrasadas" como métrica

Não existe filtro de atraso. O que existe é `scheduledTo`, que recorta pela
janela de agendamento. Combinado com `status=SCHEDULED`, o **servidor** conta o
que venceu — é o que o cartão "Prazo vencido" mostra. Um indicador de atraso
propriamente dito precisaria vir do Analytics.

### 11.5 Severidade de alertas

O modelo `Notification` tem `type` e `status`, não severidade. O app apresenta
o que existe e destaca o não lido, sem inventar gravidade.

### 11.6 Troca de organização

O backend deriva a organização das claims do token e não expõe endpoint para
listar as organizações do usuário nem para trocar a ativa. A troca de
**unidade** funciona (é filtro real das consultas); a de organização não foi
implementada.

### 11.7 Coordenadas do atendimento

`Operation.location` é `Json?` sem esquema. Só há distância quando o tenant
gravou algo que o extrator reconhece. Um contrato de endereço/coordenada no
backend resolveria — hoje é convenção, não garantia.

### 11.8 Tempo estimado de deslocamento

Exige serviço de roteamento, ausente no backend. Derivar da linha reta seria
número inventado. A interface declara a indisponibilidade.

### 11.9 Vídeo em campo

A captura aceita vídeo (o backend não restringe o MIME do anexo), mas **não há
compressão nem limite de duração no app**, e o limite de 20 MB do backend é
baixo para vídeo de câmera. Na prática só passam clipes curtos. Um contrato de
upload em partes, ou um limite próprio para vídeo, resolveria.

---

## 12. Identidade visual

O símbolo foi **extraído** da logomarca oficial (`orbit_logo.png`) por chave
cromática — o fundo cinza da fotografia é neutro (B−R ≈ 6) e todo o símbolo é
azul (B−R ≥ 44), o que permite separar sem redesenhar. O resultado está em
`assets/brand/orbit-symbol.png` e alimenta ícone, splash, tela de autenticação
e cabeçalho.

**Limitação conhecida:** o arquivo de origem é a fotografia de uma placa
luminosa, e o brilho está gravado nos próprios pixels da marca. Nenhum limiar
separa "brilho" de "geometria", porque ambos são azuis. Em tamanho de ícone o
halo aparece como um leve borrão ao redor do símbolo.

Para um ícone limpo é necessário o **arquivo original do símbolo** — SVG, ou
PNG com fundo transparente e sem o brilho. Basta substituir
`assets/brand/orbit-symbol.png` e regerar os ícones; é o único ponto de troca.

Paleta (`core/theme/orbit_theme.dart`): azul céu profundo `#0B162C`, gradiente
`#2F6BFF → #8B5CF6`, superfícies translúcidas, bordas suaves. Tema escuro por
padrão — o app é usado sob sol forte, onde o escuro tem melhor contraste, e os
alvos de toque respeitam 48dp por causa das luvas.

---

## 13. Adicionar uma feature nova

1. `lib/features/<nome>/` com `data/`, `application/`, `presentation/`.
2. **Contrato** em `core/contracts/` espelhando o DTO real do backend.
3. **Repository** em `data/`, usando `OrbitApiClient` — nunca Dio direto.
4. **Providers** em `application/`, um por leitura, para que cada seção
   recarregue sozinha.
5. **Telas** em `presentation/`, consumindo providers e usando `SectionCard`,
   `SectionLoading`, `SectionEmpty`, `SectionError`.
6. Registre o repository em `app/providers.dart` e a rota em
   `core/routing/orbit_router.dart`.
7. Ações restritas dentro de `PermissionGate`.
8. Testes: repository com `ScriptedAdapter`, tela com `ProviderScope`
   sobrescrevendo o repository.

O que **não** fazer: HTTP em widget, regra de negócio no app, token fora do
armazenamento seguro, número calculado localmente, máquina de estados
replicada do backend.

---

## 14. Decisões técnicas

**Sem `freezed`/`json_serializable`.** A stack os prevê "quando fizer sentido".
São ~15 classes de contrato, estáveis e simples; escrevê-las à mão mantém o
build sem `build_runner` e sem arquivos gerados no controle de versão. Se os
contratos crescerem, a migração é local aos arquivos de `core/contracts/`.

**Cliente HTTP separado para renovação e reexecução.** O `AuthInterceptor`
usaria a si mesmo ao repetir a requisição, entrando em recursão. Um segundo
`Dio` sem esse interceptor evita o laço — é por isso que `OrbitApiClient.create`
monta dois clientes.

**`QueuedInterceptor` no auth.** Serializa o tratamento de 401 dentro do Dio,
complementando a deduplicação do `SessionAuthenticator`.

**Fila de uploads em JSON, não em SQLite.** São dezenas de tarefas, não
milhares, sempre lidas por inteiro na abertura. Um banco traria migração de
esquema e uma dependência a mais para um problema que um arquivo resolve. Se a
fila passar a guardar histórico, a troca fica contida em `UploadQueueStore`.

**Fila JSON corrompida devolve vazio.** Uma escrita interrompida não pode
impedir o app de abrir. Perde-se a fila; não se perde o acesso ao trabalho.

**Captura atrás de uma interface (`EvidenceSource`).** `image_picker` e
`file_picker` exigem plataforma; a interface deixa o fluxo de captura testável
sem emulador e concentra num só lugar a mudança se o plugin for trocado.

**GPS com precisão média e `autoDispose`.** Precisão alta mantém o rádio
ligado e o app fica horas aberto na mão do técnico. Média basta para distância
aproximada, e a leitura acaba quando a tela sai.

**Sem análise de mídia no app.** Nada de OCR, detecção ou classificação da
evidência: seria regra de negócio nascendo no cliente. O app captura, envia e
mostra o que o backend devolve.
