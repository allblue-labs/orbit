# SES/SNS — feedback, supressão e homologação PR-08

O endpoint implementado é **POST `/api/v1/email/webhooks/ses-sns`**. Requer SNS
assinado, não sessão de usuário. Fica operacional somente com a configuração
de feedback habilitada. Este guia prepara a publicação; a implementação local
não comprova que os recursos AWS/deploy já estejam configurados.

## Variáveis e ordem de publicação

| Variável | Valor/uso |
| --- | --- |
| `AWS_REGION` | Região real do SES/SNS deste deployment; exemplos abaixo usam `us-east-2` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` opcional | Credenciais explícitas existentes; sem profile/metadata como fallback |
| `AWS_SES_FROM_EMAIL` | Remetente verificado existente |
| `EMAIL_SUPPRESSION_HASH_KEY` | **Obrigatória para o remetente em produção**, mesmo com feedback desligado. 32 bytes em base64, exclusiva desta finalidade |
| `AWS_SES_CONFIGURATION_SET` | Nome do configuration set SES que publica os eventos |
| `AWS_SES_FEEDBACK_ENABLED` | Padrão `false`; habilitar com `true` depois de preparar os recursos |
| `AWS_SES_FEEDBACK_ACCOUNT_ID` | ID de 12 dígitos da conta que envia |
| `AWS_SES_FEEDBACK_TOPIC_ARN` | ARN exato do tópico Standard, mesma conta/região |
| `AWS_SES_FEEDBACK_IDENTITY_ARN` | ARN da identidade SES realmente usada: `arn:aws:ses:REGIAO:CONTA:identity/DOMINIO` ou identidade do e-mail remetente |

Gere a chave HMAC **uma vez**, por exemplo com `openssl rand -base64 32`, e
armazene-a no secret manager/`.env` protegido; não a envie pelo chat nem a versione.
Todas as réplicas e as ferramentas de operação devem usar a mesma chave do banco.
Ambientes separados devem ter chaves/bancos/tópicos próprios. Ela não é a chave
AES dos tokens e não deve ser trocada junto de `ENCRYPTION_KEY`. Alterá-la
isoladamente torna os fingerprints antigos inencontráveis e pode contornar as
supressões; rotação requer migração aprovada com preservação da consulta anterior.
O backup deve preservar a chave junto dos metadados protegidos.

Antes de publicar o código, aplicar
`20261116120000_ses_feedback_suppression` pelo migrator e provisionar os grants
habituais. A migration é aditiva e não reenvia mensagens antigas nem altera
usuários/assinaturas. Configure a chave no runtime antes de iniciá-lo: ausência ou
formato inválido bloqueia o startup de produção. O inicializador de staging gera
a chave somente para ambientes novos e não sobrescreve `.env` existente.

Para upgrade, mantenha a chave e as tabelas no rollback. Uma versão antiga pode
ignorar supressões: não retome envios com aquele remetente durante rollback sem
controle equivalente. Desligar apenas `AWS_SES_FEEDBACK_ENABLED` pausa o receptor,
mas **não** remove/bypassa as supressões já persistidas.

## Configurar a AWS

Use uma identidade/tópico dedicados ao Orbit e a este ambiente. Para homologação,
utilize exclusivamente os destinatários do Mailbox Simulator.

1. No **SES**, na região selecionada, abra **Configuration sets**, crie/selecione
   um set e adicione um **Event destination** habilitado de tipo **Amazon SNS**.
   Selecione eventos **Bounce, Complaint e Delivery**; não habilite headers/corpo,
   tracking de abertura/clique ou outros dados desnecessários para este fluxo.
   O destinatário deve ser um tópico **Standard** (SES não suporta FIFO).
   [Procedimento oficial SES](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html).
2. Em **SNS → Topics**, configure **SignatureVersion = 2** antes de criar a
   subscription. O padrão SNS é v1 e será recusado pelo Orbit. Se o painel não
   expuser o atributo, um administrador pode executar:

   ```sh
   aws sns set-topic-attributes --region us-east-2 \
     --topic-arn ARN_DO_TOPICO \
     --attribute-name SignatureVersion --attribute-value 2
   ```

   Esse comando altera o tópico e deve ser executado pelo responsável autorizado,
   não pelo preflight. [Configuração oficial de assinatura](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-configure-message-signature.html).
3. A política do tópico deve permitir publicação pelo **SES**, limitada à conta e
   ao configuration set. Exemplo a adaptar (não cole IDs fictícios no runtime):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Sid": "AllowOrbitSesFeedback",
       "Effect": "Allow",
       "Principal": {"Service": "ses.amazonaws.com"},
       "Action": "sns:Publish",
       "Resource": "arn:aws:sns:us-east-2:123456789012:orbit-feedback-staging",
       "Condition": {"StringEquals": {
         "AWS:SourceAccount": "123456789012",
         "AWS:SourceArn": "arn:aws:ses:us-east-2:123456789012:configuration-set/orbit-feedback-staging"
       }}
     }]
   }
   ```

   O `SourceArn` da **política de publicação** é o configuration set; a env
   `AWS_SES_FEEDBACK_IDENTITY_ARN` identifica a identidade remetente e é outro ARN.
   Preserve a administração autorizada do tópico e revise permissões adicionais:
   não permita publicadores anônimos/outros aplicativos; a identidade runtime
   não precisa de `sns:Publish` nem `sns:Subscribe`. Assinatura SNS autentica o
   serviço/tópico, portanto a política de quem pode publicar faz parte do trust.
