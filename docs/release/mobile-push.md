# Publicação de notificações mobile

O Orbit envia notificações transacionais pelo SDK Firebase Admin no backend e
recebe tokens FCM dos SDKs oficiais no Android e iOS. Não depende do painel de
campanhas do Firebase. VAPID configura web push, não o app mobile.

O [guia de release mobile](../../mobile/docs/firebase-push-release.md) é a referência
para arquivos, assinatura, builds e testes físicos. Ambos os apps usam
`com.allbluelabs.orbit`. O iOS associa APNs ao FCM; o backend não envia para tokens
APNs puros no modo Firebase.

## Backend e worker

Configurar no ambiente de deploy, exclusivamente no backend:

```dotenv
PUSH_PROVIDER=firebase
FIREBASE_PROJECT_ID=seu-project-id
FIREBASE_CLIENT_EMAIL=push@seu-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nCONTEUDO_DA_CHAVE\n-----END PRIVATE KEY-----\n"
JOBS_WORKER_ENABLED=true
JOBS_POLL_INTERVAL_MS=2000
```

O projeto deve ser o mesmo dos aplicativos. Habilitar a Cloud Messaging API HTTP v1
e a permissão de envio da conta de serviço, conforme o [guia do backend](../../backend/docs/firebase-push.md).
Recriar a API/worker após mudar as envs. `BILLING_EVENTS_WORKER_ENABLED` controla
outro worker e não substitui `JOBS_WORKER_ENABLED`. Nunca colocar JSON Admin ou
chave privada no app. O Compose já repassa essas envs; o worker vem ativo por padrão.

## Android agora

1. Usar `mobile/android/app/google-services.json`, com **services no plural**.
2. Preparar o arquivo ignorado `mobile/config/production.json` com a URL HTTPS,
   `ORBIT_FLAVOR=production` e `ORBIT_FIREBASE_PROJECT_ID` correspondente ao arquivo.
3. Em `mobile/`, executar `make build-android-prod`. A release valida a configuração
   Firebase e a chave de upload; não existe fallback silencioso para release sem push.
4. Instalar no Android e permitir notificações. O canal se chama **Atendimentos e
   documentos** (`orbit_work`). O backend envia notification+data: o SDK mostra o
   alerta em segundo plano e o serviço nativo trata o app aberto.

A configuração APNs da Apple não é necessária para entregar pushes Android.

## iOS aguardando a conta Apple/APNs

O arquivo é `mobile/ios/Runner/GoogleService-Info.plist`, sem hífen entre Google e
Service. Enquanto a conta estiver em análise, manter o push nativo desligado.
O app funciona sem ele; instalação local Release exige opt-out explícito conforme
o guia mobile. Archives de distribuição continuam exigindo push configurado.

Quando aprovado, habilitar Push Notifications para `com.allbluelabs.orbit`, gerar
um perfil compatível e cadastrar a chave APNs com Key ID/Team ID no Firebase, no
app iOS do projeto correto. A chave `.p8` fica fora do repositório. Preparar
`ios/Flutter/Push.local.xcconfig` a partir do exemplo, habilitar push/entitlement e
recompilar. O SDK publica FCM somente depois de associar o token APNs. Desenvolvimento
usa o ambiente do perfil; App Store/TestFlight exigem `production`.

## Verificação com o aparelho

- Após login, conferir `POST /api/v1/mobile/devices` com sucesso e
  `push_device_registered` no app, sem copiar tokens para logs ou tickets.
- De outra conta da mesma organização, atribuir OS, RVT e PMOC ao técnico. Se o
  fluxo de autorização estiver ativo, autorizar antes; não deve haver aviso antecipado.
- Conferir o aviso na API e `mobile_push_delivery` no worker. `ACCEPTED_BY_PROVIDER`
  prova aceitação FCM, não exibição no aparelho. Falha APNs/projeto não apaga tokens;
  somente token comprovadamente inválido é desativado.
- Testar app aberto, em segundo plano e iniciado pelo toque na notificação. O destino
  deve ser o atendimento correto, com destinatário e tenant conferidos na sessão.
- Testar recusa/reativação da permissão, cancelamento/substituição, rotação do token,
  logout/troca de conta e preferência PUSH desativada. A matriz completa está no guia.

O monitor em primeiro plano continua consultando a API enquanto o app está visível,
mesmo sem push. Os detalhes vêm da API autenticada com RLS/RBAC. As falhas de envio
não desfazem o atendimento. O transporte gateway permanece apenas como opção legada;
este procedimento usa `PUSH_PROVIDER=firebase`.

Referências oficiais: [Android/FCM](https://firebase.google.com/docs/cloud-messaging/android/receive-messages),
[Apple/FCM e APNs](https://firebase.google.com/docs/cloud-messaging/ios/get-started).
