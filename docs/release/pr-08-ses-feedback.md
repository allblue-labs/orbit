# PR-08 — SNS, bounces, complaints e supressão

Achado **F11**, base limpa `0dcc7ea`, implementação de 16/11/2026.
Código implementado e validado localmente. **Homologação SES/SNS real pendente**;
esta entrega não qualifica envio externo ou saída da sandbox. Sem push, merge,
deploy, alteração de recursos AWS ou envio de mensagens reais.

## Comportamento e fronteiras de confiança

O blueprint foi substituído por `POST /api/v1/email/webhooks/ses-sns`. O endpoint
dispensa sessão, mas exige envelope SNS v2 com assinatura RSA-SHA256 válida,
TopicArn exato, região/conta e identidade remetente esperadas. Reconstrói a string
assinada na ordem SNS, com UTF-8 e quebra final; mensagens alteradas são recusadas.

O certificado vem exclusivamente do host HTTPS SNS regional e caminho PEM
permitido. DNS privado/misto é recusado; a conexão fixa o IP público e verifica
hostname/CA TLS com trust store explícito, sem redirects. O PEM tem limite de
64 KiB e deadline total de cinco segundos; X.509/RSA e validade são conferidos.
A confiança no certificado de assinatura vem dessa distribuição HTTPS autenticada,
como no validador JS da AWS; não se afirma verificação PKIX independente da cadeia
do PEM. Cache limitado a 16 entradas/uma hora e quatro buscas simultâneas.

SubscriptionConfirmation usa somente `ConfirmSubscriptionCommand` do SDK oficial
SNS, com tópico configurado e token autenticado; nunca busca SubscribeURL.
`AuthenticateOnUnsubscribe=true`, receipt durável, lease e conclusão condicionada
à lease atual permitem recuperação sem ACK prematuro. UnsubscribeConfirmation é
registrado e exige intervenção; não faz resubscribe automático.

O remetente registra a tentativa antes do SES e envia a tag `orbit_delivery_id`.
O feedback só atua sobre envio conhecido, com remetente, região e conjunto de
destinatários coincidentes. Um callback pode chegar antes da resposta SendEmail;
a tag resolve essa corrida. Vários MessageIds aceitos pelo SDK em retry ficam
associados à mesma tentativa, sem substituir vínculos de outro envio. Eventos
antigos sem tag exigem associação previamente conhecida pelo MessageId.
Associação ainda ausente recebe 503 para retry SNS, sem ACK ou supressão arbitrária.

Evento, associação e supressões são gravados na mesma transação. Replay idêntico
recebe 200 após conferir a persistência; ID reutilizado com conteúdo assinado
diferente recebe 409. Erros transitórios recebem 503. Todos os destinatários
afetados conhecidos são considerados, até o limite SES de 50 por envio.

Hard bounce e complaint bloqueiam novas admissões para aquele endereço, inclusive
entre tenants que usam o mesmo remetente. Soft bounce não bloqueia; Delivery e
not-spam não retiram supressões existentes. O bloqueio não remove/desativa usuário,
login, contratos ou dados do cliente. Supressão continua efetiva com o receptor
desligado; falha do banco impede envio. A outbox de identidade termina com
`FAILED/EMAIL_SUPPRESSED`, sem retry; notificações por e-mail ficam
`SKIPPED/ses-suppressed`. Outros canais continuam independentes.

Os metadados guardam HMAC-SHA256 de endereços, IDs opacos, estados e datas;
nunca endereços, corpo, links, tokens ou payload SNS. O contexto dedicado
`app.email_transport` abre somente as quatro tabelas de transporte. FORCE RLS e
revogação de DELETE permanecem após o provisionamento de grants. Logs/respostas
usam códigos e mensagens fixas, sem erro bruto do SDK/ORM. A política de publicação
do tópico também precisa limitar o publicador ao SES/configuration set esperado.

SES SendEmail continua sem garantia exactly-once. Uma queda após aceitação pode
repetir e-mail, mas mantém as associações; supressão não recolhe uma chamada já
admitida/em trânsito. Não há endpoint público de consulta/liberação da supressão.

## Publicação e operação

Seguir o [guia SES/SNS](../../backend/docs/amazon-ses-feedback.md), com envs,
políticas IAM/SNS, subscription, alarmes/DLQ e comandos de homologação.

1. Gerar **uma vez** `EMAIL_SUPPRESSION_HASH_KEY` com 32 bytes em base64. É
   obrigatória no runtime de produção mesmo com feedback desligado. Preservar entre
   réplicas e backups; não reutilizar/rotacionar junto de `ENCRYPTION_KEY`.
2. Aplicar `20261116120000_ses_feedback_suppression` e provisionar os grants antes
   da API nova. A migration aditiva cria `email_outbound_messages`,
   `email_provider_messages`, `email_feedback_events` e `email_suppressions`.
   Não reenvia mensagens históricas nem altera cadastros existentes.
