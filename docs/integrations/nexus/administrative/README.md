# API administrativa corporativa do Orbit

O namespace `/api/v1/corporate-admin` autentica um principal técnico dedicado. A descoberta da conexão mantém o contrato `1.0.0` consumido pelo Nexus.

| Método | Rota | Dados |
| --- | --- | --- |
| GET | `/api/v1/corporate-admin/connection` | `{ "status": "ok" }` |
| GET | `/api/v1/corporate-admin/version` | `{ "service": "orbit-corporate-admin", "version": "1.0.0" }` |
| GET | `/api/v1/corporate-admin/capabilities` | `{ "capabilities": ["connection:read"] }` |

Os três handlers exigem autenticação e a capability antes de responder. A resposta usa o envelope HTTP do Orbit e `Cache-Control: private, no-store`. A versão identifica apenas o contrato corporativo. [OpenAPI 3.1](openapi.json)

## Fronteiras do código

- `CorporateAdministrationModule` registra a descoberta, o diretório de organizações e os guards de autenticação e capability. A autenticação técnica permanece local ao request corporativo. Claims, cookies, tokens de usuário e cabeçalhos que declarem um operador ou cargo não viram autoridade.
- `PlatformAdministrationService` orquestra consultas e comandos locais com autoridade humana verificada. `VerifiedPlatformAuthority`, as regras de tenant e os repositórios de plataforma continuam aplicáveis à superfície atual. O diretório reutiliza o repositório, o seletor e a projeção da assinatura canônica, a validação dos campos cadastrais e a regra de disponibilidade operacional. A autoridade humana da administração local segue o próprio fluxo de verificação.
- A auditoria da plataforma registra atores humanos, efeitos e metadados de domínio. As decisões desta fronteira usam o logger estruturado com `event=corporate_admin_access`, `role=TECHNICAL`, operação, resultado, correlação e `technicalPrincipalId` quando autenticado. A identidade técnica permanece separada de `userId`. Tokens, verificadores e cabeçalhos não entram no registro. O log HTTP existente cobre respostas 429. Em caso de configuração inválida, o log recebe apenas um código genérico.
- O limite por origem reutiliza `AuthRateLimitService` e tem uma chave de ação única para as rotas corporativas. Os parâmetros existentes configuram a janela e o máximo (padrões de 120 tentativas por origem em 60 segundos). Redis, quando habilitado, e fallback PostgreSQL mantêm a contagem entre réplicas. A origem vem do socket ou do cabeçalho atestado pelo proxy já configurado. O orçamento das rotas de login permanece separado.

## Configuração e ciclo da credencial

No processo **API**:

| Variável | Uso |
| --- | --- |
| `ORBIT_CORPORATE_ADMIN_ENABLED` | `false` por padrão. Somente `true` habilita com configuração válida. |
| `ORBIT_CORPORATE_ADMIN_CREDENTIALS` | Array JSON de registros de verificador, com até 16 entradas. Injete pelo cofre/gerenciador de segredos do processo API. |
| `ORBIT_DEPLOYMENT` | `staging` ou `production` identifica explicitamente o ambiente implantado. Deixe a variável ausente na execução local fora de `NODE_ENV=production` e use `local` nos registros da credencial. |
| `AUTH_RATE_LIMIT_SECRET`, `AUTH_RATE_LIMIT_ORIGIN_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS` | Reutilizam os valores do limite do Orbit. |
| `TRUSTED_PROXY_SECRET` | Valor existente do proxy privado. Em implantação atrás de proxy, o salto deve atestar `X-Forwarded-Proto: https` com esse segredo. Use TLS direto ou esse ingresso controlado, com a porta da API privada e sobrescrita dos cabeçalhos de ingress. |

O registro contém `keyId` (slug de até 32 caracteres), `principalId` (UUID v4 ou v7, estável por conector), `environment` (o mesmo ambiente da API), `secretSha256` (64 caracteres hexadecimais minúsculos), `expiresAt` (UTC em ISO 8601), `revoked` (booleano) e `capabilities` (lista explícita de grants documentados para as rotas, sem repetições). IDs de chave duplicados e configuração inválida desabilitam somente a fronteira. Configuração e alterações de chaves são carregadas na inicialização.

A credencial enviada pelo Nexus no cabeçalho `Authorization: Bearer …` tem formato `orbit-ca1.<ambiente>.<keyId>.<segredo>`. O segredo tem 32 bytes aleatórios codificados em Base64URL, gerados de forma independente por chave e ambiente. O servidor guarda apenas SHA-256 de `orbit-corporate-admin.v1\0<ambiente>\0<keyId>\0<segredo>` e faz comparação em tempo constante do digest de 32 bytes. Vencimento e revogação são verificados a cada autenticação. O bearer deve ficar no cofre do cliente técnico.

Exemplo local para gerar dois arquivos privados em uma pasta protegida vazia. O comando não imprime o bearer e recusa sobrescrever os arquivos.

```bash
node --input-type=module - <<'JS'
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const keyId = 'nexus-local-01';
const environment = 'local';
const secret = randomBytes(32).toString('base64url');
const digestInput = ['orbit-corporate-admin.v1', environment, keyId, secret].join('\0');
const verifier = {
  keyId,
  principalId: randomUUID(),
  environment,
  secretSha256: createHash('sha256').update(digestInput).digest('hex'),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revoked: false,
  capabilities: ['connection:read'],
};
writeFileSync('orbit-verifier.json', JSON.stringify([verifier]), { flag: 'wx', mode: 0o600 });
writeFileSync('nexus-token.txt', ['orbit-ca1', environment, keyId, secret].join('.'), { flag: 'wx', mode: 0o600 });
JS
```

Injete o conteúdo de `orbit-verifier.json` na variável de credenciais da API local e o de `nexus-token.txt` no cliente técnico. A exceção de HTTP vale apenas em ambiente local, com socket loopback. Ambientes implantados exigem HTTPS atestado; `X-Forwarded-Proto` isolado não satisfaz o guard. O Compose do produto encaminha `ORBIT_CORPORATE_ADMIN_ENABLED` (padrão `false`) e `ORBIT_CORPORATE_ADMIN_CREDENTIALS` (padrão vazio) somente ao processo API; `worker` e `documents` recebem a fronteira desabilitada. Defina os valores no `.env` da implantação apenas quando a fronteira for autorizada.

**Rotação.** Provisionar novo segredo com outro `keyId` e o mesmo `principalId`. Carregar os dois verificadores em todas as instâncias, atualizar o cliente e verificar a conexão. Então revogar ou remover o antigo e recarregar todas as instâncias. A revogação de uma credencial vazada exige essa atualização imediata ou a desabilitação da fronteira. A expiração independe de reload. Sem sessão ou token renovável emitido pelo Orbit.

## Gestão cadastral · ADM-02.A

