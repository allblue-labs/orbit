# Publicação de notificações mobile

O Orbit usa APNs no iPhone e FCM no Android. A API persiste o aviso do usuário e
encaminha a entrega por um gateway HTTP. As chaves VAPID são de web push e não
habilitam as notificações nativas do aplicativo.

## API em produção

Configure no ambiente de deploy (não no app):

```dotenv
PUSH_PROVIDER=gateway
PUSH_GATEWAY_URL=https://seu-gateway.example.com/push
PUSH_GATEWAY_CREDENTIAL=credencial-do-seu-gateway
JOBS_WORKER_ENABLED=true
JOBS_POLL_INTERVAL_MS=2000
```

A URL acima é ilustrativa. É necessário fornecer um serviço real compatível com
o contrato abaixo. O repositório não inclui um gateway APNs/FCM nem credenciais
para esses provedores. O Compose agora repassa essas variáveis para a API.
`JOBS_WORKER_ENABLED` controla o worker de push; `BILLING_EVENTS_WORKER_ENABLED`
controla outro worker e não o substitui. Recrie a API após alterar o ambiente.

O modo `disabled` mantém a caixa de avisos e o monitor em primeiro plano,
mas não entrega notificações pelo sistema operacional. No app aberto, o monitor
consulta a API autenticada a cada 12 segundos, somente enquanto o aplicativo
está visível. Ao receber um push nativo, também atualiza os dados, sem repetir
o banner. As preferências de avisos do usuário são respeitadas.

## iPhone

1. No Apple Developer, habilite **Push Notifications** no identificador
   `com.allbluelabs.orbitOperator` e atualize o provisioning profile.
2. Em Xcode → Runner → Signing & Capabilities, use a equipe e o perfil com essa
   capacidade. O push é opcional em Debug, Profile e Release: `flutter run
   --release` também pode instalar diretamente em um iPhone com Personal Team,
   que não suporta APNs. Nessa equipe, deixe o arquivo de configuração local
   ausente; os avisos dentro do app continuam funcionando.

   Para builds com push, usando uma equipe do Apple Developer Program e um perfil
   compatível, execute a partir de `mobile/`:

   ```bash
   cp ios/Flutter/Push.local.xcconfig.example ios/Flutter/Push.local.xcconfig
   ```

   Esse arquivo local habilita `Runner/Runner.entitlements` e está ignorado no Git.
   Prepare-o também na máquina de CI/publicação antes de gerar a build assinada.
   Remova o arquivo local ao voltar a instalar com Personal Team. A URL de produção
   da API e `--release` não habilitam push automaticamente.
3. Configure a autenticação APNs (chave ou certificado), Team ID, Key ID quando
   aplicável, e o bundle ID no gateway de envio. Esses segredos permanecem no
   servidor do gateway. O Orbit recebe diretamente um token **APNS**, não FCM.
4. Confira o entitlement da aplicação assinada: desenvolvimento usa
   `aps-environment=development`; TestFlight/App Store usam `production`, conforme
   o perfil de distribuição. O gateway deve usar o ambiente correspondente.
5. Instale a nova build, entre na conta e aceite as notificações. Se recusou,
   habilite em Ajustes → Notificações → Orbit. Valide em um iPhone real.

Referências: [ativar push no Xcode](https://help.apple.com/xcode/mac/current/en.lproj/devdfd3d04a1.html),
[entitlement APNs](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment).

## Android

1. Crie/selecione um projeto no Firebase e registre o aplicativo Android com o
   pacote `com.allbluelabs.orbit_operator`.
2. Baixe `google-services.json` e coloque em `mobile/android/app/` antes de compilar.
   O arquivo está ignorado no Git. Builds sem esse arquivo continuam funcionando,
   mas não registram um token FCM.
3. Habilite o envio FCM e configure a credencial de servidor no gateway, usando
   o mesmo projeto do aplicativo. Não coloque credenciais de servidor no APK.
4. Gere e instale a nova build; Android 13+ solicita permissão para notificações.
   O canal nativo se chama **Atendimentos e documentos** (`orbit_work`).

Referências: [configuração Android](https://firebase.google.com/docs/android/setup),
[FCM e permissões](https://firebase.google.com/docs/cloud-messaging/android/get-started),
[recebimento de mensagens](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).

## Contrato do gateway

O backend envia `POST PUSH_GATEWAY_URL` com `Authorization: Bearer <credencial>`:

```json
{
  "target": { "platform": "IOS", "provider": "APNS", "token": "token-do-aparelho" },
  "payload": {
    "version": 1,
    "notificationId": "id-do-aviso",
    "type": "WORK_ASSIGNED",
    "deepLink": "/field/work-items/PMOC:cycle-id:asset-id",
    "title": "Novo atendimento atribuído",
    "body": "Abra o Orbit para consultar os detalhes atualizados."
  }
}
```

Para APNs, converta título/corpo para `aps.alert` e mantenha `notificationId` e
`deepLink` como campos customizados na raiz de `userInfo`. Para FCM, use uma
mensagem de dados com `notificationId`, `deepLink`, `title` e `body` como strings;
o serviço Android cria a notificação em primeiro ou segundo plano. Use prioridade
adequada para alertas de trabalho. O identificador de item de OS começa com
`SERVICE_OPERATION:`; PMOC usa `PMOC:<cycleId>:<assetId>`.

Respostas esperadas: 2xx com `{"messageId":"id-do-provedor"}` quando aceito;
404/410 para token inválido; 408/429/5xx para falha temporária; outros 4xx para
falha permanente. Uma resposta pode incluir `{"code":"codigo-sem-dados-sensiveis"}`.
Aceitação pelo provedor não comprova que o aparelho exibiu a notificação.

## Verificação após publicar

- Após login, confirme `POST /api/v1/mobile/devices` com sucesso e o evento
  `push_device_registered` no app. Não copie tokens para tickets ou logs.
- De outra conta da mesma organização, atribua uma operação ou execução PMOC ao
  técnico. Verifique o novo aviso em `GET /api/v1/notifications` nessa conta.
- Com o app aberto, verifique o aviso e a atualização da Home/fila. Com o app em
  segundo plano, verifique o banner nativo e toque para abrir o atendimento.
- No backend, procure `mobile_push_delivery`: `ACCEPTED_BY_PROVIDER` indica que o
  gateway aceitou; `PROVIDER_DISABLED`, falha temporária e token inválido apontam
  para etapas diferentes. O registro não inclui token nem conteúdo do atendimento.
- Teste logout e login com outro usuário no mesmo aparelho. O vínculo anterior
  deve ser revogado, e o monitor anterior descarta respostas ainda em trânsito.

A compilação e os testes locais não validam credenciais, provisionamento nem a
entrega pelo gateway de produção. Essa verificação exige a build assinada e o
serviço de envio configurado.
