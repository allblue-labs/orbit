# Integração de cobrança — Stripe Billing

## A invariante que organiza tudo

```text
Stripe            → autoridade financeira externa
Subscription      → autoridade comercial interna
EntitlementService → autoridade de acesso ao produto
```

Leituras comuns do produto nunca consultam o Stripe. Eventos e comandos
comerciais vinculados passam pela fronteira do provedor:

```text
Stripe → webhook assinado / reconciliação → adaptador
       → comando do Orbit → OrganizationSubscription → EntitlementService

usuário → comando autenticado → URL do Checkout/Portal → confirmação no Stripe
        → webhook/reconciliação → OrganizationSubscription
```

Registrado em `docs/adr/ADR-007`. O que esta PR acrescenta é o tradutor; a
autoridade continua onde estava.

## O SDK vive num arquivo só

`stripe/stripe-billing.provider.ts` é o **único** arquivo que importa `stripe`.
Acima dele existe a porta `BillingProvider`, que fala de plano, periodicidade e
assinatura — e nada de `Stripe.Subscription`.

- SDK: `stripe@22.6.1`
- Versão da API: **`2026-08-26.dahlia`**, fixada explicitamente

A versão é a que o SDK instalado declara, lida dos tipos dele e não presumida.
Deixá-la implícita significaria que uma mudança no painel do fornecedor altera o
formato das respostas sem um commit nosso.

> Detalhe que custou uma verificação: nesta versão da API,
> `current_period_start/end` são do **item** da assinatura, não da assinatura.
> Está lido do item, conferido nos tipos do pacote instalado.

## Dois estados, e nenhum meio-termo

|                       | `STRIPE_ENABLED=false` | `STRIPE_ENABLED=true`        |
| --------------------- | ---------------------- | ---------------------------- |
| A API sobe            | sim                    | só com configuração completa |
| Toca a rede           | nunca                  | sim                          |
| Webhook aceita evento | não                    | só com assinatura válida     |
| Tela de assinatura    | "indisponível"         | operante                     |

Configuração incompleta com a cobrança ligada **derruba a subida**. Subir pela
metade produziria um `checkout` que descobre o preço faltando na frente do
cliente, e aí é tarde. A mensagem de falha nomeia as **chaves** que faltam,
nunca os valores.

## Configuração no painel do Stripe

1. crie os quatro produtos (um por plano do catálogo);
2. crie os **doze** preços — quatro planos × três periodicidades — em `BRL`,
   recorrentes, com os valores da tabela abaixo;
3. registre os **Price IDs** (`price_...`), nunca Product IDs (`prod_...`), nas
   variáveis `STRIPE_PRICE_<PLANO>_<PERIODICIDADE>`;
4. configure o **Customer Portal**: métodos de pagamento, faturas, dados de
   cobrança e cancelamento. Habilite **trocas de plano**, publique os 12 preços,
   configure os ajustes para cobrança imediata (`always_invoice`), alterações
   imediatas e fim do teste ao mudar (`end_trial`). O cancelamento continua
   _ao fim do período_;
5. crie a _webhook destination_ apontando para
   `POST https://<api>/api/v1/billing/webhooks/stripe`;
6. selecione **apenas** os eventos da lista abaixo — nunca `*`;
7. guarde o _signing secret_ em `STRIPE_WEBHOOK_SECRET`;
8. mantenha `BILLING_EVENTS_WORKER_ENABLED=true` e configure `STRIPE_ENABLED=true`;
9. confira em `GET /api/v1/billing/readiness`.

### Preços esperados (centavos, BRL)

|                             | Mensal | Semestral |   Anual |
| --------------------------- | -----: | --------: | ------: |
| Essencial                   |  5.990 |    32.940 |  59.900 |
| Profissional                | 14.990 |    82.740 | 149.900 |
| Profissional + Inteligência | 24.990 |   137.940 | 249.900 |
| Empresarial Ilimitado       | 69.990 |   386.340 | 699.900 |

