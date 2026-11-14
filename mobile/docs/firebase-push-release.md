# Firebase Push — configuração e qualificação de release

O Orbit usa Firebase Admin no backend e os SDKs oficiais Firebase Messaging no
Android e iOS. A ponte Flutter continua pequena e testável. O iOS associa o token
APNs ao FCM; **APNs puro não é um token FCM**. O backend Firebase recusa o registro
legado com orientação para atualizar o app, sem invalidar tokens por erro de IAM
ou de configuração APNs.

## 1. Projeto e arquivos públicos do aplicativo

Usar projetos Firebase separados para staging e produção. Em cada ambiente,
cadastrar os dois apps em **Firebase Console → Configurações do projeto → Geral**:

| Plataforma | Identificador |
| --- | --- |
| Android / Google Play | `com.allbluelabs.orbit` |
| iOS / Apple | `com.allbluelabs.orbitOperator` |

Os identificadores diferentes entre plataformas são intencionais. Baixar os
arquivos **dos aplicativos**, preservando o nome:

- Android: `mobile/android/app/google-services.json`.
- iOS: `mobile/ios/Runner/Google-Service-Info.plist`.

Esses caminhos estão ignorados pelo Git. Para alternar ambientes, guardar cópias
em `mobile/config/firebase/staging/` e `mobile/config/firebase/production/`, também
ignoradas, e copiar o par do ambiente escolhido para os caminhos acima antes do
build. A CI de distribuição deve materializar os arquivos do ambiente selecionado;
não reutilizar automaticamente o arquivo de outro ambiente.

Os arquivos de cliente contêm identificadores públicos, não credenciais Admin.
**Nunca colocar o JSON de conta de serviço ou uma chave privada nesses arquivos.**
A barreira valida projeto, application/bundle ID, sender e app ID, e recusa o JSON
de conta de serviço. O projeto esperado é explícito para detectar arquivos trocados.

## 2. Apple Developer e APNs

É necessário um Apple Developer Program compatível com Push Notifications.
Personal Team continua servindo para desenvolvimento local sem push.

1. No Apple Developer, habilitar Push Notifications no App ID
   `com.allbluelabs.orbitOperator` e atualizar o provisioning profile correspondente.
2. Criar/selecionar uma chave de autenticação APNs para esse app e ambiente, conforme
   a política da conta. Guardar o `.p8`, Key ID e Team ID fora do repositório.
3. Em **Firebase Console → Configurações do projeto → Cloud Messaging → configuração
   do app iOS → APNs authentication key**, cadastrar a chave e os identificadores.
   Configurar o ambiente de desenvolvimento e/ou produção que será testado.
4. Copiar `mobile/ios/Flutter/Push.local.xcconfig.example` para
   `mobile/ios/Flutter/Push.local.xcconfig`, habilitando `ORBIT_PUSH_ENABLED = YES` e
   `ORBIT_PUSH_ENTITLEMENTS = Runner/Runner.entitlements`. Esse arquivo é local.
5. Debug usa APNs `development`; Release usa `production`. Para instalar uma build
   Release com perfil de desenvolvimento, usar o override local explícito
   `ORBIT_APNS_ENVIRONMENT = development`. Archives exigem `production` e um perfil
   compatível. Inspecionar o entitlement do app **assinado**, não só o arquivo fonte.

O SDK iOS está fixado em **13.1.1**, via Swift Package Manager; Xcode 26.2+ é
necessário. Só o produto FirebaseMessaging é ligado ao Runner. Dependências do
manifesto completo também aparecem no lock do SwiftPM; isso não adiciona o produto
Analytics ao app. Não foi adicionado SDK Firebase via CocoaPods.

O AppDelegate desativa swizzling e associa `Messaging.apnsToken` explicitamente.
O FCM só é publicado ao Dart depois da associação APNs. Não são registrados tokens
ou chaves em logs.

## 3. Backend / worker

No ambiente correspondente, configurar as variáveis existentes:

```dotenv
PUSH_PROVIDER=firebase
FIREBASE_PROJECT_ID=<mesmo projeto dos aplicativos>
FIREBASE_CLIENT_EMAIL=<client_email da conta de serviço>
FIREBASE_PRIVATE_KEY=<private_key; preservar escapes literais de nova linha>
JOBS_WORKER_ENABLED=true
```

As três credenciais Firebase ficam exclusivamente no backend. Não usar variáveis
`NEXT_PUBLIC_*`, `dart-define` com chave privada, JSON Admin no app ou painel de
campanhas para disparar os avisos transacionais.

Confirmar Cloud Messaging API HTTP v1 habilitada no projeto e permissão de envio
para a conta de serviço. Reiniciar/recriar API/worker para aplicar configuração.
Não trocar as credenciais de produção para realizar testes com staging.

