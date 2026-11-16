# PR-11 — Contenção SSRF na saída HTTP

Achado **F07**, base limpa `2fb5038`, implementação local em 16/11/2026.
Commit de implementação: a registrar após os gates locais.
Sem push, merge, deploy, alteração de firewall ou chamadas IA/Web Push/FCM reais.

A validação de integrações OpenAI-compatible, o adapter que executa IA e o
cadastro/envio Web Push passam pela política compartilhada de destinos.
O envio usa HTTPS limitado e IP fixado; não depende da aprovação passada da URL.

- Origens HTTPS exatas autorizadas somente pelo deployment; sem flags de tenant,
  wildcard, credenciais na URL ou HTTP local liberado por `NODE_ENV`.
- Validação de todos os A/AAAA, recusando resultados privados/especiais/mistos,
  seguida de conexão ao IP aprovado, Host/SNI originais e checagem de CA, hostname
  e endereço remoto antes de enviar credenciais. Sem segunda resolução DNS.
- Recusa de redirects; prazos para DNS, conexão, inatividade e operação; cotas
  de concorrência e tamanho de envio, headers e resposta durante streaming.
- Rotas privadas de IA exigem origem/porta e IPs exatos aprovados no servidor.
  Loopback, link-local, metadata, CGNAT e IPs de transição continuam proibidos,
  inclusive nas exceções. Web Push nunca herda autorização de rede privada.
- Web Push mantém VAPID e criptografia do SDK, utilizando somente sua geração
  de requisição. A execução sai do cliente sem limites para o transporte comum.
  Não se persiste mais um Location remoto potencialmente sensível como message ID.
- Logs de recusa não carregam endpoint/token, chave, credencial ou corpo remoto.
  A IA também deixa de propagar mensagens arbitrárias de erro do provedor.

Configuração/documentação: [política de saída](../../backend/docs/outbound-http-policy.md).
Novas envs: `OUTBOUND_AI_ORIGINS`, `OUTBOUND_WEB_PUSH_ORIGINS` e
`OUTBOUND_AI_PRIVATE_ROUTES`. Compose atualizado. Sem migration, dependências
novas ou alterações de contrato no frontend/mobile. Firebase nativo e SES/SNS
mantêm seus canais existentes; não foi realizada entrega comercial externa.

## Validação

- Backend completo: **271 suítes / 2.271 testes aprovados**.
- Integração HTTP/PostgreSQL: **3 suítes / 25 testes aprovados** (quatro casos
  novos SSRF, isolamento de notificações e registro/entrega mobile com provider
  sintético). Aplicadas 122 migrations e provisionadas 149 tabelas sob orbit_app,
  sem SUPERUSER/BYPASSRLS, em banco descartável com dados em tmpfs.
- Build Nest, TypeScript completo, ESLint de todos os arquivos TypeScript
  alterados/adicionados, fronteiras sincronizadas, 75 códigos públicos,
  sintaxe do harness, configuração Compose e `git diff --check` aprovados.
- Audit de produção: **zero vulnerabilidades**. O conjunto completo mantém
  **25 moderadas de tooling** sob as exceções já revisadas até 26/11/2026;
  nenhuma high/critical. A primeira tentativa sem acesso de rede não obteve
  resultado e não foi contabilizada; repetição com acesso ao registro passou.
- Runtime local Node **25.1.0**. Não houve nova imagem Node 22/Linux, build
  frontend/mobile ou teste físico de push: esses gates mantêm seus próprios
  aceites na CI/qualificação final. Nenhuma dependência/lock foi alterada.

Os testes da política usam DNS controlado e não
fazem tentativas contra infraestrutura interna ou provedores de produção. O gate
TLS usa servidor/certificado sintéticos na própria interface privada da máquina,
aprovada explicitamente na fixture; mantém validação de peer, hostname e TLS.
Somente o resolver e a confiança na CA de teste são injetados. Não existe env de
produto para liberar loopback ou certificados não confiáveis.

A integração usa autenticação e PostgreSQL reais sob papel sem SUPERUSER/BYPASSRLS,
com DNS controlado e HTTPS upstream proibido por spy. Verifica cadastro de push,
ativação de IA, sigilo das chaves e recusa de bypass de rede privada via tenant,
além da regressão da caixa HTTP e FCM com provedor sintético.

Falhas intermediárias: uma tabela parametrizada Jest e asserções/tipos de mocks
foram corrigidos; o harness que zera variáveis recebeu origens públicas explícitas
para não desabilitar seus próprios casos positivos. A suíte completa revelou
`socket hang up` na fixture antiga de preferências com `app.init()` e listener
implícito do Supertest. Ela agora mantém um único listener local com `app.listen()`;
nenhum guard, permissão ou asserção de produto foi removido para passar os gates.

No rollout futuro será necessário inventariar e aprovar as origens existentes;
provedores customizados fora da lista serão recusados. Nenhum dado existente é
excluído, e nenhuma configuração foi aplicada ao servidor. A qualificação geral
de produção segue condicionada às demais PRs e aos aceites externos do plano.

Evidência estruturada: [PR-11](evidence/pr-11-outbound-ssrf.json).
