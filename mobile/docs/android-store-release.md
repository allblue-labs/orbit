# Primeira publicação Android

O pacote é `com.allbluelabs.orbit_operator`. Confirme esse identificador antes da primeira publicação: ele identifica permanentemente o app no Google Play. A chave de upload local assina o AAB; a Assinatura de apps do Google Play mantém a chave que assina os APKs entregues aos usuários.

## 1. Criar a chave de upload

Se `android/key.properties` já estiver configurado com uma chave existente, use
essa chave e siga para a geração do AAB. Preserve uma cópia privada do keystore
e do arquivo de credenciais. Ao copiar para outra máquina, ajuste somente
`storeFile` para o novo caminho; mantenha o alias e as senhas correspondentes.

Em um diretório privado, fora do repositório, execute (substitua o caminho):

```sh
keytool -genkeypair -v -keystore /CAMINHO/PRIVADO/orbit-upload.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias orbit-upload
```

O comando solicita as senhas e a identificação do certificado interativamente. Guarde o arquivo e as senhas em backup seguro. Não envie a chave ou senhas pelo chat, não as versione e não reutilize a chave de debug.

Na pasta `mobile`, copie o modelo:

```sh
cp android/key.properties.example android/key.properties
```

Edite **localmente** `android/key.properties`, preenchendo `storeFile` com o caminho absoluto da chave, `storePassword`, `keyAlias=orbit-upload` e `keyPassword`. O arquivo está ignorado pelo Git. Os valores seguem o formato Java Properties; use caminhos sem aspas e escape barras invertidas e caracteres especiais quando necessário.

Em CI, use os segredos `ORBIT_ANDROID_KEYSTORE_PATH`, `ORBIT_ANDROID_STORE_PASSWORD`, `ORBIT_ANDROID_KEY_ALIAS` e `ORBIT_ANDROID_KEY_PASSWORD`. Eles prevalecem sobre o arquivo. O arquivo da chave precisa estar disponível no caminho informado. Nenhuma dessas credenciais é um `dart-define`.

Releases sem os quatro valores ou com arquivo inexistente falham com uma mensagem em português. Não há fallback para assinatura de debug. Builds debug continuam disponíveis sem credenciais.

## 2. Gerar o AAB

Prepare `config/production.json` a partir de `config/production.example.json`, usando a URL real da API HTTPS e `ORBIT_FLAVOR=production`. O endpoint `.invalid` do exemplo é intencional e deve ser substituído. Preserve as demais configurações de produção que sua instalação utiliza.

```sh
make build-android-prod
```

Resultado: `build/app/outputs/bundle/release/app-release.aab`. A versão vem de `version:` em `pubspec.yaml`; o número após `+` precisa aumentar a cada novo upload. Alterar de uma instalação debug para uma instalação assinada com outra chave pode exigir desinstalar a versão de teste; sincronize o trabalho pendente antes.

## 3. Google Play Console

1. Crie o app no Console, com nome Orbit e idioma português do Brasil.
2. Crie uma versão em **Teste interno** e envie o AAB assinado. Para um app novo, use a chave de assinatura gerenciada pelo Google Play; a chave local continua sendo a chave de upload. Confira os certificados na área de Assinatura de apps do Google Play. Os nomes dos menus podem variar com a interface da conta.
3. Em **Monitorar e melhorar → Políticas e programas → Conteúdo do app → Política de Privacidade**, informe `https://orbit.allblue-labs.com/legal/privacidade`. Abra essa página em uma janela anônima antes de salvar: ela deve mostrar o documento HTML completo sem login. A rota já existe na web; sua disponibilidade depende do deploy.
4. Preencha as demais declarações de Conteúdo do app e Segurança dos dados conforme as práticas reais do produto. A remoção de permissões amplas de fotos não significa que o app não coleta evidências enviadas pelo usuário.
5. Adicione testadores e valide o app instalado pelo Google Play antes da publicação em produção. A primeira publicação pode exigir etapas adicionais conforme o tipo e a situação da conta; siga as tarefas mostradas no painel.

O app usa os seletores do sistema para anexar imagens/arquivos. O manifesto remove também declarações de bibliotecas para `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE` e `WRITE_EXTERNAL_STORAGE`. O acesso à câmera, localização e notificações permanece condicionado aos fluxos já existentes. Teste captura, seleção de foto e anexos em dispositivo real.

## Documentação oficial

- [Build e assinatura Android no Flutter](https://docs.flutter.dev/deployment/android)
- [Assinatura de apps do Google Play](https://support.google.com/googleplay/android-developer/answer/9842756?hl=pt-BR)
- [Conteúdo do app e política de privacidade](https://support.google.com/googleplay/android-developer/answer/9859455?hl=pt-BR)
- [Política de permissões de fotos e vídeos](https://support.google.com/googleplay/android-developer/answer/15800983?hl=pt-BR)
