# Revisão visual manual

Os testes de `test/screenshots/capture_test.dart` continuam na suíte funcional:
assertivas de conteúdo, layout, erros e a matriz de larguras/escalas são executadas
normalmente. Gravar PNGs é uma ferramenta separada:

```sh
flutter test tool/capture_ui.dart --update-goldens
```

Os arquivos são gerados em `tool/out/` e ignorados pelo Git. O comando não altera
baselines versionadas nem aprova diferenças automaticamente. Revise as imagens
antes de aceitar mudanças visuais. O harness usa fontes do SDK instalado, sessão,
router e providers isolados; não depende de caminhos pessoais de outro Mac.

Para os testes funcionais sem API use `flutter test --exclude-tags integration`.
Para os 60 testes reais de API use, na raiz, `node scripts/verify-integrations.mjs mobile`.
O runner reprova indisponibilidade e fixtures ausentes, sem transformar essas
falhas em skips. Flutter exigido: 3.47.2, com lockfile validado.