`verifyPriceCatalog()` confere cada um contra o catálogo do Orbit: existência,
atividade, modo teste/produção, moeda, periodicidade e **valor**. O checkout e a
troca de plano conferem o preço de destino pela API antes da escrita no Stripe.
Divergência não inicia contratação
— e a aplicação **não corrige o painel**: se lá diz 699,90 e aqui diz 599,00,
quem está errado é uma configuração, e adivinhar qual seria pior do que recusar.

### Modo de teste e modo de produção

O modo é deduzido do prefixo da chave (`sk_live_` ou `rk_live_` → `LIVE`). A
configuração aceita chaves secretas e restritas de conta, rejeita chaves
publicáveis e rejeita preços repetidos entre planos/periodicidades. Chaves
restritas precisam das permissões usadas por este adaptador: leitura de preços,
assinaturas, faturas, pagamentos de faturas, reembolsos, disputas e configurações
do Billing Portal; e escrita de
customers, Checkout Sessions, sessões do Billing Portal, assinaturas e schedules.

O texto de um Price ID não indica seu modo. A conferência usa o campo
`price.livemode` da API e a existência do preço no ambiente da chave.

### Conferência sem criar cobranças

Depois de preencher as envs, no diretório `backend`:

```sh
npm run billing:check:dev
npm run billing:check:dev -- --remote
```

O primeiro comando confere os formatos, as doze associações, os segredos e as
URLs, inclusive quando `STRIPE_ENABLED=false`. O segundo também faz GET dos
doze preços no Stripe, compara ao catálogo e confere a configuração padrão do
Customer Portal. Não cria clientes, assinaturas
ou pagamentos. As mensagens não imprimem credenciais. Uma divergência encerra
com código 1. A conferência local não comprova que a chave é válida na conta,
que o webhook foi cadastrado. A verificação remota também exige os preços e
as regras de troca publicados no portal padrão.

Na imagem publicada, que contém o script compilado:

```sh
docker compose exec api npm run billing:check -- --remote
```

As envs desse comando são as que o container recebeu ao ser criado. Alterar
apenas o arquivo `.env` não atualiza um container existente.

### Onde copiar cada configuração no painel

1. Selecione **Sandbox/teste** ou **Live** no Stripe. Produtos, preços, chave e
   webhook precisam pertencer ao mesmo ambiente e à mesma conta.
2. Em **Developers / Workbench → API keys**, copie uma chave de API secreta de
   conta (`sk_...`) ou restrita com permissões adequadas (`rk_...`) para
   `STRIPE_SECRET_KEY`. A chave publicável `pk_...` não atende a esta integração.
3. Em **Product catalog**, abra cada produto e depois seu preço recorrente.
   Copie o identificador do **preço**. Para `MONTHLY`, use cobrança a cada 1 mês;
   para `SEMIANNUAL`, um período personalizado a cada 6 meses; para `ANNUAL`, a
   cada 1 ano (ou 12 meses). O preço semestral/anual é o total do período, não o
   equivalente mensal. Os produtos existentes podem ser reaproveitados.
4. Em **Workbench → Webhooks → Create destination**, escolha eventos da própria
   conta, no formato snapshot/v1, e os 19 eventos da seção abaixo. Use a versão
   da API compatível com `STRIPE_API_VERSION` (`2026-08-26.dahlia`) e um endpoint
   HTTPS público. No domínio usado pelo Orbit nesta implantação:
   `https://orbit.allblue-labs.com/api/v1/billing/webhooks/stripe`.
   O Nginx deve encaminhar esse caminho para a API preservando URI e corpo.
   Na página da destination, revele o **Signing secret** (`whsec_...`) e copie
   para `STRIPE_WEBHOOK_SECRET`. O segredo exibido pelo `stripe listen` local é
   diferente do segredo da destination cadastrada no painel.
