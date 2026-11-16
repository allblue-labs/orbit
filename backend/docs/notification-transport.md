# Transporte e autorização da caixa de avisos

A PR-10 de produção retira o gateway Socket.IO legado. Web e Flutter já usam a
caixa HTTP; nenhum consumidor do workspace depende desse gateway. Não há novo
endpoint SSE/WebSocket, token de handshake ou Redis/pub-sub.

## Contrato ativo

- Web: BFF com cookies HttpOnly; polling padrão de 60 s, mínimo de 10 s,
  suspenso em segundo plano e atualizado ao recuperar foco.
- Mobile: caixa HTTP, monitor de 12 s em primeiro plano e FCM para avisos nativos.
  Parar/descartar o monitor invalida respostas em voo; o runtime de sessão mantém
  cache e controladores separados por usuário, organização e unidade.
- O banco é a fonte dos avisos e da leitura. A réplica que recebeu a ação não
  precisa ser a mesma que atende a próxima consulta. Polling oferece atualização
  eventual; não promete entrega instantânea nem recibo de exibição no aparelho.
- Cada chamada HTTP resolve sessão não revogada/não expirada, usuário ativo,
  vínculo/papel atual, superfície, permissão, plano e organização operacional.
  Papel com `deletedAt` deixa de conceder acesso, inclusive por override pessoal.
  O papel só pode ser consultado depois de estabelecer o tenant para o RLS.
- Listar, detalhar e marcar leitura permitem WEB/MOBILE/API com
  `notifications.read`; criação/dispatch e inscrições Web Push conservam sua
  superfície administrativa WEB/API e suas permissões. Preferências pessoais
  continuam nos endpoints compartilhados existentes.
- Organização e destinatário vêm da identidade atual, nunca de query/body.
  O contexto atual do produto segue o primeiro vínculo ativo do usuário; esta PR
  não introduz seleção de tenant por token/aba nem sessão fixada a um tenant.

## Compatibilidade e auditoria

`REALTIME` permanece no literal/DTO para versões instaladas e dados históricos.
Na criação e nas preferências é normalizado para `IN_APP`, sem duplicar a entrega.
A leitura de preferências antigas também devolve os canais normalizados.
Os defaults PostgreSQL e Prisma passam a `['IN_APP']`.

Entregas históricas pendentes de REALTIME recebem `SKIPPED`, provider
`realtime-retired`, sem `sentAt` novo. Dispatch posterior não as tenta novamente.
As linhas históricas SENT não são reescritas. Uma linha com apenas transporte
aposentado não ganha sucesso fictício; a notificação ainda existe na caixa HTTP.
O mecanismo não promete exactly-once entre dispatches concorrentes; os demais
canais conservam seus próprios contratos. FCM e SES não são substituídos.

## Implantação futura e reversão

1. Aplicar `20261116210000_retire_notification_realtime` antes da API nova e
   gerar Prisma no build. A migration altera somente dois defaults; não varre
   notificações, não apaga histórico nem muda policies RLS.
2. Substituir **todos** os processos da API anterior e encerrar suas conexões.
   Um processo antigo ainda vivo mantém o código vulnerável. Não deixar
   réplicas antigas atendendo ou sockets antigos em drenagem indefinida.
3. Manter o 404 de `/socket.io` no Nginx existente e validar o 404 também na API
   interna. As conexões anteriores terminam junto dos processos antigos.
4. Validar caixa, leitura em outra réplica, logout e troca/revogação de vínculo.
   A CI inclui `test/notification-isolation.e2e-spec.ts` no gate E2E completo.

Para recuperar disponibilidade, reimplantar a versão corrigida conhecida. Um
rollback de binário que restaure o gateway reabre o achado e não é uma reversão
aceitável de segurança. O default novo é compatível com a caixa antiga; não há
necessidade de voltar a gravar REALTIME no banco. Nenhum passo desta implantação
foi executado durante a implementação local.

## Reproduzir a integração

Com Docker disponível, sem usar banco/envs de produção:

```sh
cd backend
npx prisma generate
npm run test:e2e -- --runTestsByPath test/notification-isolation.e2e-spec.ts test/tenant-suspension.e2e-spec.ts test/identity-concurrency.e2e-spec.ts
```

O harness aplica migrations, configura o papel restrito e descarta o banco no
final. Na execução local desta PR, seu `withIntegrationEnvironment` foi chamado
com `{ postgresTmpfs: true }` para não consumir o disco do Docker. A suíte nova
entra automaticamente no gate E2E completo da CI existente.
