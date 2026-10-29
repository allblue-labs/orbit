# Correção P3 da revisão para publicação

## 14. Nome exibido no launcher Android

O atributo `android:label` da aplicação passou de `orbit_operator` para `Orbit Operator`, igual ao `CFBundleDisplayName` do iOS. O identificador do pacote, a assinatura e os dados do aplicativo permanecem os mesmos.

Verificação: processamento do manifesto Android de release e comparação do nome final com o nome de exibição do iOS. O nome aparece após instalar ou atualizar o APK gerado com esta alteração.
