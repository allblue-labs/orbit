# E-mails transacionais com Amazon SES

O `EmailModule` exporta `EmailService.send({ to, subject, text, html? })`. O catálogo de comunicações de conta atende exclusivamente o **primeiro owner**,
com procedência positiva de cadastro público ou do provisionamento administrativo
canônico. Cadastro/convite de equipe, mesmo com e-mail real, não dispara esses e-mails.
Notificações operacionais continuam na central e no push; textos genéricos de
notificação não são encaminhados por e-mail.
O SDK oficial AWS para JavaScript v3 (`@aws-sdk/client-sesv2`) está no lockfile de
produção. Node 22, já usado pelo Dockerfile, atende aos requisitos do pacote.

## Configuração

Configure no `.env` da implantação ou injete como variáveis do container da API:

```dotenv
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-2
AWS_SES_FROM_EMAIL=no-reply@allblue-labs.com
# Gerar uma vez: openssl rand -base64 32. Preservar entre réplicas/backups.
EMAIL_SUPPRESSION_HASH_KEY=
IDENTITY_PUBLIC_WEB_URL=https://orbit.allblue-labs.com
# Somente para credenciais temporárias:
AWS_SESSION_TOKEN=
# Controle do consumidor: a fila continua sendo gravada durante a pausa.
ACCOUNT_EMAIL_DELIVERY_ENABLED=true
```

Os quatro campos AWS e a chave dedicada `EMAIL_SUPPRESSION_HASH_KEY` são
obrigatórios em produção. A chave de supressão deve conter 32 bytes em base64;
consulte o [guia de feedback PR-08](amazon-ses-feedback.md) antes do upgrade. O cliente recebe credenciais
explicitamente dessas variáveis; não lê `~/.aws`, AWS_PROFILE ou metadata de EC2.
Nunca use `NEXT_PUBLIC_*`, não inclua segredos em imagens e não versione `.env`.
Os slots criados no `.env` da raiz estão vazios; valores preexistentes foram
preservados. Eles não representam a configuração de produção.

O Amazon SES é o único transporte de envio, sem seletor `EMAIL_PROVIDER`.
Em produção, a API recusa a inicialização se faltar algum campo AWS obrigatório.
Somente com `NODE_ENV=test` o envio é desativado automaticamente para que a suíte
não envie mensagens reais. Desenvolvimento também utiliza SES; configure uma
identidade de testes para exercitar entregas reais.

### Erro de inicialização em `AWS_REGION`

