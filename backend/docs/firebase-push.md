# Push transacional com Firebase Admin

O `NotificationsModule` exporta `PushNotificationService`. A implementação usa o
SDK oficial `firebase-admin` 14.5, Node 22 e a fila PostgreSQL já existente no Orbit.
O backend envia automaticamente; não é necessário cadastrar campanhas nem operar
um gateway externo. A ativação inicial das APIs, identidade de serviço e apps
no Firebase/Google Cloud continua necessária.

## Ambiente e credenciais

Configure apenas na API/worker, nunca no frontend ou dentro do app:

```dotenv
PUSH_PROVIDER=firebase
FIREBASE_PROJECT_ID=seu-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@seu-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nCONTEUDO_DA_CHAVE\n-----END PRIVATE KEY-----\n"
JOBS_WORKER_ENABLED=true
JOBS_POLL_INTERVAL_MS=2000
```

No JSON da service account, copie `project_id`, `client_email` e `private_key`
para os três campos correspondentes. Os slots adicionados ao `.env` local estão
vazios; valores preexistentes foram preservados. O JSON privado não é lido pelo
código e não deve ser salvo no repositório, enviado ao navegador ou embutido no
APK/IPA. `google-services.json` e `GoogleService-Info.plist` são configurações de
cliente distintas; não são a chave privada da conta de serviço.

A chave aceita quebras de linha reais ou `\n` literais entre aspas. O serviço
normaliza o PEM e valida sua estrutura RSA sem registrar conteúdo. `cert(...)`
recebe os campos explicitamente; não há fallback para arquivos/ADC/metadata.
O app Firebase é inicializado uma vez por provider e liberado no encerramento.
Com `PUSH_PROVIDER=firebase`, campos ausentes ou malformados impedem o boot,
com mensagem que cita somente o nome da configuração. Use `disabled` enquanto
prepara as credenciais; a caixa de notificações continua funcionando.

No Firebase Console → configurações do projeto → **Service accounts**, gere a
chave da conta de serviço. No Google Cloud do mesmo projeto, habilite **Firebase
Cloud Messaging API** e conceda à conta **Firebase Cloud Messaging API Admin**
(`roles/firebasecloudmessaging.admin`), ou um papel personalizado com a permissão
`cloudmessaging.messages.create`, evitando papéis amplos como Owner.
Os tokens precisam pertencer ao projeto configurado. Recrie a API para aplicar
as variáveis; o Compose já as repassa exclusivamente ao backend.

## Uso por eventos do sistema

Injete `PushNotificationService` em um serviço de negócio de um módulo que importe
`NotificationsModule`. Após autorizar a ação e confirmar a gravação do atendimento:

```ts
const result = await this.push.sendToUser(
  technicianId,
  'Novo atendimento atribuído',
  'Abra o Orbit para consultar os detalhes.',
  {
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
    tipo: 'atendimento_atribuido',
    deepLink: `/field/work-items/SERVICE_OPERATION:${operationId}`,
    url: 'https://orbit.allblue-labs.com',
  },
);
// QUEUED = persistido para processamento; não significa recebido pelo aparelho.
// FAILED = falha ao persistir; o chamador pode registrar/retentar seu evento.
```

As atribuições de operações e PMOC que já chamam `MobileNotificationService`
passam a usar Firebase automaticamente, sem acrescentar um segundo disparo.
Esses eventos mantêm chaves de deduplicação do fato de negócio. A atribuição
PMOC é revalidada pelo ciclo/equipamento, inclusive auxiliares, cancelamento e
autorização vigente; operações comuns também revalidam autorização e atribuição.

Cada chamada genérica de `sendToUser` é uma nova notificação. Para eventos que
exigem idempotência por fato, continue usando `MobileNotificationService` com um
`factId` estável. O envio é permitido no escopo atual ao próprio destinatário,
a quem possui `notifications.create` ou a um worker interno `SYSTEM`.
Não foi criado um endpoint público de disparo. Sem contexto de organização,
o serviço recusa a chamada; tarefas externas devem criar um job com tenant,
destinatário e escopo explícitos, como os processadores existentes fazem.

O método persiste o conteúdo antes de disparar: a fila restaura o contexto do
destinatário, verifica membership e preferências, busca **todas** as instalações
ativas desse usuário/organização e cria uma entrega por aparelho. A aceitação de
um aparelho não é repetida quando outro falha. Falhas temporárias têm backoff e
até cinco tentativas pelo worker. Não há garantia de exactly-once: uma queda
entre aceitação pelo FCM e gravação do resultado pode produzir duplicidade.

## Payload e navegação

`dataPayload` aceita somente strings, no máximo 30 campos, e limite conservador
de 3.000 bytes para título/corpo/dados. O SDK recebe `data` com os campos enviados,
`click_action` padrão e campos de controle gerados no servidor: `version`,
`notificationId`, `organizationId`, `recipientUserId`, `tenantId`, `eventType`, `title`, `body` e
`deepLink`. O cliente não pode substituir campos de identidade. `type` customizado
é preservado; sem ele recebe o tipo do evento. URLs devem usar HTTPS, sem
credenciais; caminhos internos ficam sob `/field/`.

No Android a mensagem contém **notification + data**: em background, o SDK mostra
o aviso; em foreground, o receiver nativo o apresenta uma vez. Ambos preservam
o destino e os metadados do destinatário no toque. O app compara usuário e tenant
com a sessão atual antes de navegar; relê os detalhes com autenticação.
O campo `url` externo é entregue no payload, mas sua abertura exige suporte
explícito no app, com validação dos domínios permitidos para a marca.

Não envie dados pessoais, tokens de acesso, valores ou links de assinatura pelo
push: notificações podem aparecer na tela bloqueada. Use o link para a API
autenticada reler as informações com RLS/RBAC.

