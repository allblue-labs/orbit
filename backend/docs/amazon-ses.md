# E-mails transacionais com Amazon SES

O `EmailModule` exporta `EmailService.send({ to, subject, text, html? })`. Cadastro,
confirmação, recuperação de senha, convites e notificações usam o mesmo remetente.
O SDK oficial AWS para JavaScript v3 (`@aws-sdk/client-sesv2`) está no lockfile de
produção. Node 22, já usado pelo Dockerfile, atende aos requisitos do pacote.

## Configuração

Configure no `.env` da implantação ou injete como variáveis do container da API:

```dotenv
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_SES_FROM_EMAIL=no-reply@allblue-labs.com
IDENTITY_PUBLIC_WEB_URL=https://orbit.allblue-labs.com
# Somente para credenciais temporárias:
AWS_SESSION_TOKEN=
```

Os quatro campos AWS são obrigatórios em produção. O cliente recebe credenciais
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

- Cadastro público, provisionamento pela administração e cadastro direto de equipe: depois do commit do usuário,
  gera token aleatório de 48 bytes, persiste somente SHA-256 com prazo de 24h e
  envia boas-vindas. Falha de envio é registrada e não desfaz o cadastro.
- `emailVerifiedAt` fica vazio até a confirmação. A mudança não acrescenta um
  bloqueio de login, mobile, checkout ou teste de plano. Contas antigas não são
  desverificadas; convite aceito continua sendo prova de posse do e-mail.
- O link `/confirmar-email#token=...` abre uma página pública em português. O
  fragmento não é enviado ao servidor nos acessos HTTP. Somente o botão do
  usuário chama `POST /identity/email/verify`, evitando consumo por scanners.
- Confirmação: uso único atômico no banco, validando expiração, usuário ativo e
  o mesmo endereço existente na emissão. Tokens antigos não confirmam um e-mail
  alterado posteriormente. Confirmação não altera senha, organização ou sessão.
- `POST /identity/email/resend` recebe `{ "email": "..." }` e responde 202 com
  mensagem genérica. Há intervalo mínimo de 60 segundos por usuário e limite
  por IP; reemitir invalida o link anterior. Nunca retorna tokens.
- Recuperação existente: `POST /identity/password/forgot` grava hash e expiração
  de 30 minutos antes do envio. Resposta genérica permanece igual mesmo em falha
  do provedor, evitando enumeração de contas. O reset consome uma vez e revoga
  as sessões existentes. O link HTTPS aponta ao formulário já implementado.
- SES: conexão limitada a 2s, timeout de requisição de 5s e até 3 tentativas do
  SDK para falhas elegíveis. Resultado `SENT` significa aceitação pelo provedor,
  não entrega na caixa de entrada. Não há promessa de reenvio durável automático
  além dessas tentativas: recuperação/reenvio emitem um novo token quando necessário.
- Erros específicos (rejeição, identidade não verificada, suspensão e limites)
  recebem códigos estáveis nos logs; mensagens brutas do SDK, destinatários,
  corpos, tokens e credenciais nunca são registrados. As notificações mantêm o
  registro `FAILED` em falhas de envio.

## Futuro webhook SNS: bounces e complaints

O roteiro de implementação seguro está em
`src/modules/email/ses-feedback.blueprint.ts`. Ele é deliberadamente um esqueleto,
sem controller público registrado: não existe uma rota que aceite notificações
sem autenticação da origem. Antes de habilitá-lo, implemente validação de assinatura,
allowlist do TopicArn, idempotência, supressão de envio e vínculo com a mensagem
original. Não desative usuários nem exclua dados por um simples POST externo.

Referências:
- https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
- https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html

## Validação da implementação

Foram exercitados testes direcionados do backend, 27 testes do allowlist do
frontend e três cenários no navegador, além de verificações de tipos e lint.
Em PostgreSQL temporário com `orbit_app` restrito, foram verificados RLS entre
usuários, expiração, mudança de endereço, confirmação concorrente de uso único
e recuperação de senha com revogação de sessões. Nenhum e-mail real foi enviado;
a entrega deve ser validada na conta SES após configurar as variáveis.

A dependência `nodemailer` foi removida; o achado de `proxy-addr` foi corrigido.
Ainda há nove ocorrências preexistentes em outras dependências de produção
(quatro altas e cinco moderadas), fora do transporte SES. Esta validação não
equivale a uma auditoria completa de segurança do repositório.