3. Configurar `AWS_SES_CONFIGURATION_SET`, `AWS_SES_FEEDBACK_ACCOUNT_ID`,
   `AWS_SES_FEEDBACK_TOPIC_ARN`, `AWS_SES_FEEDBACK_IDENTITY_ARN` e
   `AWS_SES_FEEDBACK_ENABLED=true`, além das credenciais/remetente existentes.
   O Compose encaminha essas variáveis; os helpers de staging validam a chave.
4. Configurar SNS Standard com **SignatureVersion=2** e envelope habilitado
   (`RawMessageDelivery=false`). Publicar a API antes de criar a subscription HTTPS.
   Vincular Bounce/Complaint/Delivery do configuration set SES ao tópico dedicado.
5. Homologar em staging via `email:feedback:simulate:dev -- <cenário> --send`;
   sem `--send`, o comando valida forma/configuração sem rede. Só aceita destinos
   do Mailbox Simulator com rótulo UUID. Não inicia workers nem drena fila real.
   Exigir `FEEDBACK_CONFIRMED` nos cenários success, bounce e complaint; no segundo
   e terceiro, o próprio comando exige que a repetição seja bloqueada localmente.
   `ACCEPTED_BY_PROVIDER` ou timeout `AWAITING_SNS` não comprovam o callback.

Não trocar isoladamente a chave HMAC: os fingerprints persistidos deixariam de
ser consultáveis. Rollback deve preservar chave, tabelas e bloqueio de envios;
versão antiga sem consulta de supressão não é um remetente seguro para retomada.
Não apagar tombstones/eventos para contornar bloqueios. A PR não altera a lista
de supressão mantida pela AWS nem implementa retenção destrutiva automática.

## Validação e limites da evidência

- **Backend completo:** 265 suítes, **2.151 testes aprovados**. A execução inicial
  revelou duas fixtures anteriores desatualizadas após as políticas NX-03:
  provider de política faltante no teste HTTP de upload e argumento de organização
  ausente no matcher de realtime. Apenas as fixtures foram corrigidas, preservando
  as verificações de autorização; esses dois runtimes não foram alterados.
- **Integração:** cinco suítes, **94 testes aprovados**, PostgreSQL descartável,
  120 migrations e 148 tabelas provisionadas com `orbit_app` restrito. Inclui
  SES/SNS, outbox de identidade, RLS, cobrança Stripe e administração canônica.
  O arquivo SNS tem 15 casos com duas instâncias Nest, HTTP e transações reais;
  só as fronteiras AWS/certificado remoto são substituídas. As assinaturas RSA
  são reais, geradas por fixture efêmera independente da canonicalização runtime.
- Cobertura de assinatura/tampering, TopicArn/identidade/destinatários, URLs/DNS
  privados, certificados inválidos/expirados, limites de corpo/cache, múltiplos
  destinatários, replay concorrente, callback antes do ACK, múltiplos IDs SES,
  colisão de vínculo, rollback SQL, retry de confirmação, supressão no remetente,
  continuidade de credenciais e isolamento das quatro tabelas.
- TypeScript, build Nest, ESLint dos arquivos TS alterados/adicionados, schema
  Prisma, contratos sincronizados, contrato de erros públicos e 220 testes dos
  contratos Nexus aprovados. Shell/Python dos helpers de deploy conferidos sem
  executá-los no servidor. Build web/mobile não repetido: não há mudanças nos
  clientes nem no contrato público desses projetos.
- Após os ajustes finais de tipos/lint, a regressão direcionada passou com cinco
  suítes/88 testes. Ela não se soma aos 2.151 casos da suíte completa.
- Audit: **zero advisories nas dependências de produção**; grafo completo com
  cinco low e 23 moderate de desenvolvimento, cobertos pelas exceções existentes
  até 26/11/2026, sem novos high/critical. SDK SNS oficial fixado em `3.1169.0`.
- Ambiente local Node **25.1.0**; esta entrega não reivindica nova qualificação
  Node 22/Linux, restore ou CI remota. Os gates consolidados pertencem à PR-19.

Não foram consultados recursos reais AWS nem enviadas mensagens nesta PR.
A leitura de sandbox us-east-2 em 14/11 pertence à PR-07 e não atesta o estado
atual de produção. Configuração real IAM/tópico/subscription/configuration set,
teste ponta a ponta dos três cenários e aprovação regional SES continuam pendentes.
As correções de PR-09 e seguintes não foram iniciadas.

Evidência estruturada: [PR-08](evidence/pr-08-ses-feedback.json).

Referências: [assinatura SNS](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html),
[validador JS da AWS](https://github.com/aws/aws-js-sns-message-validator),
[publicação SES/SNS](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html),
[conteúdo dos eventos](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html),
[ConfirmSubscription](https://docs.aws.amazon.com/sns/latest/api/API_ConfirmSubscription.html),
[Mailbox Simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html).