5. Em **Settings → Billing → Customer portal**, salve a configuração de métodos
   de pagamento, faturas e cancelamento no fim do período. Trocas de plano pelo
   portal padrão devem estar **ativadas** para confirmar saída de teste
   (`subscription_update_confirm`). Planos pagos usam schedules e o portal
   geral do Orbit utiliza outra configuração, sem troca imediata. Publique os quatro produtos e os
   doze preços. Em ajustes proporcionais, escolha faturar/cobrar imediatamente
   (`always_invoice`); mantenha a mudança imediata, sem agendamento de redução,
   e o encerramento do teste na troca (`trial_update_behavior=end_trial`).
   `npm run billing:check:dev -- --remote` confere essas regras sem modificar a conta.
6. As três envs de retorno são URLs do **Orbit**, escolhidas por quem implanta,
   não credenciais copiadas do Stripe. Uma rota existente para as três é:
   `https://orbit.allblue-labs.com/configuracoes?secao=assinatura`.
   Use-a em `BILLING_CHECKOUT_CANCEL_URL` e `BILLING_PORTAL_RETURN_URL`. Para
   `BILLING_CHECKOUT_SUCCESS_URL`, acrescente `&assinatura=sucesso`, para a tela
   acompanhar a confirmação. O retorno não ativa a assinatura: é o webhook
   processado que confirma o estado.
7. Depois da configuração, publique a API atualizada e recrie seu container com
   as envs corrigidas e `STRIPE_ENABLED=true`. Em **Webhooks → destination →
   Event deliveries**, confira as respostas HTTP 200. Confira também os logs
   `billing-inbox-drained` e o estado em **Configurações → Plano e assinatura**:
   HTTP 200 confirma o recebimento; o worker ainda precisa processar o evento.

