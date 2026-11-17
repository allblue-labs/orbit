# Categorias de e-mail e formulário público — 17/11/2026

Base ceb244a. Separação dos remetentes de conta/segurança, avisos e suporte por
envs, preservando fallback legado e a política de e-mails do owner inicial.
O suporte público é um fluxo distinto: somente a equipe recebe a mensagem;
nenhuma confirmação automática é disparada ao visitante.

A landing ganhou a seção de contato, responsiva e ligada ao rodapé, com nome,
e-mail, assunto e mensagem, validação pt-BR, loading e confirmação. To fixo em
contato@allblue-labs.com por env; From suporte-orbit; Reply-To visitante validado.
Logos inline do Orbit e Allblue são compartilhadas com os demais templates.

Fila cifrada com RLS, limite por origem/e-mail/dia, chave de idempotência,
lease entre réplicas, até seis tentativas, correlação SES e limpeza do payload.
Apenas a nova migration aditiva é necessária; credenciais e buckets permanecem.

O feedback SNS continua verificando conta, região, fonte e ARN exatos. O mapa
inclui os remetentes de categoria e o legado. Descoberta/preflight são somente
leitura; a checagem AWS no staging confirmou os quatro endereços verificados:
contato por identidade própria e os três aliases pela identidade do domínio.

Validação local:

- Backend: 276 suítes / 2.312 testes unitários aprovados.
- Frontend: 73 arquivos / 702 testes unitários aprovados.
- PostgreSQL real restrito: três suítes / 45 testes de contato, outbox de conta
  e SES/SNS aprovados, com duas réplicas.
- Navegador: 12 cenários de landing/contato aprovados, incluindo BFF/API reais,
  campos inválidos, reenvio com mesma chave, loading e largura de 375px.
- Next standalone de produção e TypeScript aprovados; schema Prisma válido.
- Nenhum e-mail real enviado pelos testes locais.

[Configuração e comportamento](../../backend/docs/email-categories-and-contact.md).
## Staging aplicado

Commit e133b24a2f8fd4412f65d85def1e6875a360a66f, com imagens Linux/amd64
imutáveis em [manifesto](evidence/email-categories-contact-images-2026-11-17.json).
A API compilou, e a auditoria das dependências de produção retornou zero
vulnerabilidades. Backup custom validado antes da migration em
`/home/ninja/orbit-releases/contact-e133b24a2f8f/before/postgres.dump`, modo 600,
com configuração anterior preservada para reversão.

A migration 20261117210000_public_contact_delivery foi aplicada. O papel orbit_app
continuou sem SUPERUSER/BYPASSRLS, com 152 tabelas concedidas sob suas políticas.
API, frontend e PostgreSQL ficaram healthy. Preflight remoto SES READY antes e
depois da troca, incluindo todas as identidades dos remetentes e o mapa de feedback.
O .env do staging ficou em modo 600, com os novos campos, credenciais anteriores
preservadas e nenhum retorno das permissões temporárias de bootstrap SNS.

Foi enviado exatamente um teste por categoria ao endereço de sucesso do
simulador oficial do SES: três mensagens aceitas e três eventos DELIVERY
correlacionados no ledger pela assinatura SNS e identidade exata. Nenhum
destinatário humano nem dados de clientes foram usados nesses testes. Os IDs do
provedor ficaram apenas no registro protegido da release; a evidência versionada
contém totais e resultados.

A landing pública retornou 200, contém a seção/formulário e identifica o mesmo
commit em /api/release. O POST público, com Fetch Metadata de mesma origem e
honeypot preenchido, respondeu 202 pelo caminho que descarta a mensagem, sem
inserir pedido ou enviar e-mail. Não foi enviada mensagem fictícia à caixa da
equipe para testar o formulário. O caminho real de enfileirar/enviar foi exercitado
com PostgreSQL real e SDK simulado nos testes locais. O Nexus seguiu em HTTP 200.

O formulário está em https://orbit.allblue-labs.com/#contato. Para alterar endereços,
use as envs documentadas; valide os remetentes e regenere o mapa após modificar
identidades no SES. Não é preciso criar novas caixas no SES para esses aliases.
As respostas informativas/suporte são encaminhadas à caixa contato já utilizada.
Sem Git push.
