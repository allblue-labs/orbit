# QR de equipamento e câmera do celular

A etiqueta usa `https://orbit.allblue-labs.com/q/<token>`. Com a associação
verificada no sistema e a versão atualizada do Orbit instalada, o toque no
resultado da câmera abre a ficha no app. O mesmo endereço abre a ficha na web
quando o aparelho usa o navegador. A página web também oferece **Abrir no app
Orbit**. As etiquetas existentes desse domínio continuam funcionando.

O app mantém a etiqueta em memória até o login e até a troca de senha
obrigatória, quando aplicável. A resolução e o histórico usam a API autenticada.

## Publicação web

Configure no ambiente do frontend, via `.env` do Compose:

- `ORBIT_ANDROID_APP_LINK_SHA256` recebe o SHA-256 do **certificado de assinatura
  do app** em Google Play Console → Assinatura de apps. A chave de upload assina
  a entrega do AAB ao Google. Se houver uma APK assinada diretamente para testes,
  sua impressão digital pode ser adicionada à lista separada por vírgula.
- `ORBIT_IOS_APP_LINK_IDENTIFIER` recebe o `application-identifier` da assinatura
  de distribuição. Use o formato `PREFIXO.com.allbluelabs.orbit` com o prefixo
  do perfil efetivamente usado para distribuir o app.

Depois do deploy web, verifique respostas HTTPS 200 com JSON, diretamente
em `/.well-known/assetlinks.json` e `/.well-known/apple-app-site-association`.

## Assinatura no iOS

Habilite **Associated Domains** no identificador `com.allbluelabs.orbit` no
Apple Developer e atualize o perfil de provisionamento. Copie
`ios/Flutter/AppLinks.local.xcconfig.example` para
`ios/Flutter/AppLinks.local.xcconfig` no ambiente de build. Para assinar com
APNs e Associated Domains juntos, use `Runner/Runner.PushAndAppLinks.entitlements`.
A configuração de desenvolvimento com Personal Team pode usar o botão
**Abrir no app Orbit** na página web após instalar a nova versão.

Valide com o app fechado, aberto e sem sessão. Faça uma leitura usando a câmera
do sistema e outra usando o leitor do Orbit. Em um aparelho sem o Orbit, a
câmera deve abrir o fluxo web.

- [Configuração de App Links no Android](https://developer.android.com/training/app-links/configure-assetlinks)
- [Associated Domains no iOS](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
