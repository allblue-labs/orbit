# PR-10 — Notificações com autorização atual

Achado **F06**, base limpa `495e223`, implementação local em 16/11/2026.
Commit de implementação: a registrar após os gates locais.
Sem push, merge, deploy ou chamadas Firebase/SES reais.

O gateway Socket.IO legado foi removido do módulo e do código. Nenhum cliente
web/Flutter do workspace o utilizava; o Nginx já recusava `/socket.io`.
A caixa HTTP existente e FCM continuam sendo os mecanismos do produto.
Preferências e criações antigas com REALTIME passam a IN_APP; entregas pendentes
desse canal são explicitamente ignoradas, com histórico preservado.

A revisão encontrou também dois impedimentos no caminho HTTP: o papel excluído
continuava na identidade e técnicos exclusivamente mobile eram barrados pela
superfície padrão da central. A identidade agora exclui papéis removidos após
estabelecer o tenant para RLS; apenas leitura e marcação de avisos compartilham
superfície mobile, conservando permissões e escopo. Ações administrativas e
inscrições Web Push mantêm sua superfície anterior.

A web deixa de oferecer um canal “Tempo real” inexistente e o mobile deixa de
solicitá-lo por padrão. Não houve novo mecanismo paralelo de notificação,
credencial, dependência ou mudança nos contratos de push nativo/SES.

## Validação

- Backend completo final: **266 suítes / 2.170 testes aprovados**.
- Integração HTTP/PostgreSQL: **3 suítes / 51 testes aprovados**; 11 casos novos
  da caixa, 28 de suspensão e 12 de concorrência de identidade. Aplicadas 122
  migrations e provisionadas 149 tabelas sob o papel restrito. PostgreSQL
  descartável em tmpfs; nenhuma conexão com banco real de cliente.
- Web completo: **72 arquivos / 693 testes aprovados**, TypeScript, ESLint e
  verificação de linguagem de produto aprovados. Nesta PR não houve nova build
  Next/Linux nem smoke de navegador; os componentes só mudaram canais e textos.
- Mobile: **18 testes direcionados aprovados** (preferências, monitor,
  notificações em primeiro plano e troca de sessão), análise dos três arquivos
  alterados e formatação aprovadas. Nenhuma build nativa ou entrega FCM real.
- Build Nest, TypeScript completo, ESLint de todos os arquivos TypeScript
  alterados/adicionados, schema Prisma, fronteiras sincronizadas e contrato dos
  75 códigos públicos aprovados. Node local **25.1.0**; qualificação consolidada
  do SHA final em Node 22/Linux continua no gate final/CI.

A regressão usa PostgreSQL real
sob orbit_app sem SUPERUSER/BYPASSRLS e duas instâncias Nest, sem mocks de
identidade, guards, transporte ou persistência. Cobre destinatário e tenant,
mesmo usuário com vínculo alterado, leitura entre réplicas, logout, expiração,
revogação de papel/permissão/superfície/usuário e recusa HTTP/WebSocket na API.

A primeira tentativa encontrou a consulta de papel antes de configurar o tenant:
o RLS negou logins válidos. A ordem foi corrigida; a tentativa seguinte encontrou
os bloqueios de superfície mobile e o Prisma local ainda gerado com o default
anterior. O acesso compartilhado foi delimitado e o cliente regenerado, como no
build/CI. Os testes não foram enfraquecidos para contornar as recusas.

Operação, compatibilidade e rollback: [contrato de transporte](../../backend/docs/notification-transport.md).
Migration: `20261116210000_retire_notification_realtime`, somente defaults.
O rollout deverá encerrar todos os processos antigos para eliminar sockets
mantidos pela versão anterior. Nenhuma implantação foi feita. Qualificação FCM
em aparelhos, saída SES da sandbox e demais PRs continuam com seus gates próprios;
esta PR não representa aprovação geral para produção.

Evidência estruturada: [PR-10](evidence/pr-10-notification-isolation.json).