| Método | Rota | Capability | Resultado |
| --- | --- | --- | --- |
| GET | `/api/v1/corporate-admin/organizations` | `organizations:read` | `items`, `total`, `page`, `pageSize` |
| GET | `/api/v1/corporate-admin/organizations/{id}` | `organizations:read` | Dados cadastrais e resumo administrativo da organização |
| PATCH | `/api/v1/corporate-admin/organizations/{id}` | `organizations:write` | `id`, `updatedAt` e `changedFields` |

Os dois grants são independentes e precisam ser atribuídos explicitamente. O endpoint `/capabilities` permanece a descoberta legada de conexão e continua respondendo `["connection:read"]` quando autorizado. Consulte os grants exigidos por operação no campo `x-required-capability` do OpenAPI. A fronteira continua desabilitada por padrão e fora do BFF Web.

- A listagem retorna nome de exibição, razão social e nome comercial da unidade principal, documento cadastral, segmento, datas de cadastro e atualização, status e disponibilidade operacional, assinatura e contagens de unidades e vínculos de usuário. O documento vem da unidade principal, com fallback para o registro da conta quando ela estiver ausente. Dados indisponíveis retornam `null`.
- A busca por nome é parcial e ignora caixa. UUID e CPF/CNPJ usam correspondência exata. O CPF/CNPJ aceita máscara e também é consultado no registro de documentos da conta. Os filtros combinam estado operacional, plano, assinatura persistida e intervalo de cadastro em UTC. `registeredFrom` é inclusivo e `registeredBefore` é exclusivo.
- A paginação inicia em 1 com 25 registros e aceita até 100 por página, até a página 10.000. O total é calculado antes da paginação. É possível ordenar por `registeredAt` ou `displayName`, em ambas as direções, com desempate pelo ID. O padrão é cadastro mais recente primeiro.
- O detalhe acrescenta o contato da unidade principal, a identificação e o nome de exibição do responsável, o número de vínculos ativos e até 100 unidades com identificação, nomes, status, cidade e UF. `unitCount` indica o total de unidades sem exclusão lógica.
- A seleção da assinatura prioriza a linha corrente e, na ausência dela, a mais recente. `status` e `planCode` representam a linha persistida e são os valores usados pelos filtros. `effectiveStatus` e `effectivePlanCode` representam a projeção no instante da consulta. `UNKNOWN` filtra registros sem linha canônica.
- O PATCH aceita `displayName` e `primarySegment`, com pelo menos um deles, e exige `expectedUpdatedAt` igual à versão recebida anteriormente. Alterações concorrentes retornam 409. Uma solicitação sem diferença de valor retorna a mesma versão e `changedFields: []`. A escrita exige `X-Nexus-Administrator-Id` como UUID. Nas leituras, o cabeçalho é opcional.
- As consultas bem-sucedidas ou sem resultado no detalhe e as tentativas válidas de escrita registram ação, resultado, correlação e alvo, quando aplicável. O PATCH registra os nomes dos campos alterados. `technicalPrincipalId` é autenticado pelo Orbit e `declaredNexusAdministratorId` é uma referência declarada, sem efeito sobre permissões. O papel SQL dedicado tem grants por coluna, políticas RLS próprias e é inacessível como papel do runtime. A alteração e a auditoria são atômicas. Os guards preservam o log estruturado de falhas de acesso.

O contrato federado TENANT/ACK segue o próprio ciclo de ratificação. O diretório cobre dados cadastrais e usa o Orbit como fonte canônica. A validação foi feita com credenciais sintéticas e PostgreSQL descartável.

## Provisionamento e ciclo operacional · ADM-03.A

| Método | Rota sob `/api/v1/corporate-admin` | Capability |
| --- | --- | --- |
| POST | `/organizations` | `organizations:provision` |
| GET | `/tenant-provisionings/{id}` | `organizations:provisioning:read` |
| POST | `/tenant-provisionings/{id}/resume` | `organizations:provision` |
| POST | `/organizations/{id}/operational-status` com `SUSPENDED` | `organizations:suspend` |
| POST | `/organizations/{id}/operational-status` com `ACTIVE` | `organizations:reactivate` |

Atribua os grants de forma explícita ao verificador do cliente técnico. As sondas de conexão mantêm o contrato ADM-01.A. As escritas exigem `X-Nexus-Administrator-Id` como UUID. Esse identificador entra na auditoria como referência declarada. O Orbit autentica o principal técnico. A consulta e a retomada de um provisionamento exigem o mesmo principal técnico que o iniciou, inclusive após rotação da chave.

### Provisionamento e recuperação

O corpo aceita os dados cadastrais, CPF ou CNPJ válido, unidade inicial, plano comercial e o nome e e-mail do primeiro proprietário. O e-mail do proprietário é o contato de ativação. O cadastro usa o fluxo canônico de reserva do documento, criação da unidade, trial elegível ou pagamento pendente e configuração de acesso por link. O plano pago fica em `PENDING_PAYMENT` até que as condições da contratação sejam cumpridas.

| `status` | Efeito persistido | Próxima ação |
| --- | --- | --- |
| `RECEIVED` | Chave e impressão do pedido gravadas. | `RESUBMIT_ORIGINAL_REQUEST` |
| `TENANT_CREATED` | Organização, unidade e proprietário criados. | `RESUME` |
| `SUBSCRIPTION_READY` | Assinatura canônica criada conforme a contratação. | `RESUME` |
| `COMPLETED` | Link de configuração registrado, com o estado de envio consultável. | Fluxo cadastral concluído. |

O POST inicial exige `Idempotency-Key` com 1 a 128 caracteres conforme o OpenAPI. Se a resposta se perder, reenvie o mesmo conteúdo com a mesma chave. Uma mudança no conteúdo com a mesma chave dá `409 IDEMPOTENCY_MISMATCH`. O POST inicial retorna 201 quando completo e 202 quando parcial. Se já tiver o ID, consulte o detalhe e use `/resume` nos estágios indicados. A retomada retorna 200 quando completa e 202 enquanto parcial. As etapas confirmadas são reaproveitadas. A chave bruta e os dados pessoais ficam fora da auditoria.

O campo `ownerSetup` separa `QUEUED`, `ACCEPTED_BY_PROVIDER`, falha, expiração e configuração da senha. O aceite do provedor comprova submissão para envio. A ativação da assinatura vem dos campos `subscription.status`, `effectiveStatus` e `accessGranted`, mesmo depois de `complete: true`.

### Suspensão e reativação

Envie `status`, `reason` e o `expectedUpdatedAt` da organização. Os motivos válidos são `SECURITY`, `ABUSE`, `ADMINISTRATIVE` e `RESOLVED`. A chave de 16 a 120 caracteres é vinculada ao principal, à organização e ao comando. Para recuperar um recibo após perda da resposta, repita o comando com a mesma chave. Nova versão de cadastro, chave reutilizada com outro conteúdo ou transição bloqueada dão 409. O recibo separa a decisão original do estado atual.