Referências: [API keys](https://docs.stripe.com/keys),
[produtos e preços](https://docs.stripe.com/products-prices/manage-prices),
[destinations no Workbench](https://docs.stripe.com/workbench/event-destinations),
[Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal).

## Eventos consumidos

Exatamente estes dezenove, agrupados pela responsabilidade:

| Evento                                     | Significado normalizado        | Comando no Orbit                             |
| ------------------------------------------ | ------------------------------ | -------------------------------------------- |
| `checkout.session.completed`               | contratação concluída          | reconciliar assinatura                       |
| `checkout.session.async_payment_succeeded` | pagamento assíncrono concluído | concluir contratação e reconciliar           |
| `customer.subscription.created`            | assinatura criada              | reconciliar assinatura                       |
| `customer.subscription.updated`            | assinatura mudou               | reconciliar assinatura                       |
| `customer.subscription.deleted`            | assinatura encerrada           | reconciliar assinatura                       |
| `invoice.created`                          | fatura criada                  | materializar projeção canônica               |
| `invoice.finalized`                        | fatura finalizada              | atualizar projeção e razão                   |
| `invoice.updated`                          | fatura alterada                | atualizar projeção e razão                   |
| `invoice.paid`                             | pagamento confirmado           | registrar fatura e reconciliar assinatura    |
| `invoice.payment_failed`                   | cobrança falhou                | registrar tentativa e reconciliar assinatura |
| `invoice.payment_action_required`          | pagamento exige ação           | registrar estado e próxima tentativa         |
| `invoice.voided`                           | fatura anulada                 | registrar estado final                       |
| `invoice.marked_uncollectible`             | fatura considerada incobrável  | registrar estado final                       |
| `refund.created`                           | reembolso criado               | correlacionar e registrar ajuste             |
| `refund.updated`                           | reembolso alterado             | atualizar ajuste canônico                    |
| `refund.failed`                            | reembolso falhou               | registrar falha canônica                     |
| `charge.dispute.created`                   | disputa aberta                 | correlacionar e registrar ajuste             |
| `charge.dispute.updated`                   | disputa alterada               | atualizar ajuste canônico                    |
| `charge.dispute.closed`                    | disputa encerrada              | registrar resultado canônico                 |

Qualquer outro evento assinado é reconhecido com `2xx` e arquivado como
`IGNORED`. Falhar em evento sem consumidor faria o provedor reentregar para
sempre algo que nunca vamos processar.

### Ativação segura dos novos eventos

Não adicione os eventos de fatura, reembolso e disputa ao destino de produção
antes de publicar esta versão e aplicar a migration do ledger. O consumidor
anterior os arquiva como `IGNORED`; ativá-los antes do deploy criaria uma lacuna
histórica. A ordem correta é: banco, aplicação, health/readiness e só então
seleção dos eventos no Dashboard.

### Tradução de estado

| Stripe                           | Orbit normalizado                      |
| -------------------------------- | -------------------------------------- |
| `trialing`                       | `TRIALING`                             |
| `active`                         | `ACTIVE`                               |
| `incomplete`                     | `INCOMPLETE` (nunca libera plano pago) |
| `incomplete_expired`, `canceled` | `ENDED`                                |
| `past_due`, `unpaid`, `paused`   | `PAYMENT_FAILED`                       |
| **qualquer outro**               | `UNKNOWN`                              |

`UNKNOWN` e `INCOMPLETE` nunca ativam nada. Um estado novo do fornecedor deve
aparecer como pendência de reconciliação, e não como acesso concedido por
omissão.

## O webhook

```text
recebe → verifica assinatura sobre o corpo cru → grava na caixa → responde 200
```

E para. A reconciliação acontece fora do ciclo da requisição — o motivo é
operacional: um provedor que espera demais considera a entrega falhada e
reenvia, e reconciliar dentro da requisição transformaria lentidão em avalanche
de reentregas, exatamente quando o sistema já está lento.

**Corpo cru.** `NestFactory.create(AppModule, { rawBody: true })` guarda os
bytes originais **além** do JSON já interpretado: as outras rotas continuam
recebendo o corpo parseado como sempre. Reserializar o JSON antes de verificar
mudaria espaços, ordem de chaves e escapes, e a assinatura deixaria de bater
para eventos legítimos — a tentação seguinte seria "consertar" ignorando a
verificação.

Sem cabeçalho, com assinatura inválida, com corpo adulterado, com outro segredo
ou com a cobrança desligada: **400**, e nada entra na caixa de entrada.

## Fora de ordem, repetido e perdido

O evento é um aviso, não um fato. O que vale é o objeto **canônico** buscado no
provedor no momento de reconciliar. Isso resolve três problemas de uma vez:

- **ordem** — eventos chegam fora de ordem e dois podem nascer no mesmo
  segundo, então ordenar por `event.created` não decide nada. Um
  `payment_failed` antigo que chega depois do pagamento não suspende ninguém: o
  provedor diz que está pago, e é isso que se aplica;
- **duplicidade** — reprocessar aplica o mesmo estado atual, e aplicar duas
  vezes o mesmo estado não muda nada. O índice único
  `(provider, provider_event_id)` já garante uma linha por evento;
- **perda** — se um evento nunca chegou, a varredura periódica pergunta ao
  provedor pelas assinaturas **que já conhecemos** e converge do mesmo jeito.

## Ledger financeiro e histórico de faturas

O Orbit guarda uma projeção por fatura e uma transição append-only por evento
processado. Cada observação é reconstruída pela API canônica do Stripe; o corpo
do webhook não é usado como fonte de valores e não é persistido.

```text
evento assinado → ID da fatura → leitura canônica no Stripe
                → validação customer + subscription
                → projeção atual + transição imutável
```

O modelo contém somente valores na menor unidade monetária, datas operacionais,
estado normalizado e links HTTPS hospedados pelo provedor. Não entram no banco
dados de cartão, endereço de cobrança, `client_secret`, payload cru ou PII do
pagador. Reembolsos e disputas são correlacionados pela PaymentIntent até uma
única fatura; correlação ausente ou ambígua falha fechada.

As tabelas são tenant-safe, usam foreign keys compostas e `ENABLE/FORCE RLS`.
O papel da aplicação não possui `UPDATE` nem `DELETE` sobre as transições do
ledger. A tela apresenta somente o histórico da organização autenticada e links
que passaram pela validação HTTPS do adaptador.

Um reembolso ou uma disputa não revoga direitos automaticamente. O estado
canônico da assinatura continua decidindo acesso; respostas operacionais a
disputas pertencem à política auditada e aos alertas, não a um efeito colateral
implícito de webhook.

## Indisponibilidade não é inadimplência

```text
Stripe timeout ≠ pagamento falhou
```

Provedor fora do ar deixa o evento pendente e tenta de novo. Ninguém é
suspenso, ninguém perde acesso, e o último estado reconciliado continua valendo.
Um dia ruim do fornecedor não pode virar suspensão em massa.

## Carência: duas engines, uma política

O Stripe tem a política de novas tentativas dele; o Orbit tem a carência de
**7 dias** da PR-PL-02. Elas não competem:

```text
Stripe tenta cobrar de novo, no ritmo dele
Orbit preserva o acesso por até 7 dias a partir da falha confirmada
```

Recuperou dentro da carência → `ACTIVE`. Não recuperou → `SUSPENDED`, sem
destruir dado nenhum.

## Contratação

O corpo aceita **dois** campos: `planCode` e `billingInterval`. Não existe
`amount`, `priceId`, `trialDays` nem `organizationId` — e com
`forbidNonWhitelisted`, mandar qualquer um deles é **400**, não um campo
silenciosamente ignorado. Ignorar em silêncio ensina que tentar não custa nada.

| Decisão               | Quem decide                             |
| --------------------- | --------------------------------------- |
| plano e periodicidade | o cliente, entre opções fechadas        |
| preço e valor         | o catálogo do Orbit → preço configurado |
| avaliação e duração   | o estado já aprovado pelo Orbit         |
| organização           | a sessão autenticada                    |
| URLs de retorno       | a configuração do servidor              |

**Voltar da tela do provedor não ativa nada.** A URL de sucesso é navegação;
quem ativa é o estado verificado chegando por webhook assinado ou por
reconciliação.

## Cadastro e troca de plano com pagamento

- Um novo cadastro sem avaliação nasce `PENDING_PAYMENT`. Após receber a sessão
  autenticada, o frontend abre o Checkout com o plano e a periodicidade que o
  servidor publicou. Se a abertura falhar, o cadastro fica preservado e a tela
  de assinatura oferece **Continuar para o pagamento**.
- `POST /organizations/current/subscription/change-plan` aceita versão, plano,
  periodicidade e `acknowledgeTrialEnd`. Responde `{kind: "TRIAL_STARTED", endsAt}`
  para teste, `{kind: "SCHEDULED", effectiveAt}` para troca na renovação, ou
  `{url}` para contratação com confirmação de pagamento. O frontend atualiza
  assinatura/sessão nos dois primeiros casos e navega somente no terceiro.
- Em `PENDING_PAYMENT`, sem pagamento anterior e sem teste utilizado, escolher
  Essencial inicia 30 dias gratuitos. Usa o documento canônico da unidade
  principal, o histórico da organização e HMAC global. Concessão e mudança de
  assinatura são atômicas. Expira checkout anterior no Stripe primeiro;
  checkout concluído aguarda reconciliação e não é tratado como abandono.
- Planos pagos `ACTIVE`, tanto upgrade quanto downgrade ou periodicidade,
  usam Subscription Schedule sem prorrateio: preserva o preço/período atual
  e muda somente na renovação. Nenhuma cobrança ou alteração de direitos é
  antecipada. O agendamento pode ser desfeito.
- A reconciliação exige preço conhecido, customer/subscription correspondentes
  e fatura `PAID` sem saldo, com linha do preço/período da renovação. Fatura
  antiga, `active`, redirects e HTTP 200 não comprovam o novo pagamento.
  O relógio não aplica sozinho mudanças geridas pelo Stripe.
- O portal geral cria/reutiliza configuração própria para dados de cobrança,
  faturas e métodos de pagamento, sem troca de plano ou cancelamento. Esses
  comandos passam pelo Orbit. A configuração padrão de confirmação hospedada
  continua necessária apenas para saída antecipada de teste com vínculo Stripe.

### Adequação de limites em 48 horas

Aplique `20261023180000_plan_limit_adjustment_window` antes de publicar a API.
A migration adiciona data de redução e snapshot anterior sem modificar dados
existentes. A data parte do início real do novo período: replay não estende
prazo. A interface mostra os limites novos e excedentes desde a renovação;
durante 48 horas, as cotas anteriores ainda valem no enforcement.

Depois, os novos tetos bloqueiam criação/consumo excedente; ações de operação
e campo afetadas pelo excesso de equipe, clientes, equipamentos ou unidades
ficam bloqueadas. Consultas, gestão da assinatura e desativação/arquivamento
para adequação permanecem disponíveis. A cada tentativa, contagens canônicas
e relógio são verificados: não depende de um worker para bloquear e libera
quando os excedentes são resolvidos. O aviso global informa prazo e recursos.
Cotas mensais se renovam pela janela de uso; não se apaga histórico para zerar
consumo. **A adequação de limites nunca exclui dados automaticamente.** A exclusão
após cancelamento tem uma política própria, descrita abaixo.

### Saída antecipada do teste

Apenas o Essencial recebe os 30 dias. Antes de migrar para outro plano, o modal
informa os dias restantes, que a cobrança começa ao contratar e que os dias não
serão transferidos. A API exige `acknowledgeTrialEnd=true`. Alterar a periodicidade durante o teste
também é uma contratação paga antecipada, com o mesmo aviso e confirmação. O Checkout do novo
plano não recebe `trial_period_days`. Para assinaturas já ligadas, a configuração
do portal precisa encerrar o teste (`end_trial`).

Ao confirmar o pagamento, a assinatura passa a `ACTIVE`, recebe o plano pago e
encerra o prazo gratuito. Cancelar a navegação ou não pagar preserva o plano
anterior. Nenhuma nova concessão de teste é criada e a memória antifraude não é
apagada.

### Publicação desta correção

Aplique `20261022230000_checkout_plan_change_intent` antes de subir a API nova.
A migration acrescenta `subscription_version` e `ends_trial` às tentativas,
sem modificar assinaturas existentes. Sessões criadas anteriormente continuam
aceitas apenas para o plano original.

```sh
docker compose build api migrate frontend
docker compose run --rm migrate
docker compose up -d --no-deps api frontend
docker compose exec api npm run billing:check -- --remote
```

Configure `BILLING_EVENTS_WORKER_ENABLED=true` em pelo menos uma instância e
mantenha `JOBS_WORKER_ENABLED` habilitado nela (o padrão é `true`). HTTP 200 no
webhook com todos os workers desligados apenas acumula eventos na inbox.
Ao editar envs, **recrie** o container; `restart` não aplica os novos valores.

Na auditoria somente de leitura de 22/10/2026, os 12 preços da conta Live foram
validados. A troca estava desativada no portal padrão e o `.env` deste checkout
mantinha o worker de cobrança desligado. A URL de sucesso também estava sem
`assinatura=sucesso`; acrescente o parâmetro para acompanhar a confirmação no
retorno. A configuração do servidor de produção precisa ser conferida separadamente.

Referências: [confirmação hospedada de mudança](https://docs.stripe.com/customer-management/portal-deep-links),
[configurar o portal](https://docs.stripe.com/customer-management/configure-portal),
[tratamento de testes no portal](https://docs.stripe.com/customer-management#limitations).

### A avaliação continua sendo do Orbit

Os dias espelhados no Stripe saem do que o Orbit **já** aprovou — nunca de uma
nova avaliação de elegibilidade no momento do checkout. Se decidisse ali, abrir
dez sessões seria dez chances de conseguir trinta dias. Recriar o cliente no
provedor também não devolve avaliação: a memória é o HMAC do documento, na
PR-PL-02, e nada aqui a consulta ou a apaga.

## Segurança

|                                   |                                                           |
| --------------------------------- | --------------------------------------------------------- |
| assinatura sobre corpo cru        | sim, pelo SDK oficial                                     |
| segredo em log                    | nunca; a falha de configuração nomeia chaves, não valores |
| preço/valor do cliente            | recusado pelo DTO com 400                                 |
| avaliação do cliente              | recusada pelo DTO com 400                                 |
| organização do cliente            | ignorada; vem da sessão                                   |
| redirecionamento aberto           | impossível; URLs do servidor, `https` fora de localhost   |
| efeito duplicado                  | índice único por evento                                   |
| vínculo cruzado entre inquilinos  | índice único por `(provider, customer)`                   |
| erro cru do provedor ao cliente   | nunca; traduzido para código público                      |
| dado de cartão                    | nenhum; captura é no Checkout hospedado                   |
| `orbit_app`                       | `NOSUPERUSER`, `NOBYPASSRLS`                              |
| função privilegiada para `PUBLIC` | nenhuma                                                   |

`billing_customers` é dado de inquilino: RLS + FORCE. A caixa de entrada é
infraestrutura da plataforma — o evento chega antes de sabermos de quem é — e
por isso só é acessível declarando contexto de plataforma. Nenhuma das duas
aceita `DELETE` pelo papel de runtime: a memória de que um evento foi
processado é o que impede o segundo efeito quando o provedor reentregar semanas
depois.

**Contexto no worker.** Depois de descobrir a organização pelo identificador do
provedor, a reconciliação **entra** no contexto daquele inquilino, recém-criado,
com ator `SYSTEM` e sem papéis. Nada é herdado de requisição anterior, e o
contexto morre com a reconciliação.

**Entrega durável.** O endpoint assinado apenas registra. O worker reivindica
cada evento com `FOR UPDATE SKIP LOCKED`, token e lease: réplicas concorrentes
não executam a mesma linha; uma réplica que morre libera o trabalho pelo prazo
do lease. Falhas transitórias voltam com backoff exponencial e orçamento de
oito tentativas. Falhas permanentes ou retries esgotados terminam em
`DEAD_LETTER`, preservados para diagnóstico — nunca são apagados.

`BILLING_EVENTS_WORKER_ENABLED=false` desliga apenas o consumidor nesta
réplica; `BILLING_EVENTS_POLL_INTERVAL_MS` controla a cadência (mínimo 500 ms).
O padrão é ligado a cada 2 segundos. A coordenação continua sendo do banco,
portanto múltiplas réplicas podem manter o worker habilitado.

## Rotação de segredos

| Segredo                    | Rotacionável | Efeito                                                                       |
| -------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`        | sim          | nenhum sobre assinaturas ou avaliações                                       |
| `STRIPE_WEBHOOK_SECRET`    | sim          | crie a nova destinação, troque a variável, remova a antiga                   |
| `TRIAL_FINGERPRINT_SECRET` | **não**      | girar **apaga a memória do antifraude**: todo documento volta a ser elegível |

O segredo da avaliação é de vida longa e domínio próprio, e não participa da
rotação de nada. É por isso que ele nunca foi acoplado às chaves do provedor.

## Sem chaves reais

A integração é validável sem conta: as assinaturas de teste são geradas pela
ferramenta oficial do SDK, e a verificação é a mesma que roda em produção. A
suíte dedicada exercita banco real, assinatura real, caixa de entrada real e
reconciliação real — substituindo apenas as chamadas de rede.

O sistema fica **pronto para produção, aguardando somente a configuração de
segredos, dos doze identificadores de preço, do portal de troca e do worker**.

## Fora de escopo

Impostos e Stripe Tax, nota fiscal brasileira, cupons, adicionais, cobrança por
assento, cobrança por uso medido, cobrança de excedente de IA, automação de
resposta a contestações e PIX recorrente — este último porque suporte a
assinatura recorrente com PIX precisa ser comprovado antes de ser prometido, e
não foi.

## Diagnóstico do código publicado

Quando as flags de produção estão corretas, confira também os artefatos servidos.
Veja [evidência de produção e publicação verificável](stripe-production-rollout.md).
O verificador usa somente HTTP público e não considera envs locais.