O campo recebe somente o **código** da região, por exemplo `sa-east-1` para
São Paulo ou `us-east-1` para Norte da Virgínia. Use o código da região em que
a identidade do SES foi verificada; o texto descritivo mostrado no console e
o endereço do endpoint não são valores válidos para essa variável.
Consulte a [lista oficial de regiões do SES](https://docs.aws.amazon.com/general/latest/gr/ses.html).

Após ajustar o `.env` ou a variável na plataforma de implantação, recrie a API
para carregar o ambiente novo (um simples `restart` mantém o ambiente anterior):

```sh
docker compose up -d --no-deps --force-recreate api
```

Para conferir **somente a região**, mesmo quando o container estiver reiniciando:

```sh
docker compose run --rm --no-deps --entrypoint node api -e 'console.log(JSON.stringify({ AWS_REGION: process.env.AWS_REGION }))'
```

Esse comando não imprime access key, secret ou demais variáveis. O log de erro
de configuração também nunca inclui os valores recebidos.

Se um código válido, como `us-east-2`, continuar sendo recusado, confira também
o valor do **container existente**, que pode diferir do ambiente usado ao criar
um novo container. Este comando imprime somente `AWS_REGION`, com aspas e
escapes para identificar caracteres inesperados:

```sh
docker inspect $(docker compose ps -aq api) --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "AWS_REGION"}}{{printf "%q" .}}{{end}}{{end}}'
```

Confira a validação realmente compilada na imagem disponível ao Compose:

```sh
docker compose run --rm --no-deps --entrypoint node api -e 'const s=require("node:fs").readFileSync("dist/src/release-environment.js","utf8"); console.log(s.split("\n").find(l=>l.includes(".test(")&&l.includes("region")))'
```

`us-east-2` é aceito pela validação atual. Esses diagnósticos ajudam a distinguir
um valor diferente no container de uma imagem com código diferente do checkout.

## Configuração na AWS

1. Abra o console SES na **mesma região** de `AWS_REGION`. Em **Verified identities**,
   crie uma identidade do domínio `allblue-labs.com` e publique os registros DKIM
   exibidos pela AWS no DNS. Aguarde a identidade aparecer como verificada.
2. Use um remetente desse domínio em `AWS_SES_FROM_EMAIL`. Verifique também a
   configuração SPF/MAIL FROM e DMARC do domínio segundo a documentação do SES.
3. Em **Account dashboard**, confira o acesso de produção. No sandbox, o SES só
   envia para identidades verificadas ou para o Mailbox Simulator. Solicite
   **Request production access** para enviar aos clientes reais.
4. No IAM, configure uma identidade com a menor permissão necessária. Exemplo
   ilustrativo: substitua região, conta e domínio; não conceda `ses:*`.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ses:SendEmail",
    "Resource": "arn:aws:ses:us-east-1:123456789012:identity/allblue-labs.com",
    "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@allblue-labs.com" } }
  }]
}
```

5. Crie/injete a access key e secret correspondentes no ambiente da API. Para
   credenciais temporárias, inclua `AWS_SESSION_TOKEN`. Mantenha rotação de chaves.
6. Publique API e frontend e aplique a migração `20261110150000_email_verification`
   pelo migrador habitual, antes de atender tráfego com a nova API. A função
   `app_confirm_email` deve pertencer ao papel confiável de migração, como as
   demais funções de identidade; a API continua com o papel restrito `orbit_app`.

No Compose deste repositório, após configurar o ambiente e os metadados habituais
da release:

```sh
docker compose build api migrate frontend
docker compose run --rm migrate
docker compose up -d api frontend
```

Referências oficiais:
- SDK: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/command/SendEmailCommand/
- Identidades: https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html
- Sandbox: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- Permissões: https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html

## Fluxos e garantias

- Cadastro público do owner inicial: usuário, vínculo de procedência, hash de verificação (token aleatório de 48 bytes, prazo de 24h) e intenção
  de e-mail cifrada são gravados na mesma transação. O HTTP não chama SES.
  Uma falha no SES não desfaz a conta; falha de persistência na fila desfaz toda a
  transação, evitando uma conta criada sem a comunicação correspondente.
- O provisionamento administrativo canônico preserva o e-mail de configuração inicial
  do primeiro owner, com vínculo validado pela operação de provisionamento. Não se
  estende a membros de equipe, novos papéis OWNER ou organizações secundárias.
- `emailVerifiedAt` fica vazio até a confirmação. Owners iniciais registrados em `account_email_owners` precisam confirmar o
  endereço antes de autenticar. Cadastro público não emite tokens nem sessão.
  Login, refresh e API autenticada consultam o estado atual e recusam um owner
  não confirmado com `EMAIL_VERIFICATION_REQUIRED` em pt-BR. Operadores/usuários
  internos sem esse vínculo continuam com seu fluxo próprio de acesso. Contas
  confirmadas não são desverificadas; convites não confirmam um owner existente.
- O link `/confirmar-email#token=...` abre uma página pública em português. O
  fragmento não é enviado ao servidor nos acessos HTTP. Somente o botão do
  usuário chama `POST /identity/email/verify`, evitando consumo por scanners.
- Confirmação: uso único atômico no banco, validando expiração, usuário ativo e
  o mesmo endereço existente na emissão. Tokens antigos não confirmam um e-mail
  alterado posteriormente. Confirmação não altera senha, organização ou sessão.