A intenção de push de atribuição/autorização é persistida na fila do domínio:
RVT ao criar/editar visitas, OS na autorização e PMOC ao abrir/autorizar ciclos.
Atribuições de OS/PMOC existentes continuam integradas. A materialização e o envio
reconferem autorização/atribuição; demandas canceladas, concluídas, reatribuídas,
preferências desativadas e instalações reatribuídas/revogadas são descartadas.
O registro FCM novo substitui o APNs legado da mesma instalação; não há expurgo
indiscriminado de dispositivos nem replay automático de entregas antigas terminais.

## 4. Builds

Copiar o exemplo `config/production.example.json` para o arquivo local
`config/production.json` e ajustar:

```json
{
  "ORBIT_API_URL": "https://orbit.allblue-labs.com/api/v1",
  "ORBIT_FLAVOR": "production",
  "ORBIT_FIREBASE_PROJECT_ID": "substituir-pelo-projeto-correto"
}
```

Para staging, usar `ORBIT_FLAVOR=staging`, projeto Firebase próprio e o endereço da
API do staging. Os exemplos de URL existentes usam `.invalid` para impedir uma
publicação acidental; preencher o endereço real no arquivo local.

```sh
cd mobile
flutter build appbundle --release --dart-define-from-file=config/production.json
flutter build ipa --release --dart-define-from-file=config/production.json
```

Além da configuração Firebase, o Android continua exigindo a chave de upload
conforme `android-store-release.md`. Não houve mudança em applicationId ou signing.

O Gradle executa `validateOrbitPush` antes do release/Google Services. O Xcode
executa a mesma validação, verifica o entitlement e copia o plist validado para o
bundle. Falhas interrompem a distribuição. iOS archives não aceitam opt-out.

Para um **teste local com Personal Team**, o arquivo local pode conter:

```xcconfig
ORBIT_PUSH_ENABLED = NO
ORBIT_PUSH_ENTITLEMENTS =
ORBIT_ALLOW_NO_PUSH = YES
```

Isso permite instalação direta, inclusive Release, sem push. Não serve como aceite
nem como build de distribuição. Android Debug e iOS Debug sem configuração continuam
permitidos. O pipeline comum compila Android Debug; a etapa de distribuição deve
usar os arquivos do ambiente para passar pela barreira real de release.

## 5. Teste físico obrigatório

Após publicar o backend e instalar builds configuradas, executar em **Android e
iPhone físicos** com contas sintéticas, sem dados de clientes reais:

| Cenário | Resultado necessário |
| --- | --- |
| Atribuir OS, visita RVT e equipamento PMOC | Um aviso com destino correto |
| Fluxo de autorização ativo | Sem aviso antes; aviso depois da autorização |
| Cancelar, concluir, substituir técnico antes de enviar | Sem entrega obsoleta ao técnico anterior |
| Gerar relatório/documento | Aviso abre documentos da conta autenticada |
| App aberto, em background e sem processo | Notificação visível e toque navega corretamente |
| Recusar/reabilitar permissão | Sem travar; registro recuperado ao retomar |
| Rotacionar/reinstalar app | Instalação atualizada e token antigo não invalida o novo |
| Logout, trocar usuário ou organização | Registro revogado/reatribuído; toque antigo não abre dados de outra conta |
| Desativar preferência PUSH | Worker não envia o aviso |

Registrar versão/build, plataforma/OS, ambiente, cenário, horário e resultado
observado. Não guardar tokens FCM/APNs, cookies ou chaves como evidência. Force-stop
no Android e encerramento manual no iOS podem limitar a entrega conforme o sistema;
reabrir o app e distinguir esse caso de um processo encerrado normalmente.

`ACCEPTED_BY_PROVIDER` significa que o SDK/FCM aceitou a mensagem. Não comprova que
o sistema operacional a exibiu ou que o usuário a leu. A leitura continua sendo
registrada pela API de notificações. O push contém mensagens genéricas e um destino;
os detalhes são sempre buscados pela API autenticada. Entregas já em trânsito não
podem ser recolhidas no aparelho; o toque confere destinatário e organização atuais.
Notificações antigas sem esses metadados são ignoradas após a atualização.

Referências oficiais: [Firebase Apple/FCM](https://firebase.google.com/docs/cloud-messaging/ios/get-started),
[recebimento Android](https://firebase.google.com/docs/cloud-messaging/android/receive-messages),
[configuração pública dos aplicativos](https://firebase.google.com/docs/projects/learn-more#config-files-objects)
e [releases iOS](https://firebase.google.com/support/release-notes/ios).