A operação altera o acesso operacional e usa os gates financeiros em vigor. A reativação exige contratação canônica existente e preserva os bloqueios de pagamento, suspensão financeira, cancelamento ou retenção. A auditoria da transição e seus efeitos locais são gravados juntos. Consulte os contratos, códigos HTTP e exemplos sintéticos no [OpenAPI](openapi.json).

## Catálogo, assinaturas e trials · ADM-04.A

| Método | Rota sob `/api/v1/corporate-admin` | Capability | Resultado |
| --- | --- | --- | --- |
| GET | `/plans` | `plans:read` | Ofertas do catálogo canônico |
| GET | `/plans/{id}` | `plans:read` | Oferta por UUID ou código |
| GET | `/organizations/{id}/subscription` | `subscriptions:read` | Estado da assinatura, pagamentos registrados e entitlements |
| GET | `/organizations/{id}/trial` | `trials:read` | Elegibilidade e últimas 25 concessões |
| GET | `/organizations/{id}/subscription/operations/{operationId}` | `subscriptions:read` | Recibo do mesmo principal técnico e estado atual do ticket, quando houver |
| POST | `/organizations/{id}/subscription/change-plan` | `subscriptions:change-plan` | `202 AWAITING_REVIEW`, com `ticketId` |
| POST | `/organizations/{id}/subscription/keep` | `subscriptions:keep` | `200 APPLIED` |
| POST | `/organizations/{id}/subscription/cancel-scheduled-change` | `subscriptions:cancel-scheduled-change` | `200 APPLIED` |
| POST | `/organizations/{id}/trial/start` | `trials:manage` | `200 TRIAL_STARTED`, com `trialEndsAt` |

Os grants são explícitos e independentes. Credenciais existentes conservam os grants cadastrados. O endpoint legado `/capabilities` conserva o contrato de conexão. A fronteira permanece desabilitada por padrão. A referência `X-Nexus-Administrator-Id` é opcional nas leituras e obrigatória nas escritas. O Orbit autentica o principal técnico e registra a referência declarada em campo separado na auditoria.

### Leituras

- `/plans` inclui ofertas globais ativas e inativas. O parâmetro `organizationId` acrescenta somente as ofertas privadas daquela organização e vale também para a consulta individual. `prices` usa unidades monetárias menores, como centavos. `checkoutIntervals` indica periodicidades com preço integrado no catálogo. O checkout depende também da configuração de cobrança e da elegibilidade da organização. `trialDays` indica a duração da oferta, enquanto `/trial` consulta a elegibilidade da organização. `allocation` e `usage` representam os limites. Valores ilimitados usam `unlimited: true` e `value: null`.
- `/subscription` retorna a assinatura corrente ou a última encerrada. `subscription` pode ser `null`. Campos `persisted*` vêm da linha canônica e `status`, `effectiveStatus`, `planCode` e `billingInterval` descrevem a projeção na leitura. `billingPeriod`, `cancelAtPeriodEnd` e `pendingChange` indicam o período contratado, a intenção de encerrar no vencimento e a alteração já agendada. `entitlements.accessGranted` e os demais entitlements vêm do resolvedor canônico, incluindo eventuais ajustes.
- `payment` usa os registros locais de cobrança. `latestInvoice` pode ser `null`, inclusive em uma assinatura `ACTIVE`. O valor recebido vem de `amountPaidMinor`. `checkout`, `upgradePending` e `refundStatus` informam o que está registrado nos respectivos fluxos. `customerBilling` descreve as ações do cliente. `corporateActions` sinaliza condições para as rotas administrativas, sujeitas ao grant e à revalidação no comando. `REVIEW_IF_ELIGIBLE` depende do plano e da periodicidade escolhidos. Nenhuma leitura faz chamadas ao Stripe.
- `/trial` mostra ofertas ativas com trial, a avaliação registrada e o histórico da própria organização. `canStart` considera o contrato pendente, a elegibilidade canônica por documento e as condições de cobrança. O início revalida todos os requisitos e a versão da oferta.

### Operações e recuperação

`change-plan` registra revisão somente em contratos vigentes cujo fluxo canônico encaminharia o pedido à análise administrativa sem consulta ao Stripe. O recibo `AWAITING_REVIEW` comprova a criação do ticket. A conclusão comercial deve ser consultada em uma nova leitura da assinatura. Upgrades e downgrades que exigem checkout, aceite de cobrança ou mutação no Stripe continuam no fluxo do cliente e do provedor.

`keep` e `cancel-scheduled-change` desfazem agendamentos locais de assinaturas sem vínculo com o provedor e sem contratação ou pagamento em curso. A retirada de cancelamento exige um período vigente. Solicitar um novo cancelamento depende da confirmação do cliente sobre retenção e exclusão de dados. A API corporativa não oferece essa rota.

`trial/start` reutiliza as regras do contrato pendente e a duração da oferta vigente. Exige entrada elegível com documento, ausência de contratação concorrente e disponibilidade da cobrança na aplicação. A concessão é única conforme a política canônica de trial e pagamento. Não há operação de extensão.

Todas as escritas exigem o `expectedSubscriptionId`, o `expectedVersion`, um `reason` enumerado e `Idempotency-Key` com 16 a 120 caracteres do conjunto `A–Z`, `a–z`, `0–9`, `_` e `-`. Mudança de plano e início de trial também exigem `planCode` e `expectedCatalogVersion`; `billingInterval` é opcional. Os motivos são `ADMINISTRATIVE`, `CUSTOMER_REQUEST`, `CONTRACT_REVIEW` e `CORRECTION`. Escolher `CUSTOMER_REQUEST` registra o motivo e não supre consentimento.

O Orbit vincula a chave ao principal, à organização e ao tipo de comando. Após timeout, conexão interrompida ou `5xx`, repita a mesma requisição com a chave original, mesmo que a versão informada tenha ficado antiga. Uma assinatura bloqueada temporariamente por outra transação retorna `503 SERVICE_UNAVAILABLE`. `replayed: true` identifica o recibo já gravado. Quando o ID for conhecido, consulte o recibo em `/operations/{operationId}`. A mesma chave com outro conteúdo retorna `409 IDEMPOTENCY_MISMATCH`. Versão desatualizada retorna `409 STALE_VERSION` ou o conflito canônico de catálogo. Regra comercial impeditiva ou inelegibilidade também retorna 409. Corrija os parâmetros ou aguarde o fluxo do cliente antes de emitir uma nova intenção com outra chave. A API retorna 404 para recursos fora do escopo consultado, 401 para falha de autenticação e 403 para grant insuficiente.