- `POST /identity/email/resend` recebe `{ "email": "..." }` e responde 202 com
  mensagem genérica. Há intervalo mínimo de 60 segundos por usuário, teto de cinco mensagens
  desse propósito em 24 horas e limite por IP; somente uma reemissão permitida
  invalida o link anterior. Nunca retorna tokens.
- Recuperação existente: `POST /identity/password/forgot` grava hash, expiração
  de três horas e intenção de envio na mesma transação. A resposta genérica em
  português permanece igual para conta inexistente e falha ao enfileirar,
  evitando enumeração de contas. O reset consome uma vez e revoga
  as sessões existentes. Há intervalo de 60 segundos enquanto o último link continua
  válido e não usado, e teto de cinco e-mails desse propósito em 24 horas.
  O link HTTPS aponta ao formulário já implementado. Links novos de confirmação,
  recuperação e convite transportam o token em `#token=`, sem query no GET.
  O frontend mantém compatibilidade com links legados, retira o token da URL
  após capturá-lo em memória e aplica `Referrer-Policy: no-referrer` nessas páginas.
  Antes de mostrar o formulário, a web valida o token por
  `POST /identity/password/reset/validate` (204 válido; 400
  `PASSWORD_RESET_INVALID` para inexistente, usado ou expirado). Essa consulta
  não consome o link e recebe os mesmos limites de autenticação. Consumo usa
  uma atualização condicional atômica e o relógio do PostgreSQL; mesmo links
  legados com `expires_at` maior deixam de valer três horas após a emissão.
  O primeiro consumo salva a senha e revoga sessões na mesma transação.
  A página remove o formulário após sucesso e mostra confirmação definitiva.

- SES: conexão limitada a 2s, timeout de requisição de 5s, prazo total de 15s
  e uma tentativa do SDK. A fila controla as novas tentativas para evitar
  multiplicação de retries. Resultado `SENT` significa aceitação pelo provedor,
  não entrega na caixa de entrada. Para identidade, a outbox durável acrescenta
  até seis tentativas com backoff, reaproveitando o mesmo token enquanto válido.
  Antes de cada envio, reconfere conta/e-mail, uso, expiração e token atual;
  reemissão, revogação e exclusão impedem tentativas tardias. Falhas permanentes
  não são repetidas automaticamente. O registro de aceitação usa
  `ACCEPTED_BY_PROVIDER`, não um comprovante de recebimento.
- Erros específicos (rejeição, identidade não verificada, suspensão e limites)
  recebem códigos estáveis nos logs; mensagens brutas do SDK, destinatários,
  corpos, tokens e credenciais nunca são registrados. As notificações mantêm o
  registro `FAILED` em falhas de envio.

## Outbox de identidade e preflight (PR-07)

A migration `20261114180000_identity_email_outbox` cria a fila privada. O worker
usa `JOBS_WORKER_ENABLED` e `JOBS_POLL_INTERVAL_MS` existentes. Manter ao menos uma
réplica com worker ativo e a mesma `ENCRYPTION_KEY` nas réplicas: ela protege os
segredos pendentes em AES-256-GCM. Não rotacioná-la isoladamente com trabalho
pendente. O payload recuperável é removido quando a entrega termina (aceita,
ignorada ou falha permanente); os metadados do resultado permanecem sem o link.
A RLS da fila não permite leitura em requisições normais.

Reenvios elegíveis gravam token e mensagem juntos. Convites e cadastros de equipe
continuam com os links manuais existentes, sem fila de e-mail para endereços
fictícios. O vínculo `account_email_owners` não pode ser inserido/alterado pelo
papel HTTP diretamente; funções guardadas validam a procedência. A fila usa unicidade
por propósito/hash, `SKIP LOCKED`, lease de cinco minutos e conclusão condicionada
à lease para impedir que uma réplica antiga altere a entrega reivindicada por outra.
O backoff é de 5s, 10s, 20s, 40s e 80s, limitado a seis tentativas do worker.
Um recibo de aceitação já persistido é reaproveitado por entrega lógica, inclusive
quando a fila perde o ACK. Uma falha de rede/commit sem recibo observável ainda
pode repetir o mesmo e-mail: a API SES
SendEmail não oferece chave de idempotência. O link continua de uso único;
não se promete exactly-once nem se cria outra conta/token a cada retry.

