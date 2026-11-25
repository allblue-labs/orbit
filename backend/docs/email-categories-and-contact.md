# Categorias de e-mail e contato público

Os e-mails de conta continuam restritos ao owner inicial com procedência válida.
O formulário público envia somente para a equipe Allblue; ele não cria conta,
não verifica o e-mail do visitante e não dispara resposta automática para ele.

| Finalidade | Env de remetente | Valor recomendado | Resposta |
| --- | --- | --- | --- |
| Conta e segurança: boas-vindas, confirmação, recuperação e senha alterada | `AWS_SES_FROM_TRANSACTIONAL_EMAIL` | `no-reply@allblue-labs.com` | Não espera resposta |
| Avisos operacionais da conta: plano vencido e limites | `AWS_SES_FROM_INFORMATIONAL_EMAIL` | `avisos-orbit@allblue-labs.com` | `AWS_SES_SUPPORT_REPLY_TO_EMAIL` |
| Suporte e feedback | `AWS_SES_FROM_SUPPORT_EMAIL` | `suporte-orbit@allblue-labs.com` | Visitante no formulário; canal configurado nos demais casos |

```dotenv
# Preserve o remetente original como fallback e para correlacionar eventos antigos.
AWS_SES_FROM_EMAIL=contato@allblue-labs.com
AWS_SES_FROM_TRANSACTIONAL_EMAIL=no-reply@allblue-labs.com
AWS_SES_FROM_INFORMATIONAL_EMAIL=avisos-orbit@allblue-labs.com
AWS_SES_FROM_SUPPORT_EMAIL=suporte-orbit@allblue-labs.com
AWS_SES_SUPPORT_REPLY_TO_EMAIL=contato@allblue-labs.com
ORBIT_SUPPORT_TO_EMAIL=contato@allblue-labs.com
PUBLIC_CONTACT_ENABLED=true
PUBLIC_CONTACT_DELIVERY_ENABLED=true
AWS_SES_FEEDBACK_SENDER_IDENTITIES=
```

Env de categoria vazia reutiliza AWS_SES_FROM_EMAIL. Endereços são validados e
nunca vêm do browser. Os avisos incluem a tag SES orbit_category. Todos os
modelos HTML usam as logos inline, incluindo o contato público. As credenciais
AWS existentes continuam estritamente no backend.

## SES, caixas e respostas

Um domínio verificado no SES permite enviar dos endereços desse domínio na
mesma região. Isso não cria caixas de entrada. O Reply-To informativo e de
suporte usa contato@allblue-labs.com, que precisa continuar recebendo e-mails.
Para receber também mensagens enviadas diretamente a suporte-orbit, configure
esse alias no provedor de e-mail apontando para a caixa de suporte/contato.
Não altere registros MX apenas para separar remetentes do SES.

Referências: [identidades SES](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html),
[ReplyToAddresses no SendEmail v2](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).

### Bounces e complaints com múltiplos remetentes

Com feedback habilitado, configure o JSON AWS_SES_FEEDBACK_SENDER_IDENTITIES
como mapa exato endereço → ARN da identidade efetivamente usada pelo SES.
Não suponha que o ARN do domínio será sempre o escolhido: um endereço com
identidade própria verificada pode ter precedência. O remetente antigo permanece
no mapa para eventos de mensagens em trânsito. Não são aceitos curingas,
contas/regiões diferentes ou identidades incompatíveis com o endereço.

Após preencher os remetentes e AWS_SES_FEEDBACK_ACCOUNT_ID, descubra os ARNs
com a mesma credencial/região usadas pela API, sem enviar e-mail:

```sh
# Backend compilado, com as envs carregadas; saída contém só metadados.
node dist/src/scripts/resolve-ses-senders.js
# Copie a linha AWS_SES_FEEDBACK_SENDER_IDENTITIES=... para o .env.
node dist/src/scripts/check-ses-config.js --remote
```

Se a API estiver parada enquanto configura o mapa, use um container de execução
com a imagem da release e o mesmo ambiente, substituindo seu comando por esse
script. Não é necessário recriar tópicos/subscrições SNS nem restaurar permissões
temporárias de bootstrap. O preflight verifica todos os remetentes e confere
as identidades reais contra o mapa configurado. O IAM precisa permitir SendEmail
para as identidades dos remetentes, além das leituras já usadas pelo preflight.

## Formulário

Landing Orbit: seção #contato, também acessível pelo rodapé. Nome, e-mail,
assunto e mensagem são obrigatórios, com textos em português, loading e retorno
de sucesso/erro. O browser não escolhe To/From/Reply-To arbitrários: o backend
fixa To pela env ORBIT_SUPPORT_TO_EMAIL e usa apenas o e-mail validado do visitante
como Reply-To. Não há anexos de visitantes nem envio automático a eles.

POST /api/v1/public/contact recebe JSON e Idempotency-Key UUID v4. A resposta
202 confirma recebimento na fila, não entrega no inbox. O BFF libera somente
POST /public/contact e mantém origem/Fetch Metadata obrigatórios. Dados inválidos
ou campos extras são recusados; um honeypot preenchido recebe resposta neutra
sem persistir ou enviar. A validação do formulário não coloca a mensagem na URL.

- Uma tentativa repetida, com a mesma chave/conteúdo, não cria outro e-mail.
- Máximo de três mensagens novas por e-mail/hora, cinco por origem/hora e cem
  em 24h globalmente; orçamentos são persistidos e compartilhados entre réplicas.
  O limite geral de endpoints sensíveis também protege requisições inválidas.
- Nome, e-mail e texto ficam cifrados enquanto aguardam. Logs não incluem conteúdo,
  endereço do visitante, IP puro, token ou credenciais. Hashes de controle usam HMAC.
- Tabela public_contact_submissions com FORCE RLS: pedidos normais não listam a
  fila e usuários de tenants não ganham acesso a ela. Worker tem contexto próprio.
- Worker usa lease e SKIP LOCKED, até seis tentativas com backoff, e não tenta
  mensagens com mais de sete dias. A correlação no ledger SES permite reconhecer
  aceitação anterior após falha de confirmação da fila, evitando novo envio.
- A finalização limpa o payload cifrado. Metadados terminais são podados após
  trinta dias pelo worker; a auditoria de transporte é preservada, sem corpo.
- PUBLIC_CONTACT_ENABLED pausa novas entradas; PUBLIC_CONTACT_DELIVERY_ENABLED
  pausa o consumidor. JOBS_WORKER_ENABLED=false também para esse worker.
  ACCOUNT_EMAIL_DELIVERY_ENABLED continua controlando somente e-mails de conta.

A migration 20261117210000_public_contact_delivery cria a fila e a correlação de
transporte. Deve ser aplicada antes de iniciar a nova API. É aditiva e não
altera dados operacionais dos tenants.