4. Dê ao runtime `sns:ConfirmSubscription` apenas no ARN desse tópico. Exemplo
   complementar à política de envio SES já existente:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "sns:ConfirmSubscription",
       "Resource": "arn:aws:sns:us-east-2:123456789012:orbit-feedback-staging"
     }]
   }
   ```

   Mantenha `ses:SendEmail` limitado ao remetente/identidade e ao configuration
   set quando exigido pela política de envio. Nenhuma permissão de exclusão de
   usuário, `ses:*`, `sns:*` ou alteração da lista de supressão AWS é necessária.
5. Publique a API com as envs completas e `AWS_SES_FEEDBACK_ENABLED=true`.
   Só depois crie a **subscription HTTPS** para:

   ```text
   https://orbit.allblue-labs.com/api/v1/email/webhooks/ses-sns
   ```

   Use o host real deste deployment, **RawMessageDelivery=false** e envelope SNS.
   A API verifica a assinatura e confirma pelo SDK com
   `AuthenticateOnUnsubscribe=true`. Não faz GET em SubscribeURL/UnsubscribeURL.
   Confira que a subscription saiu de Pending confirmation. Nenhum cookie/JWT
   do owner deve ser configurado no endpoint. Se houver Cloudflare Access/WAF,
   o POST dessa rota deve chegar ao backend sem challenge de navegador; mantenha
   as demais proteções e não libere o site inteiro.
6. Ative delivery-status logging do SNS e uma DLQ SQS para falhas da subscription,
   com política de acesso restrita e alarmes. Mensagens em DLQ podem conter PII:
   não copie o corpo para issues/logs do produto. Confirme que o destino SES está
   habilitado e aponta ao tópico certo; configurar só o tópico não publica eventos.

O remetente envia `ConfigurationSetName` e a tag opaca `orbit_delivery_id`.
Notificações antigas por identidade sem tags só são aceitas se o SES MessageId
já estiver registrado. Eventos autênticos de outros emissores/envios desconhecidos
não podem suprimir usuários por coincidência de endereço.

## Homologação com Mailbox Simulator

O comando abaixo usa o **EmailService do Orbit** e registra o envio antes de
chamar o SES. Executa um contexto sem HTTP listener ou workers de identidade/jobs;
não drena a fila de clientes. Aceita somente `success`, `bounce` e `complaint`,
com rótulo UUID exclusivo em `simulator.amazonses.com`. Não aceita destinatário
arbitrário. O simulador funciona também na sandbox e aceita rótulos para repetir
os ensaios. [Mailbox Simulator oficial](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html).

Após configurar/publicar em staging, com envs e banco desse ambiente:

```sh
# Somente forma/configuração local: não envia nem acessa a rede.
npm run email:feedback:simulate:dev -- bounce

# Envio explicitamente autorizado ao simulador e espera bounded de até 30s.
npm run email:feedback:simulate:dev -- success --send
npm run email:feedback:simulate:dev -- bounce --send
npm run email:feedback:simulate:dev -- complaint --send

