# Amazon SES — ativação de produção e comunicações do primeiro owner

Base `6f7d9e9`, implementação em 17/11/2026. Esta entrega complementa PR-07/08;
não muda a ordem dos PRs nem aprova os demais requisitos externos de produção.

## Resultado do código

- Catálogo HTML/texto em pt-BR: boas-vindas com confirmação na mesma mensagem,
  confirmação reenviada, recuperação, senha efetivamente alterada, plano vencido
  sem reativação e limites consolidados. Sem campanhas ou tracking.
- Procedência persistente do primeiro owner, validada por cadastro público com
  aceite legal/reserva de documento ou provisionamento administrativo canônico.
  Promover um membro a OWNER ou utilizar um endereço com domínio real não
  concede elegibilidade. Equipe mantém os links manuais de acesso existentes.
- Migration aditiva `20261117180000_owner_transactional_email`: RLS forçada,
  funções com search_path restrito e revogação de escrita direta para orbit_app.
  Backfill positivo de contas existentes não dispara boas-vindas retroativas.
- Gatilhos transacionais para identidade/senha, payload AES existente, fila com
  lease e deduplicação, cooldown e limites diários. Avisos de cobrança exigem
  owner verificado e revalidam situação atual antes do envio. Reativação ou
  adequação cancela o aviso antigo. Uma organização recém-criada não recebe
  aviso apenas por ocupar exatamente uma vaga de cadastro.
- SES com credenciais explícitas de ambiente, conexão 2s, requisição 5s,
  prazo total 15s e uma tentativa por chamada SDK; a fila controla retries.
  Recibo conhecido é reutilizado quando há perda de ACK. Ambiguidade de rede
  sem recibo observável ainda impede garantia de entrega exactly-once.
- Links novos de verificação, recuperação e convite usam fragmentos; os links
  antigos continuam válidos. Recuperação/convite capturam em memória e removem
  o token do endereço sem consumi-lo automaticamente. Headers no-referrer,
  no-store e noindex aplicados às páginas públicas de identidade.
- CLI de preparação com escopo fixo no SES/SNS do staging, sem administração de
  IAM. CLI de preview envia exatamente duas mensagens explicitamente solicitadas,
  sem criar conta, emitir tokens ou consumir a fila dos clientes.

Regras de frequência, configuração, IAM e comandos estão em
[amazon-ses.md](../../backend/docs/amazon-ses.md) e
[amazon-ses-feedback.md](../../backend/docs/amazon-ses-feedback.md).

## Evidências locais

- Backend: 275 suítes / 2.289 testes unitários aprovados.
- Frontend: 73 arquivos / 695 testes aprovados; TypeScript aprovado nas duas camadas.
- Chromium com Next standalone de produção + PostgreSQL/RLS reais: quatro casos
  aprovados (recuperação e convite, fragmento novo e query legada, remoção da URL
  sem perda do token e submissão correta).
- ESLint dos arquivos TypeScript alterados e git diff --check aprovados.
- PostgreSQL temporário e papel orbit_app restrito: 52 suítes / 673 testes
  integrados aprovados. Regressão adicional do cadastro/fila: duas suítes / 31
  testes aprovados com a migration final, incluindo retomada por outro administrador.
- A rodada inicial identificou a regressão de procedência
  no provisionamento administrativo, corrigida sem remover as proteções de acesso;
  também houve timeouts durante suspensão/sobrecarga do ambiente de testes.

## Preparação real do staging

A consulta autenticada ao SES em us-east-2 confirmou produção habilitada,
envio habilitado, domínio verificado, DKIM ativo, supressão AWS para bounce e
complaint e quota de 50.000 mensagens/dia com 14 mensagens/s. Não houve envio
nessa consulta. A configuração AWS é regional e não foi simulada por uma flag.

O usuário executou a preparação privilegiada do host: backup em
`/var/backups/orbit/20261117T125307Z`, include privado do proxy, teste e reload do
Nginx e atualização da rotina de backup. Orbit e Nexus responderam HTTPS 200 antes
da publicação. Preflight de namespace/papéis global sem conflitos (zero linhas).

Segredos antigos preservados. Chave de supressão gerada somente no servidor se
inexistente; .env mantido em modo 600. Envio automático inicialmente pausado por
`ACCOUNT_EMAIL_DELIVERY_ENABLED=false`; retenção destrutiva pausada por
`SUBSCRIPTION_DATA_RETENTION_ENABLED=false`, aguardando os pré-requisitos CDN/legado
já documentados na PR-13. A pausa de retenção independe do envio transacional.

Nenhuma configuração do Nexus, certificado TLS, chave de criptografia existente
ou credencial de banco foi substituída. Sem Git push ou merge.

## Primeira publicação e qualificação real

Commit de implementação `02926a3eb80c37c3d13f3eda2860150f273b7af4`, imagens
publicadas no Docker Hub privado por digest. Staging recebeu as 14 migrations
pendentes (125 no total). Papel orbit_app confirmado sem SUPERUSER/BYPASSRLS;
preflight das 199 invariantes relacionais concluído sem achados. Backup consistente
adicional, validado por pg_restore --list:
`/home/ninja/orbit-releases/ses-20261117/before/postgres-before-migrations-20261117T155717Z.dump`.

A primeira chamada remota por stdin encerrou após pausar a API, antes da migration.
A execução foi corrigida para arquivo no servidor com stdin fechado; a publicação
prosseguiu com backup validado e nenhum dado foi restaurado/removido automaticamente.

A credencial inicialmente recusou SNS:CreateTopic (403). O usuário aplicou a
política restrita de preparação/confirmacão do tópico exclusivo do staging. O SNS
confirmou uma subscription HTTPS, SignatureVersion=2, zero pendentes; o SES remoto
retornou READY, produção e envio habilitados. Orbit e Nexus responderam HTTPS 200.
Na página de recuperação publicada: no-referrer, no-store e noindex/nofollow.

**Exatamente dois envios para darlansimplicio@gmail.com**, ambos aceitos pelo SES:
prévia combinada dos seis modelos e confirmação simples. Nenhum reenvio ao Gmail
foi feito. Os recibos comprovam aceitação; não equivalem a comprovação de leitura
ou caixa principal. Não houve criação/alteração de conta, senha ou token nesses testes.

O primeiro teste real mostrou SES_IDENTITY_DENIED: o remetente individual está
verificado e tem precedência sobre o domínio. O ARN esperado foi corrigido para
essa identidade, preservando a validação estrita do webhook. Um novo teste apenas
no Mailbox Simulator confirmou DELIVERY; os cenários de HARD_BOUNCE e COMPLAINT
confirmaram feedback e supressão, incluindo tentativa subsequente recusada sem
outro SendEmail. Dois testes de regressão cobrem a seleção da identidade individual
e o fallback ao domínio; a seleção passou a ser compartilhada com o preflight.
Quatro suítes direcionadas / 46 testes passaram após o ajuste, além de TypeScript
sem erros. A imagem operacional será atualizada para incluir esse provisionador.

Depois de validar a versão final do provisionador, remover os statements IAM
OrbitStagingFeedbackBootstrapSNS e OrbitStagingFeedbackBootstrapSES da política
adicionada; manter OrbitStagingFeedbackRuntime e as permissões SES pré-existentes.
As permissões de preparação não são necessárias para os envios normais.