## Tokens, multi-tenant e white-label

O schema existente já atende o registro; nenhuma nova tabela/migração é necessária:

| Campo em `MobileDeviceInstallation` | Papel |
| --- | --- |
| `organizationId` | Tenant/loja/empresa, obtido da sessão |
| `userId` | Destinatário autenticado |
| `deviceInstanceId` | Device ID aleatório da instalação |
| `pushProvider` | `FCM` para tokens enviados pelo Firebase |
| `pushToken` / `pushTokenHash` | Token necessário ao envio / hash de comparação |
| `enabled` / `revokedAt` | Elegibilidade e revogação |
| `tokenUpdatedAt` / `lastSeenAt` | Rotação e último registro |

O app usa `POST /api/v1/mobile/devices` após login/renovação do token e
`DELETE /api/v1/mobile/devices/:deviceInstanceId` no logout. Não envia tenant ou
userId no corpo: ambos vêm da sessão. A função de registro serializa a troca de
conta e revoga o vínculo anterior. Tokens não aparecem nos read models públicos.

As tabelas de instalações e entregas têm RLS forçada. Não há envio por tópico
global de tenant. `userId` sozinho jamais seleciona tokens de outras organizações.
O worker revalida o vínculo usuário/tenant/dispositivo antes do envio. O projeto
Firebase é configuração do deploy, não algo escolhido no `dataPayload`.

Este deploy usa um projeto Firebase para o app Orbit, compartilhado entre tenants
com isolamento no banco. Marcas com apps/projetos Firebase separados devem usar
deploys com credenciais correspondentes ou implementar um mapeamento explícito
marca → projeto no servidor. Não tente enviar o token de outra marca/projeto;
`mismatched-credential` não invalida o token.

## Limpeza e erros

- `messaging/registration-token-not-registered` e `messaging/invalid-registration-token`:
  a entrega termina como `INVALID_TOKEN`; somente a instalação e o hash exato que
  falharam são desativados, na mesma transação do resultado. Um token renovado
  enquanto a requisição estava em trânsito permanece ativo.
- `invalid-argument`, payload incorreto, projeto/credencial incompatível ou
  autenticação APNs inválida: falha permanente de entrega, **sem excluir tokens**.
- Falhas transitórias de rede, disponibilidade ou quota: tentativa registrada e
  retry limitado. A falha do Firebase não desfaz o atendimento.
- Logs registram códigos conhecidos, resultado e metadados operacionais, nunca
  token, chave privada, corpo, URL ou erro bruto do Firebase.

## Configuração dos aplicativos e validação real

Android: registre `com.allbluelabs.orbit` no mesmo projeto, coloque a configuração
de cliente em `mobile/android/app/google-services.json`, gere uma nova build e
autorize notificações. A chave privada do backend nunca vai nesse arquivo.

**iPhone:** o SDK Firebase Messaging foi integrado via Swift Package Manager.
A ponte associa APNs ao FCM e registra somente FCM no backend. Configurar o app
`com.allbluelabs.orbit`, chave APNs no Firebase e provisioning com push.
Builds de distribuição validam o arquivo cliente, projeto e entitlement; Personal
Team permanece disponível por opt-out local explícito, sem qualificação de push.
O [guia de release mobile](../../mobile/docs/firebase-push-release.md) detalha os
arquivos, comandos e a matriz de aceite físico Android/iPhone.

Os testes locais usam credenciais RSA sintéticas e envio simulado. Nenhuma
mensagem real é enviada. Após publicar, atribua uma operação de outra conta da
mesma organização a um técnico, confira a caixa de avisos, a entrega registrada
e o clique no Android em primeiro/segundo plano. Teste também logout/login com
outro usuário, múltiplos dispositivos, preferência de push desativada e renovação
do token. O worker precisa estar ativo (`JOBS_WORKER_ENABLED=true`).

Referências oficiais:

- [Inicialização do Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Envio de mensagens](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)
- [Gestão de tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens)
- [Códigos de erro](https://firebase.google.com/docs/cloud-messaging/error-codes)
- [Configuração iOS](https://firebase.google.com/docs/cloud-messaging/ios/get-started)
- [Permissões de envio](https://firebase.google.com/docs/projects/iam/roles-predefined-product)

## Registro histórico da implementação inicial

Passaram 60 testes direcionados de configuração, payload, escopo, registro,
materialização e entrega, além de build, lint e validação do schema Prisma.
O teste em PostgreSQL temporário com `orbit_app` e RLS real exercita múltiplos
dispositivos, isolamento entre tenants/usuários, fila persistida, rotação de token,
rollback da limpeza e troca de conta no mesmo aparelho.

Na implementação inicial, a auditoria npm de produção apontava 15 dependências afetadas: quatro altas
e onze moderadas. Nove já existiam; seis pertencem à cadeia opcional de Firestore
incluída pelo SDK oficial. O transporte implementado importa `firebase-admin/app`
e `firebase-admin/messaging`, sem utilizar Firestore. Atualizar as versões
compatíveis dessas dependências não resolveu os achados; sua correção exige
acompanhamento dos pacotes upstream ou uma atualização específica de dependências.
As dependências foram posteriormente tratadas nas PR-01/PR-03; consultar os
registros de release atuais para o estado da auditoria, sem reutilizar esses números históricos.

## Atualização PR-06

O registro e o envio foram alinhados em FCM nas duas plataformas. A autorização
de OS/RVT/PMOC e a atribuição de visitas usam a fila existente, com revalidação
antes de materializar/enviar. Os resultados históricos acima não substituem a
[evidência atual da PR-06](../../docs/release/pr-06-firebase-push.md).