# Imagem compilada, usando as envs do runtime:
docker compose exec -T api node dist/src/scripts/simulate-ses-feedback.js bounce --send
```

O dry-run exit 0 valida somente a configuração. Com `--send`, o script primeiro
informa ACCEPTED_BY_PROVIDER; depois exige feedback persistido no banco. Em bounce
e complaint, também verifica que outra tentativa é bloqueada por EMAIL_SUPPRESSED.
Somente FEEDBACK_CONFIRMED qualifica aquele cenário. Exit 2/AWAITING_SNS significa
que a confirmação não chegou dentro de 30s, não que o SNS necessariamente falhou
definitivamente. Exit 1 indica configuração/envio/estado não confirmado.

Não use **Send test email** do console para qualificar este vínculo: esse envio
externo não está no ledger da aplicação e será considerado não associado. O
simulador não substitui o aceite de envio geral fora da sandbox. Não execute os
comandos desta seção em produção sem autorização específica. Nesta PR, nenhum
teste real na AWS foi executado; a homologação permanece pendente do responsável.

## Garantias e diagnóstico

- Corpo limitado a 256 KiB durante leitura, sem descompressão. Text/plain e JSON
  funcionam; somente Notification/SubscriptionConfirmation/UnsubscribeConfirmation
  assinados em v2 são considerados.
- Certificado somente de HTTPS SNS regional com caminho PEM permitido; DNS deve
  resolver endereços públicos, conexão usa IP fixado e hostname/CA TLS verificados,
  sem redirects. PEM limitado a 64 KiB, deadline total de 5s, RSA ≥2048 e validade
  X.509 conferidos. Cache de 16 certificados/até 1h e quatro fetches simultâneos.
  A confiança no PEM vem da distribuição HTTPS autenticada do SNS, como no
  validador JS da AWS; não é aceito PEM fornecido pelo callback.
- TopicArn, conta, região, identidade, remetente, destino e MessageId/tag são
  verificados. O corpo nunca seleciona tenant, conexão, endpoint ou privilégio RLS.
- Notification é persistida junto das supressões/associações no mesmo commit.
  Duplicata idêntica recebe 200; mesmo ID com conteúdo assinado diferente recebe
  409. Mensagem alterada/tópico estrangeiro recebem recusa sem efeitos. Uma 2xx
  nunca precede a persistência confirmada.
- Falha transitória/associação ainda desconhecida recebe 503 para retry SNS.
  Não se dá ACK em feedback que poderia ter chegado antes do retorno SES. O tag
  permite resolver a tentativa pré-gravada; múltiplos MessageIds aceitos por retry
  do SDK permanecem associados à mesma tentativa, sem confundir envios diferentes.
- Hard bounce/complaint suprimem todos os destinatários afetados **conhecidos**.
  Soft/Undetermined bounce não bloqueia. Delivery ou not-spam não removem uma
  supressão anterior; não há endpoint público para consultar/liberar endereços.
- O remetente consulta a supressão em cada nova admissão, mesmo com receptor
  desligado. Falha do banco impede o envio, em vez de ignorar o bloqueio. Chamadas
  já admitidas/em trânsito não podem ser recolhidas. Não há garantia exactly-once
  de SendEmail: um crash pode repetir o mesmo e-mail, mas os IDs são correlacionáveis.
- Identidade suprimida termina a outbox com FAILED/EMAIL_SUPPRESSED sem retry;
  notificação e-mail fica SKIPPED/ses-suppressed. In-app, login, senha, contratos
  e dados do tenant não são removidos ou desativados por feedback.
- Ledger, associações de IDs, eventos e supressões têm FORCE RLS, contexto próprio
  e DELETE revogado ao runtime. Guardam HMACs/IDs/códigos/datas, sem endereços,
  conteúdo, links ou tokens. HMAC é pseudonimização, não dado público; proteger
  o banco/chave/backups. Não apagar tombstones para "resolver" um retry.

Logs seguros: `ses_feedback` com estágio/resultado/kind/SNS ID opaco;
`ses_feedback_rejected` com código/status; `SNS_SUBSCRIPTION_UNSUBSCRIBED` exige
intervenção do operador e não dispara resubscribe automático. Certificado/rede,
DB e IAM indisponíveis devem ser corrigidos antes de reentregar. Token de confirmação
expirado pode exigir recriar a subscription pelo responsável, sem coletar seu valor
no chat. Unassociated persistente exige investigar se o envio passou pelo Orbit,
se o configuration set/tag foram usados e se conta/identidade/envs são as corretas.

Não registra payload/endereços nem erro bruto de SDK/ORM. A lista local independe
da suppression list da AWS e não a modifica. PrivateLink/GovCloud/China não estão
qualificados neste perfil comercial público. Políticas de retenção/reprocessamento
devem preservar a supressão e a identidade durável dos eventos durante operação
e backup/restore; não há saneamento destrutivo automático nesta PR.

Referências de segurança: [assinaturas SNS](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html),
[conteúdo SES](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html),
[ConfirmSubscription](https://docs.aws.amazon.com/sns/latest/api/API_ConfirmSubscription.html).