Para conferir a configuração local:

```sh
cd backend
npm run email:check:dev
```

Para consultar a AWS sem enviar e-mails:

```sh
npm run email:check:dev -- --remote
# No contêiner da API compilada:
node dist/src/scripts/check-ses-config.js --remote
```

A consulta usa `GetAccount` e `GetEmailIdentity` na região configurada, verifica
identidade (inclusive domínio pai), envio habilitado e quotas. Produz `READY`,
`SANDBOX` ou `BLOCKED`. Código de saída 0: configuração local válida ou consulta
remota pronta; 2: consulta remota em sandbox/bloqueada; 1: erro/configuração/IAM.
**A validação local não comprova acesso de produção.** Não existe flag para
simular aprovação da AWS. A consulta remota depende das permissões de leitura:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:GetAccount",
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "us-east-2" } }
    },
    {
      "Effect": "Allow",
      "Action": "ses:GetEmailIdentity",
      "Resource": "arn:aws:ses:us-east-2:SEU_ACCOUNT_ID:identity/*"
    }
  ]
}
```

Ajustar região e ID da conta. Essas permissões não substituem `ses:SendEmail`;
a identidade e a condição `ses:FromAddress` do remetente continuam restritas
conforme a política de envio acima. Podem ser concedidas apenas à identidade IAM
que executará o preflight, se a conta de envio permanecer limitada a `SendEmail`.

A saída da sandbox é regional e continua sendo uma ação da AWS. Na sandbox,
testar somente destinatários verificados ou o mailbox simulator, com acordo do
responsável. Após aprovação, executar novamente o preflight e realizar teste real.
Falhas permanentes antigas não são reabertas: solicitar um link novo. O worker
continua independente de uma consulta remota por e-mail; indisponibilidade do
preflight não bloqueia requisições de cadastro/recuperação.

## Webhook SNS e supressão — PR-08

Implementado `POST /api/v1/email/webhooks/ses-sns`, com assinatura SNS v2,
tópico/conta/região/identidade esperados, associação a envio conhecido,
persistência idempotente e supressão de hard bounce/complaint. O blueprint
foi substituído pela implementação. Não há exclusão/desativação de contas.

**Antes da nova API:** aplicar a migration de feedback e configurar
`EMAIL_SUPPRESSION_HASH_KEY` (32 bytes em base64, própria e estável), mesmo se
`AWS_SES_FEEDBACK_ENABLED=false`. O remetente sempre consulta as supressões.
Não reutilizar/rotacionar essa chave junto de `ENCRYPTION_KEY`.

Configuração AWS, permissões, novas envs, assinatura v2 e comando de homologação
estão no [guia SES/SNS](amazon-ses-feedback.md). O preflight local agora também
valida a chave de supressão; o preflight remoto continua sendo consulta SES,
não comprovação de entrega/assinatura do SNS.

Referências:
- https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
- https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html

## Validação histórica da integração inicial

Foram exercitados testes direcionados do backend, 27 testes do allowlist do
frontend e três cenários no navegador, além de verificações de tipos e lint.
Em PostgreSQL temporário com `orbit_app` restrito, foram verificados RLS entre
usuários, expiração, mudança de endereço, confirmação concorrente de uso único
e recuperação de senha com revogação de sessões. Nenhum e-mail real foi enviado;
a entrega deve ser validada na conta SES após configurar as variáveis.

A dependência `nodemailer` foi removida; o achado de `proxy-addr` foi corrigido.
Naquela revisão inicial havia nove ocorrências preexistentes em outras dependências de produção
(quatro altas e cinco moderadas), fora do transporte SES. Esta validação não
equivale a uma auditoria completa de segurança do repositório. Para a qualificação
atual, consultar os relatórios de release PR-01 em diante, incluindo a PR-08.

## Catálogo e frequência — ativação de produção (2026-11-17)

| Modelo | Gatilho e proteção |
| --- | --- |
| Boas-vindas + confirmação | Uma mensagem no cadastro inicial; token de 24h. Não há disparo retroativo na migration. |
| Confirmação de e-mail | Reenvio solicitado, até cinco por 24h e intervalo de 60s. |
| Redefinição de senha | Solicitação do owner inicial; token de 30min e limites próprios de reenvio. |
| Senha alterada | Após a troca efetiva, na mesma transação; até cinco por 24h e intervalo de uma hora. Sem senha ou hash no conteúdo. |
| Plano expirado e não reativado | Owner verificado; entre 24h e sete dias após a perda efetiva do acesso, sem checkout aberto. Um aviso por vencimento. |
| Limites do plano | Owner verificado; um aviso consolidado por assinatura/plano/período mensal/alteração de limites. Cadastros precisam ultrapassar o teto; consumo positivo precisa atingir o teto. |

Avisos de plano compartilham teto de dois envios por owner em 24h e intervalo de
uma hora por propósito. A fila tem unicidade durável por evento, trava por owner
e reconfere o estado antes de enviar: reativação/adequação elimina avisos antigos.
Somente a organização original é considerada. A varredura percorre páginas de
25 owners, até quatro páginas por ciclo de um minuto, com orçamento de 20s entre
páginas. Não há campanhas, rastreamento de abertura ou cliques.

As configurações em banco e as filas existentes usam migrations normais. Aplicar
todas as migrations e o provisionamento de papéis antes de iniciar a API nova;
`provision-database-roles` preserva a revogação de escrita da tabela de procedência.
Não modificar o baseline congelado de integridade PR-12.

### Preparação SES/SNS do staging

O comando operador abaixo cria/atualiza apenas o tópico e o configuration set
`orbit-feedback-staging` em `AWS_REGION`. O modo padrão exibe o plano sem mudar a
AWS. `--apply` prepara os recursos; `--subscribe` solicita a assinatura HTTPS
somente depois que a API nova estiver saudável.

```sh
node dist/src/scripts/configure-ses-staging.js
node dist/src/scripts/configure-ses-staging.js --apply
node dist/src/scripts/configure-ses-staging.js --apply --subscribe
```

O provisionador requer `sns:CreateTopic`, `sns:GetTopicAttributes`,
`sns:SetTopicAttributes`, `sns:TagResource`, `sns:Subscribe`,
`ses:CreateConfigurationSet`, `ses:CreateConfigurationSetEventDestination` e
`ses:UpdateConfigurationSetEventDestination`, limitados aos recursos de staging
e à região. São permissões de implantação; o processo HTTP precisa apenas de
`ses:SendEmail` e `sns:ConfirmSubscription` no tópico autorizado, além das
permissões de leitura se executar preflight. Não conceder `iam:*` ou administrar
políticas pelo aplicativo. Se houver AccessDenied, o administrador deve ajustar
a identidade de implantação no console e repetir somente a operação necessária.

O provisionador consulta a identidade verificada mais específica: e-mail antes
do domínio e de seus pais. Usa a mesma resolução do preflight, sem presumir um
ARN de domínio quando uma identidade EMAIL_ADDRESS já existe. A validação de
identidade do webhook continua exata, sem wildcard nem confiança no payload.

O JSON de resultado contém apenas metadados de implantação. Configure
`AWS_SES_CONFIGURATION_SET`, `AWS_SES_FEEDBACK_ENABLED=true`,
`AWS_SES_FEEDBACK_ACCOUNT_ID`, `AWS_SES_FEEDBACK_TOPIC_ARN` e
`AWS_SES_FEEDBACK_IDENTITY_ARN` segundo o resultado. A política SNS restringe a
publicação ao SES da mesma conta e ao ARN desse configuration set.
Consulte os testes de bounce/complaint e assinatura no [guia SNS](amazon-ses-feedback.md).

### Teste real solicitado pelo administrador

```sh
node dist/src/scripts/check-ses-config.js --remote
node dist/src/scripts/send-email-preview.js --to=darlansimplicio@gmail.com --send
```

O preview envia **duas mensagens**: uma prévia combinada dos seis modelos e uma
confirmação simples da integração. Não cria conta, não altera senha/plano, não
emite tokens e não consome a fila dos clientes. Não repetir automaticamente em
uma falha ambígua; conferir primeiro os recibos. `SENT` comprova aceitação pelo
SES; `DELIVERY` no SNS comprova aceitação pelo servidor do destinatário, sem
comprovar caixa principal, leitura ou ausência de spam.

Durante a qualificação, usar `ACCOUNT_EMAIL_DELIVERY_ENABLED=false`. Habilitar
após migrations, preflight, revisão dos pendentes e teste real. Manter
`SUBSCRIPTION_DATA_RETENTION_ENABLED=false` no staging até qualificar as
credenciais de purge do CDN e os requisitos de backup/legado da PR-13. Essa
pausa da exclusão é independente do envio de e-mails e não simula aprovação da AWS.

Referências: [publicação SNS por configuration set](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html),
[erros e ambiguidade de timeout do SES](https://docs.aws.amazon.com/ses/latest/dg/troubleshoot-error-messages.html).

## Cadastro pendente e endereço da matriz

`POST /identity/register` responde 201 com `{status: "EMAIL_VERIFICATION_REQUIRED",
email: "endereco-normalizado"}`. Não retorna accessToken/refreshToken nem cria
sessão. O BFF responde `authenticated:false`, remove cookies de sessão antigos
e publica somente status/e-mail, sem repassar propriedades arbitrárias da API.
O wizard mostra a orientação para confirmar/reemitir o link sem abrir checkout.
Após confirmar explicitamente, o usuário entra com sua senha; o fluxo já existente
continua o plano escolhido (teste elegível ou pagamento pendente).

A confirmação é exigida também de owners originais já existentes e ainda não
confirmados. Um token assinado antigo não preserva acesso: guard e refresh
revogam a sessão quando a confirmação está pendente. Recuperar senha ou aceitar
um convite manual não confirma o endereço de um owner já existente. Não há
exceção de domínio, papel ou NODE_ENV para ignorar essa verificação.

Número (`number`, até 30 caracteres) e complemento (`complement`, até 160) são
opcionais no endereço do cadastro e persistem na unidade matriz. Valores vazios
viram null; espaços externos são removidos. CEP continua preenchendo rua/cidade/UF,
sem inventar número/complemento. As colunas já existem; não há migration nova.

## Identidade visual nos e-mails

Todos os seis templates transacionais incluem os símbolos Allblue Labs e Orbit
com texto alternativo, além da versão em texto simples. As imagens PNG são
anexadas inline (`ContentDisposition: INLINE`, `ContentId` + `cid:`) pela API
SESv2. Não há imagem externa, URL rastreável nem dependência do domínio CDN.
As versões otimizadas em `backend/assets/email` são derivadas de
`allblue-logo.png` e `orbit_logo.png` da raiz. Para regenerá-las:

```sh
node backend/scripts/prepare-email-branding.cjs
```

A imagem Docker já copia `assets` para o runtime. Nenhuma env, bucket, política
IAM nem migration adicional é necessária para a marca ou a nova validade.

Referências: [anexos inline no SES](https://docs.aws.amazon.com/ses/latest/dg/attachments.html)
e [recuperação de senha OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