Tentativa, recibo e resultado são correlacionáveis na auditoria. O efeito local, o recibo e o registro terminal confirmado compartilham a transação. A tentativa é registrada separadamente para diagnóstico. O resultado de auditoria `UNCONFIRMED` pede a recuperação pela chave original. Nenhuma escrita corporativa envia comandos ao Stripe. A migration cria apenas o registro de comandos e as políticas RLS necessárias. [OpenAPI](openapi.json)

## Promoções, cupons e descontos · ADM-05.A

| Método | Rota sob `/api/v1/corporate-admin` | Capability | Sucesso |
| --- | --- | --- | --- |
| GET | `/promotions` | `promotions:read` | 200 |
| GET | `/promotions/{id}` | `promotions:read` | 200 |
| GET | `/promotions/{id}/redemptions` | `promotions:read` | 200 |
| POST | `/promotions` | `promotions:create` | 201 |
| PATCH | `/promotions/{id}` | `promotions:update` | 200 |
| POST | `/promotions/{id}/activate` | `promotions:activate` | 200 ou 202 |
| POST | `/promotions/{id}/deactivate` | `promotions:deactivate` | 200 ou 202 |

As novas capabilities exigem concessão explícita. A API continua desabilitada por padrão. A listagem filtra por `status` e prefixo de `code`, sem distinção de caixa. Listagem e utilizações aceitam `page` e `pageSize`, com padrão 1 e 25 e até 100 itens por página. O detalhe e o histórico usam UUID. Códigos são únicos, normalizados em maiúsculas e permanentes. O histórico administrativo associa tentativa e resultado ao principal técnico, à referência declarada do administrador, à promoção e à correlação. [OpenAPI](openapi.json)

### Condições comerciais

- Use `percentOff` inteiro de 1 a 99 ou `amountOffMinor` em centavos com `currency: BRL`. O valor fixo deve ser menor que todos os preços-base elegíveis. O Stripe calcula o desconto efetivo. O Orbit mantém o preço-base do catálogo.
- Sem `durationMonths` vale a primeira cobrança do checkout. Para 2 a 12 meses, selecione somente `MONTHLY`. As condições usam `startsAt` e `endsAt` com fuso explícito, planos públicos ativos e periodicidades com preço publicado e validado no Stripe. A ativação fixa os IDs de preço. Um novo preço só passa a valer para uma nova campanha.
- `totalLimit` e `customerLimit` incluem utilizações confirmadas e reservas concorrentes. O cliente para esse limite é a organização titular da contratação. A audiência aceita `ANY`, `NEW_CUSTOMER` ou `EXISTING_CUSTOMER`. O histórico canônico de assinaturas ativas ou vinculadas ao provedor e a evidência de pagamento identificam clientes existentes.
- Após iniciar a ativação, condições comerciais ficam imutáveis. A edição de nome e descrição internos é permitida fora de transições em curso. Desativação é definitiva para aquele código. Benefícios já confirmados permanecem vinculados à campanha.

### Checkout e histórico de utilizações

O checkout autenticado existente (`POST /api/v1/billing/checkout-session`) aceita `promotionCode` opcional. O código é avaliado pelo backend e aplicado como um único desconto explícito na sessão Stripe, sem liberar digitação de códigos no checkout hospedado. O fluxo atende a contratação paga sem trial em curso. Isso inclui o retorno de um cliente que já teve assinatura. Mudanças em assinaturas vinculadas ao provedor seguem os fluxos canônicos atuais.

A reserva nasce na tentativa de checkout e protege os limites por campanha e por organização. `RESERVED` significa sessão em criação ou aberta. `CONFIRMED` significa que a confirmação do Stripe comprovou o desconto, seu valor e o preço original. `RELEASED` corresponde a uma tentativa encerrada sem confirmação. Uma sessão promocional dura até uma hora, limitada ao término da campanha. O Stripe exige antecedência para expiração. Por isso, novas sessões são aceitas com mais de 31 minutos restantes. A expiração confirmada pelo Stripe libera a vaga. Uma tentativa de desfecho desconhecido conserva a reserva até a reconciliação. Os campos `originalMinor` e `discountMinor` são valores em centavos, com `discountMinor` nulo até a confirmação. O histórico registra a utilização do checkout. Descontos de mensalidades seguintes aparecem na projeção canônica das faturas.

### Ativação, auditoria e recuperação

As escritas exigem `X-Nexus-Administrator-Id`, `Idempotency-Key` de 16 a 120 caracteres e `reason` enumerado. Edição e transições exigem `expectedVersion`. Reutilizar a chave com outro conteúdo retorna `409 IDEMPOTENCY_MISMATCH`. Versão antiga retorna `409 STALE_VERSION`. Ausência de grant devolve 403. A auditoria registra metadados de operação e omite chaves, credenciais e payloads financeiros.

O rascunho existe só no Orbit. A ativação grava `ACTIVATING` antes de validar produtos e preços pelo Stripe e criar Coupon e Promotion Code no mesmo modo `TEST` ou `LIVE`. O estado `ACTIVE` exige confirmação dos dois recursos. O início de desativação grava `DEACTIVATING` e interrompe novas reservas imediatamente. `INACTIVE` aparece após a confirmação do Stripe. Os dois fluxos usam identificadores determinísticos e chaves estáveis no provedor. Operações locais, recibos e auditoria ficam na mesma transação PostgreSQL. A rede com o Stripe acontece entre transações.

`202` devolve `operationId`, `pending: true` e a promoção em transição. Reenvie a mesma solicitação com a chave, o motivo e a versão originais e o mesmo principal técnico. Faça o mesmo se a resposta perder-se após o envio. Se o Orbit já gravou o resultado, o recibo reaparece com `replayed: true`. Após 20 horas, uma ativação incerta só confirma recursos que o Stripe já identifica. Se a validação de preço falhar ou o provedor continuar sem evidência, a campanha permanece indisponível. Use o `operationId` e a correlação para localizar a tentativa antes de abrir outra campanha com código distinto.

