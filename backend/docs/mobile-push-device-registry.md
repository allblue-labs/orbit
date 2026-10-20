# Mobile Push & Device Registry

## Princípio

Push é um sinal best-effort para o usuário reler o Orbit. `Notification` é o fato persistido; `MobilePushDelivery` é apenas uma tentativa de chamar atenção em uma instalação. Aceite pelo provider não significa entrega ao aparelho nem leitura.

## Instalação e identidade

`MobileDeviceInstallation` representa uma instalação do app. `deviceInstanceId` reutiliza a identidade aleatória app-scoped já criada pelo MB-04; não usa IMEI, MAC, serial ou advertising ID. O push token é um atributo rotativo e nunca identifica o device.

O registro recebe somente `deviceInstanceId`, plataforma, provider, token e metadados de apresentação. Usuário e organização vêm exclusivamente da sessão. A função SQL estreita `app_register_mobile_installation` deriva ambos do `RequestContext`, valida membership e serializa:

- repetição do mesmo registro;
- rotação do token;
- reassociação segura do mesmo device/token no user switch;
- revogação do binding anterior.

A instalação não congela Business Unit. O usuário pode operar em múltiplas unidades; a BU do fato é revalidada ao materializar a notificação. Logout chama `DELETE /api/v1/mobile/devices/:deviceInstanceId`, desabilitando a instalação. `lastSeenAt` é atualizado no registro eventual, sem heartbeat contínuo.

## Política V1 e targeting

`MobileNotificationPolicy` é o único mapeamento entre fato, tipo, audiência, texto e deep link. A V1 possui:

- `WORK_ASSIGNED`, para responsável ou auxiliar explicitamente atribuído;
- `ARTIFACT_AVAILABLE`, somente após manifest emitido e render `READY`;
- `SYNC_ATTENTION_REQUIRED`, infraestrutura preparada para conflito materializado pelo MB-04.

Não há fan-out por tenant topic. Cada usuário pode ter N instalações ativas, gerando uma delivery por `(notificationId, installationId)`. Membership organizacional, membership da BU e binding usuário/instalação são revalidados. Remoção de assignment ou permissão pode tornar o recurso inacessível; abrir o push apenas navega e a API decide novamente com RLS/RBAC.

## Privacidade e deep links

O payload neutro contém somente versão, notification ID, tipo, deep link, título e corpo curtos. A copy PT-BR não inclui cliente, endereço, telefone, e-mail, valores, evidências, assinaturas ou conteúdo técnico. Tokens nunca aparecem em Read Models, métricas ou logs.

Deep links são gerados no servidor sob `/field/...`, não aceitos do dispositivo e nunca executam mutações. Apps antigos devem usar a home/central de notificações como fallback para tipos desconhecidos. Um recurso removido retornar `404/403` ao abrir é comportamento normal e seguro.

## Entrega assíncrona

A notificação, as deliveries e os jobs são materializados antes do push. O `BackgroundJobQueue` persiste `mobile.push.delivery`, restaura organização, BU e ator e aplica retry exponencial limitado. Nenhuma chamada ao provider ocorre na transação de Operation/Artifact.

Resultados:

- `ACCEPTED_BY_PROVIDER`: terminal; não é read receipt;
- `INVALID_TOKEN`: terminal e desabilita a instalação;
- `TEMPORARY_FAILURE`: registra a tentativa e lança para o backoff da fila;
- `PERMANENT_FAILURE`: terminal;
- `SKIPPED`: binding ou eligibility deixou de existir.

O modo `PUSH_PROVIDER=disabled` mantém o domínio operacional em desenvolvimento. Produção usa `PUSH_PROVIDER=gateway` com `PUSH_GATEWAY_URL` e `PUSH_GATEWAY_CREDENTIAL` no ambiente/secret store. O gateway traduz o contrato neutro para FCM/APNs. Habilitar o modo sem credenciais falha claramente no boot. Credenciais nunca são persistidas no banco.

## RLS e observabilidade

`mobile_device_installations` e `mobile_push_deliveries` usam ENABLE/FORCE RLS. O usuário lê e revoga apenas suas instalações; delivery é visível somente ao destinatário da Notification. O worker opera com `orbit_app`, contexto explícito e sem `BYPASSRLS`.

Logs estruturados usam tipo, provider, plataforma, resultado, attempt e job ID. Métricas agregam attempted, accepted, invalid token e falhas temporárias/permanentes, sem IDs ou token como labels.

## Limitações conhecidas

- entrega é best-effort, sem exactly-once e sem garantia contínua;
- não há confirmação de leitura pelo provider;
- sem action buttons, rich media ou comandos em background;
- sem quiet hours na V1 Mobile;
- retenção de installations/deliveries antigas ainda depende da política geral futura;
- disponibilidade externa depende do gateway e dos providers FCM/APNs.
