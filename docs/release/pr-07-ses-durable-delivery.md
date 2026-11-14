# PR-07 — SES durável e prontidão regional

Achados: **F10** e a parte de prontidão do **F11**, base `9ff971b`.
Implementação local, sem push, deploy ou envio de e-mails reais.
A aprovação externa da AWS e a recepção real continuam sendo aceites separados.
Bounce/complaint e supressão permanecem na PR-08.

## Comportamento

O cadastro público, o provisionamento administrativo e a criação de membro gravam
usuário, token de verificação e intenção de boas-vindas na mesma transação.
Recuperação de senha, link emitido pelo owner, convites e reenvios também gravam
hash/prazo e intenção juntos. Nenhum desses pedidos HTTP chama o SES. Uma falha
no provedor não transforma uma conta já criada em um erro de cadastro; falha ao
persistir a outbox desfaz o conjunto. A recuperação responde de forma neutra,
inclusive se não conseguir gravar a intenção, sem destruir o token anterior.

`identity_email_deliveries` usa AES-256-GCM com a `ENCRYPTION_KEY` existente para
cifrar destinatário/token e vincular o conteúdo ao ID e metadados da entrega.
Requisições não leem a fila, nem mesmo no próprio tenant; a RLS admite gravação
no escopo declarado e reserva claim/conclusão ao contexto específico do worker.
Esse contexto não abre nenhuma tabela de negócio. Hashes e segredos não entram
na resposta HTTP, jobs genéricos ou logs. O link de senha retornado explicitamente
ao gestor autorizado continua sendo o entregável intencional daquele endpoint.

O worker usa unicidade propósito/hash, claim com `FOR UPDATE SKIP LOCKED`, lease
de cinco minutos e conclusão condicionada à lease atual. Falhas transitórias
retornam à fila com backoff (5s, 10s, 20s, 40s, 80s), até seis tentativas além do
retry interno limitado do SDK. Falhas permanentes terminam sem retry. A cópia
cifrada recuperável é removida nos estados terminais; código de resultado e ID SES
são preservados para auditoria e integração posterior com SNS.

Antes de cada tentativa, consulta token atual, expiração, uso, conta/e-mail ativos
e convite pendente na organização correta. Links substituídos, usados, vencidos
ou revogados são descartados; não se gera outro token a cada retry. Isso não
recolhe uma mensagem já em trânsito se o estado mudar durante o envio.

O resultado interno `SENT` do transporte é mapeado para `ACCEPTED_BY_PROVIDER`,
sem afirmar recebimento na caixa postal. SES SendEmail não tem idempotency key:
se o processo cair depois de a AWS aceitar e antes do commit, pode haver reenvio
do mesmo e-mail. O link continua de uso único e o cadastro não é repetido.
Na emissão de senha pela equipe, a web agora informa **e-mail na fila**.

## Preflight

`npm run email:check:dev` valida somente configuração local.
`npm run email:check:dev -- --remote` consulta `GetAccount` e `GetEmailIdentity`,
sem enviar mensagens ou alterar a conta. Na imagem compilada:
`node dist/src/scripts/check-ses-config.js --remote`.

Verifica região, identidade do remetente (incluindo herança de domínio), envio
habilitado, quotas completas e produção/sandbox segundo a resposta real da AWS.
Não adiciona flag para simular saída da sandbox. Resultado `READY`: exit 0;
`SANDBOX`/`BLOCKED`: exit 2; erro ou IAM: exit 1 com código limitado, sem erro bruto.
As permissões adicionais de leitura estão no [guia SES](../../backend/docs/amazon-ses.md).

## Publicação e operação

1. Aplicar `20261114180000_identity_email_outbox` com o migrator/provisionamento de
   grants habituais e publicar API e web atualizadas. A migration é aditiva; não
   cria entregas para tokens antigos nem reenvia mensagens anteriores.
2. Manter `JOBS_WORKER_ENABLED=true` em ao menos uma réplica. A fila de identidade
   compartilha essa flag e a cadência existente, mas não força escopo de tenant em
   recuperação pública. Não exige Redis, nova credencial ou nova flag AWS.
3. Preservar `ENCRYPTION_KEY` entre réplicas e backups. Trocar apenas essa chave
   com trabalho pendente torna os envelopes ilegíveis; erros de decifração terminam
   sem divulgar nem tentar enviar o segredo. Planejar rotação junto dos dados.
4. Executar o preflight remoto com IAM de leitura. A autorização para produção
   é regional. Enquanto em sandbox, teste real só com destinatário verificado ou
   mailbox simulator, com o responsável. Não prometer envio geral antes da aprovação.
5. Acompanhar `identity_email_delivery` por ID, propósito, tentativa, estado e código,
   além de `identity_email_worker_failed`. Os registros não incluem endereço/link.
   Falhas terminais não voltam à fila automaticamente após corrigir IAM/sandbox:
   solicitar novo convite, recuperação ou confirmação para emitir um link vigente.

Rollback de API pode deixar a tabela aditiva. Não apagar a fila ou a chave durante
rollback; retomar o worker atualizado para mensagens ainda vigentes. O código antigo
pode enviar sincronicamente e reemitir um token, portanto validar a elegibilidade ao
retomar continua necessário.

## Validação

O E2E usa PostgreSQL descartável, papel restrito sujeito à RLS e duas instâncias
Nest. A substituição fica apenas na fronteira do transporte, sem acesso SES real.
Cobre rollback de cadastro, persistência cifrada, retomada de lease abandonada,
concorrência/idempotência, backoff, erro permanente, recuperação neutra, rollback
de substituição, token expirado/usado/trocado, conta desativada e convite revogado.
Também confere que o contexto worker da fila não abre dados de outros tenants.

Testes unitários cobrem transporte, worker e preflight, inclusive quotas incompletas,
limites esgotados, credencial de leitura negada e sandbox não confundida com produção.
A integração final passou com **3 suítes/32 testes**, incluindo o cadastro de
membro e a resposta `emailQueued` do link de senha. A suíte completa passou com
257 suítes/2.050 testes backend. O frontend passou
com 70 arquivos/678 testes, TypeScript e lint. Build Nest, lint backend, schema
Prisma, limites de contratos e contrato de erros públicos passaram. A primeira
execução da suíte completa foi limitada por EPERM nos sockets HTTP da sandbox;
a repetição com permissão para portas locais passou sem mudar testes ou timeouts.
A conferência TypeScript também ajustou fixtures para UUIDs tipados e acesso
seguro aos índices dos mocks, incluindo um acesso no teste de push do complemento
anterior; não altera o comportamento do Firebase. A regressão direcionada final
passou com 34 testes.

O preflight remoto, executado sem envio em 14/11/2026 com as credenciais do
checkout, consultou a região us-east-2: remetente verificado, envio habilitado,
quota disponível, 200 mensagens/dia, 1 mensagem/segundo e **ProductionAccessEnabled
false / SANDBOX**. Retornou exit 2, conforme o contrato. Isso não prova que outro
ambiente de deploy esteja usando as mesmas credenciais/envs e não libera envio
geral. Nenhuma mensagem real foi enviada. Teste em sandbox com o responsável e
aceite após aprovação AWS continuam pendentes.

Referências: [SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html),
[GetAccount](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html),
[GetEmailIdentity](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailIdentity.html),
[Sandbox regional](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