Para liberar reservas automaticamente após a expiração, a lista de eventos do webhook Stripe deve incluir `checkout.session.expired`. Se a chave for restrita, a ativação usa leitura de preços e produtos e leitura/escrita de Coupon e Promotion Code. A janela local de repetição fica abaixo da retenção documentada das chaves da API v1. [Descontos no Stripe Checkout](https://docs.stripe.com/payments/checkout/discounts) · [Idempotência do Stripe](https://docs.stripe.com/api/idempotent_requests)

## ADM-06.A — Financeiro corporativo do SaaS

Estas rotas consultam o faturamento da Allblue Labs para assinantes do Orbit. Elas usam a autenticação técnica opt-in da ADM-01.A. Conceda cada capability explicitamente ao principal do ambiente. O cabeçalho opcional `X-Nexus-Administrator-Id` declara a referência do operador e segue para auditoria com o principal técnico e a correlação. A API devolve `Cache-Control: private, no-store`. [OpenAPI](openapi.json)

| GET sob `/api/v1/corporate-admin` | Capabilities exigidas |
| --- | --- |
| `/finance/overview` | `finance:overview:read` |
| `/finance/invoices`, `/finance/invoices/{id}` | `finance:invoices:read` |
| `/finance/payments`, `/finance/payments/{id}` | `finance:payments:read` |
| `/organizations/{id}/finance` | `finance:organizations:read` |
| `/organizations/{id}/finance/invoices` | `finance:organizations:read` e `finance:invoices:read` |
| `/organizations/{id}/finance/payments` | `finance:organizations:read` e `finance:payments:read` |

### Consultas e filtros

- Informe `mode=TEST` ou `mode=LIVE` em todas as rotas. Listagens e resumos também exigem `currency` em três letras maiúsculas e `from` e `to` em `YYYY-MM-DD`. Aceitam de 1 a 366 dias, a partir de `from` inclusive até `to` exclusive, à meia-noite UTC. Cada consulta usa uma única moeda. Detalhes retornam a moeda do registro.
- `planCode` filtra a atribuição histórica da fatura. Faturas sem código continuam acessíveis sem esse filtro. `unattributedInvoiceCount` conta as faturas sem atribuição dentro do recorte retornado.
- Listagens retornam `items`, `total`, `page` e `pageSize`. Os padrões são 1 e 25, com limites de 10.000 páginas e 100 itens por página. `sort` aceita `DATE_DESC` (padrão), `DATE_ASC`, `AMOUNT_DESC` e `AMOUNT_ASC`, com desempate por identificador e valores nulos ao final.
- Faturas aceitam `status` canônico e `search` pelo UUID ou trecho literal do número sem distinção de caixa. Pagamentos aceitam `kind` e `status`. Para o detalhe, use o UUID da fatura ou o identificador opaco de pagamento exatamente como aparece na listagem. O documento OpenAPI contém exemplos sintéticos completos. [OpenAPI](openapi.json)

Uma consulta sintética de janeiro de 2026 seria `GET /api/v1/corporate-admin/finance/overview?mode=TEST&currency=BRL&from=2026-01-01&to=2026-02-01`. Para encontrar reembolsos concluídos, aplique `kind=REFUND&status=SUCCEEDED` na listagem de pagamentos com os mesmos filtros.

### Critérios e cobertura

| Indicador | Critério |
| --- | --- |
| Faturamento e descontos | `subtotalMinor`, `billedMinor` e `discountMinor` vêm da projeção da fatura em `OPEN`, `PAID` ou `UNCOLLECTIBLE`. Data de emissão `finalizedAt`, com o timestamp de criação como fallback para registros legados. Faturas de outros estados aparecem nas contagens. `billedMinor` é o total da fatura após descontos e com os impostos registrados. |
| Saldo aberto e inadimplência | `openMinor` soma saldos positivos das faturas `OPEN` emitidas no período. `overdueMinor` exige vencimento conhecido anterior a `asOf`. `pendingMinor` inclui saldos abertos sem vencimento informado ou com vencimento presente/futuro. `overdueOrganizationCount` conta organizações distintas com saldo vencido no recorte. `uncollectibleMinor` mostra à parte o saldo declarado incobrável. Um saldo antigo exige uma janela que inclua sua emissão. |
| Recebimentos | `confirmedReceivedMinor` soma alocações únicas de Stripe InvoicePayment com PaymentIntent confirmado, com a data original da alocação paga. Dois rateios legítimos do mesmo PaymentIntent contam pelos seus próprios valores. A soma usa o período do pagamento ainda que a fatura seja anterior. `providerSettledMinor` na fatura pode incluir liquidação externa, créditos ou outros meios. |
| Reembolsos e ajustes | `recordedRefundMinor` soma somente reembolsos Stripe únicos atualmente em `SUCCEEDED`, agrupados pela data de criação original do ajuste. O registro de ajuste indica a última observação e conserva o tipo e estado canônico. A data efetiva de conclusão do reembolso e sua extensão parcial ou integral ficam indeterminadas sem prova persistida suficiente. Disputas e créditos da fatura aparecem separadamente, com seus próprios estados ou valores. |
| Evolução | `monthly` agrega por mês UTC de emissão, confirmação do pagamento ou criação do ajuste, conforme a métrica. A série inclui meses que possuem registros e avalia os saldos conforme a projeção disponível em `asOf`. Para contagens de organizações, use o total do período para deduplicação. |
| Assinatura e próxima cobrança | O resumo por organização distingue status operacional e status efetivo da assinatura canônica no instante de consulta. Quando a organização já encerrou o último contrato, a resposta conserva o estado final e a data em `subscription.endedAt`. A assinatura Stripe exige que seu customer corresponda à organização e ao modo selecionado. `ORBIT_ONLY` indica uma assinatura local sem vínculo Stripe. `nextChargeAt` representa a próxima tentativa automática futura observada em uma fatura aberta do mesmo vínculo e moeda. |

Períodos e totais são processados no PostgreSQL. Valores monetários usam unidades inteiras mínimas da moeda, por exemplo 8000 para R$ 80,00. Valores individuais cabem em inteiros JSON. Somas são strings decimais exatas e ficam `null` quando a métrica não tem registros qualificados no recorte. `"0"` representa uma soma com valor zero. Contagens sempre são numéricas. `netConfirmedMinor` fica `null` porque os dados atuais não comprovam o caixa líquido por competência do reembolso nem a cobertura integral do histórico.

O campo `source` identifica a projeção reconciliada local. `asOf` indica quando a consulta avaliou a projeção. `invoiceObservedAt` e `paymentObservedAt` indicam as observações mais recentes entre os fatos filtrados. `settledWithoutReceiptEvidenceCount` sinaliza faturas liquidadas, inclusive liquidações de valor zero, ou com valor liquidado informado e sem evidência válida de uma alocação de caixa.

A listagem de pagamentos mostra `RECEIPT/CONFIRMED` quando há evidência e `ATTEMPT/REJECTED` quando a transição da fatura registra o evento de falha com data original. Tentativas rejeitadas têm valor nulo. `REFUND` e `DISPUTE` usam a projeção do ajuste, incluindo `PENDING` e `CANCELED` quando informados pelo provedor. Eventos da fila de reconciliação ainda sem vínculo confirmado com uma fatura ficam de fora. Os indicadores mostram os fatos já registrados e suas datas de observação. MRR, ARR e reconhecimento contábil ficam fora deste contrato. [Garantias ORB-NX-04](../../../release/orb-nx-04-stripe-recovery.md)

### Rollout e isolamento

A migration `20261127120000_corporate_finance` acrescenta políticas RLS de leitura, uma política para gravar a auditoria e um índice de período. A aplicação registra `plan_code_at_issue` apenas após observar uma fatura finalizada com linhas de assinatura completas e preços históricos que apontem inequivocamente para o mesmo plano. Faturas legadas ou ambíguas preservam o valor nulo até existir evidência inequívoca. A migration dispensa backfill. Acompanhe o DDL pelo gate normal do banco, pois a criação do índice requer lock na tabela.

As consultas usam somente faturas, evidências, ajustes e transições da cobrança do SaaS. Elas não solicitam dados ao Stripe nem alteram cobranças, assinaturas ou pagamentos. A auditoria grava apenas metadados de acesso. IDs do provedor, URLs privadas, dados de cartão e payloads de reconciliação ficam fora das respostas. Os descontos históricos da ADM-05.A entram pela fatura reconciliada. O valor reservado no checkout é informação gerencial daquele fluxo e fica fora desta soma. [OpenAPI](openapi.json)

## ADM-07.R.A — Indicadores comerciais

As quatro consultas GET usam `/api/v1/corporate-admin/analytics`. Cada rota requer a capability correspondente na credencial técnica. A API corporativa exige ativação explícita e as credenciais anteriores preservam seus grants. A resposta é privada e usa `no-store`. A auditoria registra o principal técnico, a referência administrativa quando informada, a correlação, a operação, o modo e o resultado. [OpenAPI](openapi.json)

| Rota | Capability | Fonte |
| --- | --- | --- |
| `/recurring-revenue` | `analytics:revenue:read` | Observação do contrato Stripe registrada na reconciliação |
| `/customer-lifecycle` | `analytics:lifecycle:read` | Alocações confirmadas de pagamento e encerramentos registrados nas assinaturas |
| `/trial-conversion` | `analytics:trials:read` | Concessões de trial do Orbit e alocações confirmadas de pagamento |
| `/delinquency` | `analytics:delinquency:read` | Faturas reconciliadas com os critérios da ADM-06.A |

Todas as rotas exigem `mode=TEST` ou `mode=LIVE` e `currency` de três letras maiúsculas. Três rotas também exigem `from` e `to`, com janela de 1 a 366 dias entre o início inclusivo e o fim exclusivo, à meia-noite UTC. A receita recorrente é um retrato no `asOf` da transação e retorna `period: null`. O filtro opcional `planCode` identifica o plano corrente em receita, o plano da primeira concessão em trials e o plano documentado na emissão em inadimplência. Ciclo de clientes agrega movimentos da organização através de seus vários contratos.

### MRR, ARR e ARPA

A população parte de assinaturas Stripe ativas no período corrente e vinculadas ao customer do modo consultado. A organização pode estar operacionalmente suspensa. A observação deve corresponder ao preço contratado e ao período registrados na assinatura. O pagamento é comprovado por alocações positivas únicas via PaymentIntent na fatura do mesmo customer, assinatura, moeda, preço e período. A soma das alocações válidas deve cobrir integralmente o valor pago registrado, com saldo e créditos zerados. No MRR, o recebimento serve apenas para comprovar elegibilidade. O valor é o preço recorrente contratado que a reconciliação observou no provedor.

Os agregados incluem preço bruto, desconto recorrente e preço líquido, no total e agrupados por plano e periodicidade. Para períodos de 1, 6 ou 12 meses, o valor mensal retornado é `(preço em unidades mínimas × 10.000 − desconto recorrente em unidades mínimas × 10.000) × (12 ÷ meses)`. Os valores são strings inteiras exatas. Divida por `scale = 120000` para obter unidades mínimas mensais. Adie o arredondamento até a apresentação. ARR é MRR × 12. ARPA mensal usa MRR dividido por `coverage.pricedOrganizations` do mesmo recorte e fica indisponível se esse número for zero.

A projeção cobre preço fixo para um item e quantidade unitária, sem imposto inclusivo. Cobre cupom recorrente único vinculado à assinatura, compatível com o produto e a moeda, com percentual de até duas casas ou valor fixo limitado ao preço. Um desconto pontual fica fora do MRR. Desconto com fim conhecido deixa de valer ao alcançar a data efetiva. Descontos acumulados, herdados, por item ou ambíguos ficam sem precificação por esta projeção. [Descontos da Stripe](https://docs.stripe.com/api/discounts/object)

`AVAILABLE` indica cobertura integral da população candidata, incluindo o recorte comprovadamente vazio, com valor `"0"`. `PARTIAL` informa valores exatos do subconjunto precificado. `UNAVAILABLE` indica lacunas sem contratos precificados no recorte, com valores `null`. `eligibleOrganizations` fica `null` se o total pagante não puder ser comprovado. `confirmedEligibleOrganizations` conta o subconjunto confirmado, inclusive casos com desconto desconhecido. `coverage` expõe candidatos, termos desconhecidos, pagamento sem comprovação, contratos elegíveis sem preço líquido, contratos precificados e o intervalo das observações usadas. Contratos que ainda não passaram pela reconciliação com a nova projeção aparecem como lacuna quando pertencem à população candidata.

### Crescimento e retenção

O primeiro recebimento observado conta uma organização uma vez. O primeiro recebimento em qualquer contrato no período também conta organizações distintas, inclusive as que retornaram. Cancelamento comprovado exige assinatura com estado `CANCELED` e `endedAt` posterior à primeira alocação confirmada no mesmo contrato. Uma reativação comprovada exige o primeiro recebimento de outro contrato após esse encerramento. Agendamentos de cancelamento e suspensões operacionais ficam fora das contagens de encerramento.

O endpoint retorna `null` para bases pagantes de abertura e fechamento, perdas, retenção e variações de MRR. Os dados atuais conservam alguns fatos e a última observação do contrato. Para calcular esses indicadores históricos, a reconciliação precisaria preservar as transições efetivas do estado pago e os termos recorrentes vigentes em cada transição, com data efetiva e modo, moeda e preço antes e depois. A menor extensão futura é registrar essas observações nas estruturas de histórico existentes a partir do momento em que forem comprovadas.

### Conversão de trials

A coorte usa a primeira concessão de cada organização, pelo início registrado. Em andamento e encerrado usam a data prevista de término. A janela de conversão começa no início e termina 30 dias de 24 horas após o fim previsto, com o limite superior exclusivo. A primeira alocação positiva confirmada da organização, na moeda e no modo pedidos, deve cair nessa janela. Checkout iniciado, encerramento do trial e liquidação sem alocação ficam fora dos convertidos. A população elegível corresponde a trials cuja janela já fechou. `confirmedEligibleConversions` conta quem converteu dentro desse subconjunto.

A concessão é local e a evidência positiva é específica do modo e da moeda. O percentual sai `null`. Para provar a taxa, as concessões futuras precisam carregar o escopo comercial aplicável à coorte e ter cobertura comprovável de pagamentos durante a janela inteira.

### Inadimplência

Numerador e denominador compartilham as organizações distintas com fatura positiva emitida em `OPEN`, `PAID` ou `UNCOLLECTIBLE` no período e nos filtros informados. O numerador exige fatura `OPEN` com saldo positivo e vencimento anterior a `asOf`. O saldo marcado como incobrável permanece separado pela semântica da ADM-06.A. A data de emissão é `finalizedAt`, com fallback para `createdAt` do provedor. `observedRatePercent` é `100 × inadimplentes ÷ elegíveis`, arredondado a duas casas, ou `null` sem denominador. Faturas abertas sem vencimento permanecem no denominador e sinalizam cobertura parcial. Com filtro por plano, faturas sem atribuição ficam fora da população e aparecem na contagem de lacunas.

### Banco e rollout

A migration `20261127130000_corporate_commercial_analytics` cria uma projeção JSONB opcional em assinaturas, índices para datas de coorte e encerramento, políticas RLS de leitura com escopo por operação e modo, e a permissão restrita de auditoria. Use o gate de migrations habitual. A coluna começa vazia. A reconciliação já existente passa a gravar a observação dos termos em sua transação e versão atuais. As consultas agregam no PostgreSQL e usam somente dados locais. Os indicadores têm um limite de execução por instrução SQL de cinco segundos.

## ADM-08.A — Suporte e diagnóstico corporativo

As rotas estão sob `/api/v1/corporate-admin`. As credenciais técnicas precisam dos grants correspondentes. A API corporativa continua desabilitada por padrão. As consultas usam o PostgreSQL local e respondem com cache privado. [OpenAPI](openapi.json)

| Método e rota | Capability |
| --- | --- |
| `GET /support/tickets`, `GET /support/tickets/{id}` | `support:tickets:read` |
| `POST /support/tickets` | `support:tickets:create` |
| `PATCH /support/tickets/{id}`, `POST /support/tickets/{id}/notes` | `support:tickets:update` |
| `GET /organizations/{id}/diagnostics` | `diagnostics:organizations:read` |
| `GET /diagnostics/integrations` | `diagnostics:integrations:read` |
| `GET /diagnostics/operations`, `GET /diagnostics/operations/{id}` | `diagnostics:operations:read` |
| `POST /diagnostics/provisionings/{id}/resume` | `recovery:provisioning:resume` |

### Chamados e escritas

A fila reúne chamados administrativos das categorias `ACCOUNT_ACCESS`, `TECHNICAL` e `GENERAL`, e solicitações comerciais existentes de alteração de plano, cancelamento e análise de reembolso. Os filtros incluem organização, origem, categoria, prioridade, estado e responsável. `search` busca trecho literal de título ou nome da organização e também aceita o ID exato. A ordenação é por criação decrescente e ID, com paginação de 1 a 100 itens e 25 por padrão. A listagem conserva a referência local de assinatura e o plano solicitado quando disponíveis.

As escritas exigem `X-Nexus-Administrator-Id` e uma chave `Idempotency-Key` de 16 a 128 caracteres ASCII alfanuméricos ou `_.:-`. O recorte de idempotência é o principal técnico. Repetir a chave com o mesmo comando e administrador devolve o recibo com `replayed: true`. Reutilizá-la para outro conteúdo retorna `409 IDEMPOTENCY_MISMATCH`. Para atualizar um chamado ou registrar uma nota, envie `expectedVersion` da última leitura. Uma versão divergente retorna `409 STALE_VERSION`, inclusive após uma resolução pelo fluxo de cobrança legado.

Prioridades são `LOW`, `NORMAL`, `HIGH` e `URGENT`. Atribuição aceita uma referência UUID declarada do Nexus e `null` para removê-la. O Nexus resolve a identidade e a elegibilidade desse responsável. Um chamado nasce `OPEN` e pode passar para `RESOLVED` mediante resolução interna. Notas podem complementar chamados já encerrados. Encerrar uma solicitação comercial atualiza somente o chamado canônico. O efeito financeiro ou comercial exige o respectivo fluxo já existente.

O detalhe inclui até 50 interações internas, da mais recente para a mais antiga. Passe `nextBefore` em `before` para ler mais. Títulos e notas são texto simples. As notas, a resolução corporativa e as atribuições ficam no fluxo administrativo. As solicitações comerciais anteriores conservam as datas conhecidas de criação e resolução. A auditoria guarda ação, decisão, identificadores e correlação. O conteúdo dos chamados e das notas fica fora dos logs de auditoria.

### Diagnóstico

- **Organização.** O estado operacional é separado do estado efetivo da assinatura e da restrição de cobrança. `PAYMENT_ATTENTION` sinaliza atraso ou carência com acesso preservado pela política vigente. A projeção inclui os direitos efetivos, indicadores de confirmação de e-mail e troca de senha do responsável, estágio de provisionamento, operações comerciais abertas e a última observação disponível de assinatura e fatura. Inconsistências usam códigos estáveis e um campo nulo representa evidência indisponível.
- **Integrações.** Stripe e SES retornam configuração e evidência local em campos próprios. `UNOBSERVED` significa fila ou checkpoint sem registros disponíveis na consulta. Os totais são agrupados por fonte, estado e modo. Uma aceitação pelo SES registra aceite do provedor. O endpoint não testa os provedores durante a consulta.
- **Operações.** A visão reúne os fluxos de provisionamento, a inbox e os checkpoints Stripe, e as filas de e-mail de identidade e contato. Filtros por organização se aplicam somente a registros com vínculo local explícito. O filtro de modo recorta somente fontes Stripe. A rota de detalhe aceita UUID local ou chave de checkpoint no formato `STRIPE:TEST:EVENTS`. Erros fora da lista segura saem como `UNCLASSIFIED_FAILURE`. A correlação é retornada quando a fonte a registra em formato válido. As datas representam registros locais. O diagnóstico não publica IDs da Stripe, cursores internos, hashes de token, destinatários, links, payloads ou stack traces.

### Retomar provisionamento

Localize o workflow e sua versão em `GET /diagnostics/operations?type=TENANT_PROVISIONING` ou no detalhe da operação. A retomada exige o mesmo principal técnico que criou o workflow, a versão corrente e um motivo explícito entre `DEPENDENCY_RESTORED`, `WORKFLOW_INTERRUPTED` e `RETRY_AFTER_REVIEW`. Os estágios `TENANT_CREATED` e `SUBSCRIPTION_READY` reutilizam as transações e os locks da ADM-03.A. O estágio `RECEIVED` exige o envio original pelo fluxo de provisionamento. A resposta usa `200` quando concluído e `202` quando ainda há etapa pendente. Depois de verificar a causa de um `202`, leia a versão atual antes de abrir uma nova tentativa com outra chave.

Em caso de falha de comunicação, repita a mesma chave. Se o processo cair depois de persistir um estágio e antes de registrar o recibo, leia a versão atual. Os locks e o estado persistido da ADM-03.A protegem a criação da assinatura e a fila de ativação contra duplicação. As filas de Stripe e SES têm diagnóstico nesta versão. A retomada exposta por esta API é a do workflow administrativo. O reenvio de e-mails com rejeição comprovada continua sujeito às verificações e à autoridade humana do painel interno de jobs. O formulário público aparece no diagnóstico como processamento de contato.

A migration `20261127140000_corporate_support` cria a fila, o histórico interno e os recibos, estende os chamados comerciais com prioridade e versão compartilhada e instala políticas RLS específicas. A versão dos chamados legados começa em 1 e a migração preserva os chamados existentes sem reconstituir interações antigas.

## ADM-08.R.A · Complementação para as interfaces do Nexus

As consultas usam a autenticação técnica existente e permanecem habilitadas somente mediante configuração explícita do módulo. Campos opcionais de contratos existentes exigem `includeDetails=true` ou `includeOrganizationName=true`. Clientes já integrados continuam recebendo o formato anterior.

| Origem | Rota relativa a `/api/v1/corporate-admin` | Capabilities | Cobertura |
| --- | --- | --- | --- |
| ADM-UI-02 | `GET /tenant-provisionings` | `organizations:provisioning:read` | Workflows do principal autenticado, com paginação e filtros por `organizationId`, `status`, `createdFrom` inclusivo e `createdBefore` exclusivo. Datas em UTC. |
| ADM-UI-02/03/05 | `GET /organizations/{id}/administrative-receipts`, `GET /administrative-receipts/lookup` | `receipts:read` | Histórico por organização e tipo, e consulta por ID ou chave original. Requer concessão explícita na credencial. |
| ADM-UI-03 | `GET /subscriptions` | `subscriptions:read` | Assinatura corrente ou última de cada organização, com estados persistido e efetivo no instante `asOf`. Filtros de plano, periodicidade e estado usam os valores persistidos. Organizações sem assinatura canônica ficam fora. |
| ADM-UI-03 | `GET /organizations/{id}/trial?includeDetails=true` | `trials:read` | `blockedReason` explica o primeiro bloqueio comprovado. A resposta preserva `canStart` e omite o documento e sua impressão. |
| ADM-UI-03 | `GET /promotions/{id}/redemption-summary?mode=TEST` | `promotions:read` | Reservas, confirmações e liberações em todos os checkouts locais da campanha. O modo deve corresponder ao registrado na campanha. |
| ADM-UI-04 | Coleções e detalhes de faturas e pagamentos em `/finance` | Grants financeiros existentes | `includeOrganizationName=true` inclui o nome corrente autorizado. Nas coleções de pagamentos, `invoiceId` filtra pelo UUID local da fatura, inclusive na coleção por organização. |
| ADM-UI-05 | `GET /support/tickets`, `GET /support/tickets/{id}` | `support:tickets:read`, com `receipts:read` para a origem | Ordenação por criação, atualização ou prioridade. `includeDetails=true` habilita as contagens da fila e o vínculo com recibo comercial comprovado. |
| ADM-UI-05 | `GET /diagnostics/operations`, `GET /diagnostics/operations/{id}` | `diagnostics:operations:read` | `includeDetails=true` retorna nome quando há vínculo local e motivo de recuperação. O detalhe também informa a cobertura de eventos registrados. |
| ADM-UI-05 | `GET /capabilities/effective` | `connection:read` | `contractCapabilities` enumera o contrato. `grantedCapabilities` mostra somente as concessões da credencial atual. A elegibilidade do recurso continua na respectiva consulta, como `corporateActions`, `canStart` ou `recoveryEligibility`. |

### Leitura de recibos e cobertura histórica

Envie exatamente `operationId` ou o cabeçalho `Idempotency-Key` original na consulta de recibos. Para `OPERATIONAL` e `COMMERCIAL`, envie `organizationId`. Uma consulta por chave comercial ou promocional também exige `operation`. Os identificadores são o UUID do workflow, da decisão operacional, do comando comercial/promocional ou da interação de suporte. Para recibos de retomada pelo suporte, use a chave original. Nesses recibos, `id` é nulo e `outcome.targetId` identifica o workflow. Campanhas são globais e ficam fora do histórico por organização.

O resultado de um workflow vem do seu registro atual; decisões, comandos e interações usam o recibo persistido. Um comando promocional com `pending=true` tem registro local sem confirmação final. `404` representa ausência de evidência acessível, inclusive quando o registro pertence a outro principal. Um recibo comprova somente o resultado inscrito nele. Por exemplo, `AWAITING_REVIEW` confirma uma solicitação de revisão, e `version` por si só não comprova execução de um comando. Permissão de leitura de recibos não concede execução ou retomada.

### Agregações, suporte e diagnóstico

- Campanhas usam `ORBIT_CHECKOUT_ATTEMPTS` como cobertura. `confirmedDiscountMinor` é uma string decimal em centavos de BRL. `confirmedWithoutDiscount` informa eventuais confirmações sem valor registrado. Os totais não incluem reservas no valor de desconto, nem usos externos ao Orbit ou recorrências sem evidência de checkout local. A quantidade usa os estados armazenados. Uma campanha sem modo registrado retorna `404` no resumo.
- O filtro de pagamentos por fatura é aplicado aos registros canônicos após a deduplicação. Modo, moeda e janela ficam ativos. O nome é uma referência atual da organização e não representa o nome histórico de faturamento. Faturas e ajustes financeiros mantêm os fatos reconciliados e a precisão original.
- As contagens de suporte usam todos os filtros da fila, exceto `status`, para mostrar as duas situações disponíveis. A ordenação aceita `CREATED_DESC`, `CREATED_ASC`, `UPDATED_DESC`, `UPDATED_ASC` e `PRIORITY_DESC`, com desempate por ID. `originReceiptId` é preenchido quando o comando do principal efetivamente criou o chamado. Vínculos antigos sem comprovação de criação ficam nulos, assim como tickets reaproveitados sem um comando de origem acessível. Notas internas não fazem parte dos recibos.
- O diagnóstico fornece até 50 eventos duráveis mais recentes de provisionamentos do próprio principal, com indicador de truncamento. Esses eventos registram avanço de etapa ou falha persistida. Para integrações e workflows sem evidência própria, a cobertura é `UNAVAILABLE`. Não há reconstrução de tentativas de Stripe ou SES a partir de contadores. Os nomes só aparecem quando a fonte contém um vínculo local autorizado.

A migration `20261127150000_corporate_administrative_reads` acrescenta políticas de leitura por escopo, índices e uma referência opcional de origem nos recibos comerciais. A referência só é registrada quando a inserção do chamado foi comprovada. A migration preserva as políticas anteriores e não preenche vínculos retroativamente. A rota legada `GET /capabilities` mantém o resultado original. [OpenAPI 3.1](openapi.json)
