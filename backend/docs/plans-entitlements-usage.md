# Planos, direitos e cotas mensais

## O que esta camada decide

Três perguntas diferentes, respondidas em lugares diferentes:

| Pergunta | Quem responde | Onde |
|---|---|---|
| A empresa contratou esta área? | `EntitlementService.hasCapability` | catálogo em código |
| Esta pessoa pode executar a ação? | `CapabilityGuard` / `PermissionsGuard` | `plans.capabilities`, papéis |
| O domínio permite agora? | serviço da área | regra de negócio |

As três se somam e nenhuma substitui a outra. A separação entre as duas
primeiras está registrada em `docs/adr/ADR-006-rbac-versus-product-entitlement.md`:
`plans.capabilities` é uma lista de **permissões** com nome histórico, e não o
catálogo comercial.

Nenhuma regra de produto decide por nome de plano. Não existe
`if (plan.code === 'PROFESSIONAL_INTELLIGENCE')` acima desta camada — a API do
serviço nem devolve o plano.

## Os quatro planos

| | Essencial | Profissional | Profissional + Inteligência | Empresarial Ilimitado |
|---|---:|---:|---:|---:|
| Código interno | `ESSENTIAL` | `PROFESSIONAL` | `PROFESSIONAL_INTELLIGENCE` | `ENTERPRISE_UNLIMITED` |
| Preço de tabela | R$ 59,90 | R$ 149,90 | R$ 249,90 | R$ 699,90 |
| **Alocação** | | | | |
| Unidades de negócio | 1 | 3 | 3 | ilimitado |
| Usuários da plataforma | 5 | 20 | 20 | ilimitado |
| Técnicos de campo | 5 | 20 | 20 | ilimitado |
| auxiliares técnico | 5 | 20 | 20 | ilimitado |
| Clientes ativos | 150 | 1.000 | 1.000 | ilimitado |
| Equipamentos ativos | 500 | 5.000 | 5.000 | ilimitado |
| **Uso mensal** | | | | |
| Ordens de serviço | 500 | 5.000 | 5.000 | ilimitado |
| Documentos PMOC | 1.000 | 10.000 | 10.000 | ilimitado |
| Documentos RVT | 1.000 | 10.000 | 10.000 | ilimitado |
| Outros documentos | 2.000 | 20.000 | 20.000 | ilimitado |
| Execuções de automação | 1.000 | 10.000 | 10.000 | ilimitado |
| **Inteligência** | não | não | sim | sim |

O código interno é estável e o rótulo é comercial: o marketing pode renomear
"Profissional + Inteligência" amanhã sem tocar em contrato histórico, semente
ou migração.

Não existe limite comercial de armazenamento em GB. Bytes continuam sendo
medidos para custo e observabilidade — isso não é direito de plano.

## Capacidades

Quinze, no catálogo V1: `CUSTOMERS`, `OPERATIONS`, `FIELD_OPERATIONS`,
`EQUIPMENT`, `PMOC`, `RVT`, `ARTIFACTS`, `DOCUMENT_TEMPLATES`,
`CUSTOMER_PORTAL`, `CUSTOMER_SERVICE_REQUESTS`, `AUTOMATIONS`, `ANALYTICS`,
`INTEGRATIONS`, `ORBIT_INTELLIGENCE`, `AI_ASSISTANTS`.

As treze primeiras são a camada operacional e existem nos quatro planos: o
Essencial não é uma versão mutilada do produto, é o produto com tetos menores.
As duas últimas são a camada de inteligência, e só dois planos as compram — é a
única capacidade que hoje diferencia planos, e portanto o único portão que
realmente recusa alguém.

## Limites: dois tipos, e a diferença importa

**Alocação** conta estado ativo simultâneo. "5 usuários" são cinco ativos
agora, não cinco novos por mês. A contagem sai sempre do estado canônico no
banco — nunca de contador mantido à mão.

**Uso** conta eventos numa janela mensal. Cinco recursos comerciais mais
`AI_COMPUTE`.

`UNLIMITED` é um caso do tipo, não um número:

```ts
type PlanLimit =
  | { kind: 'LIMITED'; value: number }
  | { kind: 'UNLIMITED' };
```

Nunca `999999`, `-1` nem `Integer.MAX_VALUE`. Um número mágico um dia é
comparado como número e vira teto silencioso. No Read Model público, ilimitado
sai como `{ "unlimited": true, "value": null }`.

## Como cada recurso é contado

### Alocação

| Recurso | Contagem canônica | Ponto de aplicação |
|---|---|---|
| `BUSINESS_UNITS` | unidades `ACTIVE` não removidas | criação de unidade |
| `PLATFORM_USERS` | vínculos de organização `ACTIVE` de usuários `ACTIVE` | aceite de convite (aviso na emissão) |
| `FIELD_TECHNICIANS` | perfis profissionais ativos com `fieldTechnicianEnabled` | habilitação da pessoa para o campo |
| `AUXILIARY_TECHNICIANS` | **a mesma conta** — uma equipe, dois nomes comerciais | habilitação da pessoa para o campo |
| `ACTIVE_CUSTOMERS` | clientes `ACTIVE` não removidos | criação de cliente |
| `ACTIVE_EQUIPMENT` | equipamentos `ACTIVE` não removidos | criação de equipamento |

Três decisões que valem por escrito:

**Identidades do Portal do Cliente não consomem usuário da plataforma.** Elas
vivem em `customer_portal_identities`, uma tabela que a contagem nem visita.
Não é um filtro que alguém pode esquecer de aplicar: é a consequência de o
Portal ter identidade própria (ADR-005).

**A mesma pessoa não paga duas vezes na mesma cota.** O perfil profissional é
único por pessoa na organização, então acumular `TECHNICAL_RESPONSIBLE` sobre
`FIELD_TECHNICIAN` continua sendo um técnico de campo.

**Auxiliar técnico não é uma categoria de pessoa.** No Orbit é uma designação
por ordem de serviço — `OperationAuxiliaryTechnician` —, e o domínio já exige
que todo auxiliar seja um `FIELD_TECHNICIAN` ativo da unidade.

Por isso a cota de equipe de campo conta **pessoas habilitadas**, e não
designações. O portão do app de campo é um só, e está em todo o módulo
`mobile-field`: perfil profissional ativo com `fieldTechnicianEnabled`, mais
vínculo ativo na unidade. Vale igual para o responsável e para o auxiliar —
`technicalResponsibleEnabled` sozinho nunca abre o app, ele concede autoridade
de assinatura.

Os dois números comerciais ("5 técnicos operadores" e "5 auxiliares técnico")
descrevem **uma equipe**. A mesma pessoa pode ser responsável numa ordem,
auxiliar noutras dez e ainda acumular `TECHNICAL_RESPONSIBLE`: continua sendo
uma pessoa e uma vaga. O teto em vigor é o mais restritivo dos dois números —
hoje iguais em todos os planos, e a regra mantém a conta honesta se um dia
deixarem de ser.

**Escalar alguém não compra licença.** Designar responsável ou auxiliar tem
delta zero. A vaga é cobrada quando a pessoa é habilitada para o campo,
liberada quando é desabilitada, e cobrada de novo quando volta. Quem chega a
uma designação já ocupa a sua vaga desde a habilitação.

> A PR-PL-01 contava designações vivas agrupadas por pessoa. Isso media quantas
> pessoas estão escaladas agora, e não quantas licenças a empresa tem — a
> PR-PL-01.1 corrigiu a semântica sem mexer em nenhum número comercial.

### Uso mensal

| Recurso | Evento canônico | Identidade de dedupe |
|---|---|---|
| `SERVICE_ORDERS_CREATED` | `Operation` criada | `OPERATION:<id>` |
| `PMOC_DOCUMENTS_ISSUED` | execução de artefato `PMOC` concluída | `ARTIFACT_EXECUTION:<id>` |
| `RVT_DOCUMENTS_ISSUED` | execução de artefato `RELATORIO_VISITA` concluída | `ARTIFACT_EXECUTION:<id>` |
| `OTHER_DOCUMENTS_ISSUED` | execução concluída que não seja PMOC, RVT **nem o documento da ordem** | `ARTIFACT_EXECUTION:<id>` |
| `AUTOMATION_RUNS` | execução de automação reivindicada | `AUTOMATION_EXECUTION:<id>` |
| `AI_COMPUTE` | execução de IA concluída | `AI_EXECUTION:<id>` |

**Um documento pertence a exatamente um balde.** A classificação sai do
`artifactType` congelado no snapshot da execução — não do template atual, que
pode ter sido renomeado depois. Um PMOC consome a cota de PMOC e nenhuma outra.
Tipo desconhecido cai em "outros documentos" de propósito: um template novo não
deve escapar da cota só porque a classificação ainda não o conhece.

**A ordem de serviço é cobrada na ordem, não no documento dela.** No Orbit a OS
*é* a `Operation`; emitir uma ordem cria a operação. Renderizar o documento
daquela ordem três vezes não são três ordens, e uma ordem sem documento
continua sendo uma ordem. O nome do recurso diz o gatilho:
`SERVICE_ORDERS_CREATED`.

**E o documento da ordem não custa nada.** A ordem já foi cobrada quando foi
criada; fazer o papel dela cair em "outros documentos" cobraria o mesmo
atendimento duas vezes, com nomes diferentes. Um atendimento gera uma ordem e o
documento daquela ordem, e isso é **uma** unidade comercial:

```text
1 atendimento → Operation + documento da OS
uso: ordens de serviço = 1 · outros documentos = 0
```

A isenção é declarada, não omissão: tipo de artefato desconhecido continua
caindo em "outros documentos", para que um template novo não escape da cota.

**Retry técnico não cobra de novo.** Renderizar, falhar, tentar de novo e
conseguir consome **uma** unidade. Não porque alguém lembrou de verificar
antes, mas porque a segunda inserção no razão bate no índice único por origem.

**Automação que falha consome.** Uma execução efetivamente iniciada gastou o
recurso, ainda que a ação tenha dado errado. Falha causada por infraestrutura
do Orbit é assunto de estorno, e estorno não existe nesta PR — quando existir,
será evento próprio, nunca um número negativo escondido no mesmo lugar.

## A janela mensal

Cota é mensal, qualquer que venha a ser a periodicidade da cobrança. Assinar
por ano não adianta doze meses de uso de uma vez:

```text
Mensal     → cobrança 1 mês  → uso 1 mês
Semestral  → cobrança 6 meses → uso 1 mês
Anual      → cobrança 12 meses → uso 1 mês
```

O mês é o do inquilino, não o do calendário. A janela é ancorada em
`subscriptionStartedAt` (ou `currentPeriodStart`, ou a criação da organização,
nesta ordem): quem assinou dia 17 tem janelas que começam dia 17. Não há
`EXTRACT(MONTH FROM now())` em lugar nenhum.

Âncora no dia 31 passa por 28 de fevereiro e volta ao dia 31 em março, porque
cada janela é calculada da âncora original. Somar de janela em janela prenderia
o inquilino ao dia 28 para sempre.

A PR-PL-02 substituirá a âncora pela da assinatura. Nada acima da abstração
muda.

## Concorrência

O caso que interessa:

```text
teto de usuários = 5
ativos = 4
duas criações ao mesmo tempo
```

O resultado é 5. Nunca 6.

`SELECT COUNT → comparar → INSERT` sem proteção não garante isso: entre a
contagem e a inserção cabe a outra requisição. A garantia vem de um **bloqueio
consultivo de transação** no par `(organização, recurso)`, tomado antes da
contagem e solto no commit — junto com a escrita que ele autorizou. A segunda
requisição espera o commit da primeira e conta um estado já atualizado.

A chave do bloqueio é calculada na aplicação, e não com `hashtext()`: a função
do Postgres é interna e não promete estabilidade entre versões, e uma chave que
muda numa atualização deixa de serializar sem avisar ninguém.

Para o uso mensal, a ordem é **inserir e depois somar**. É a inserção que
decide se o evento já foi contado, e ela decide sob o índice único, sem janela
entre ler e escrever. Se a soma passar do teto, a transação inteira volta
atrás — inclusive a escrita de domínio que a motivou.

`RlsTransaction.runAmbient` é o que permite isso sem passar cliente de
transação por parâmetro em todo repositório: ele abre a transação e a torna
ambiente, e todo `rls.run` abaixo participa dela. Reentrante, então cota e
escrita continuam na mesma transação mesmo com guardas aninhados.

O aceite de convite é a exceção que confirma a regra. Ele é anônimo: fora da
sua própria transação a organização nem existe para a RLS, e uma contagem feita
de fora voltaria zero — um teto conferido contra zero não recusa ninguém. Para
esse caminho, `enforceAllocationIn` recebe a transação de quem chama.

## Idempotência

O razão `plan_usage_events` é acrescido, nunca corrigido: o papel de runtime
tem `SELECT` e `INSERT`, e não tem `UPDATE` nem `DELETE`. Cota consumida por
engano se resolve com evento próprio, não apagando história.

```sql
UNIQUE (organization_id, resource, source_type, source_id)
CHECK (quantity > 0)
CHECK (window_end > window_start)
```

Consumo repetido do mesmo evento devolve `counted: false` e **não** falha por
limite. Cobrar de novo um documento que só foi renderizado de novo seria o erro
exatamente oposto ao que a cota existe para evitar.

## Fundação de medição de IA

O portão e a medição são coisas separadas.

O **portão** é a capacidade `ORBIT_INTELLIGENCE`, conferida no início de
`AiService.execute`. Esse é o caminho da IA vendida ao cliente. Processamento
interno da plataforma não passa por esse serviço e não é barrado por plano
nenhum — confundir os dois desligaria funcionalidade que o cliente já pagou por
outro nome.

A **medição** acontece depois, e vale também para quem tem a capacidade: uma
execução concluída, um evento no razão. Medir nunca derruba a resposta que o
cliente já recebeu — falha de medição vira registro, não exceção.

`AI_COMPUTE` não tem teto comercial nos planos com inteligência, e é
`LIMITED(0)` nos sem — que já foram barrados pela capacidade, o portão certo. A
unidade comercial (chamada, token, custo) ainda não foi escolhida, e inventar
um número agora congelaria a escolha errada. Quando existir, só esse valor
muda.

O detalhe caro já está em `ai_executions`: modelo, tokens de entrada e saída,
custo estimado em `DECIMAL(18,8)` — decimal, nunca ponto flutuante — duração e
identificador da requisição do provedor. O provedor vem de `ai_agents.provider`
e de um registro de adaptadores; nada aqui conhece OpenAI.

## Origem dos direitos

`EffectiveEntitlements` tem três origens, todas declaradas:

- **`CATALOG`** — a chave do plano é um dos quatro códigos congelados. Os
  direitos vêm do catálogo em código, nunca do banco: o banco pode ter sido
  editado, e uma configuração inválida não pode liberar recurso ilimitado.
- **`CUSTOM`** — a linha do plano declara um perfil completo em
  `limits.entitlements`. É como um plano de teste ganha tetos pequenos sem
  tocar no catálogo de produção. Perfil incompleto **falha**; não vira
  ilimitado.
- **`LEGACY_UNGOVERNED`** — planos anteriores a esta PR (`STARTER`,
  `OWNER_FULL_ACCESS`, planos de teste). Eles nunca tiveram enforcement
  comercial, e passar a aplicar tetos retroativamente quebraria inquilinos
  existentes.

A terceira origem é uma decisão **nomeada**, e não o efeito colateral de uma
busca que não achou nada. É essa diferença que mantém as regras de segurança de
pé: ausência continua sendo erro; legado é uma origem.

Nenhuma organização foi movida de plano. A semente cria as quatro linhas de
catálogo e não reatribui ninguém — decidir que todo mundo passa a ser Essencial
mudaria os tetos de quem nunca teve teto, e isso é decisão de produto com PR
própria.

## O que a PR-PL-01.1 congelou

- a cota de equipe de campo conta **pessoas habilitadas**, nunca designações;
- designar responsável ou auxiliar tem delta zero;
- pessoa com vários papéis profissionais continua sendo uma pessoa;
- a cota de ordem de serviço é consumida na criação da `Operation` canônica;
- o documento da ordem não consome cota documental alguma.

## Falha fechada

- recurso desconhecido **falha**; não vira ilimitado;
- capacidade ausente é negada;
- limite ausente **falha**; não vira ilimitado;
- catálogo mal configurado derruba a inicialização, não a produção;
- `UNLIMITED` com valor ao lado é erro de catálogo.

## Erros públicos

Seguem a PR-35: o código é a autoridade do cliente, a copy é PT-BR
determinística, e a mensagem interna — que pode nomear o recurso — fica no log.

| Código | HTTP | Copy |
|---|---:|---|
| `PLAN_CAPABILITY_NOT_AVAILABLE` | 403 | Seu plano não inclui este recurso. |
| `PLAN_LIMIT_REACHED` | 409 | Seu plano atingiu o limite disponível para este item. |
| `PLAN_USAGE_LIMIT_REACHED` | 409 | Seu plano atingiu o limite mensal deste recurso. |
| `PLAN_CONFIGURATION_INVALID` | 500 | Não foi possível concluir a solicitação. |

`limit exceeded for RESOURCE_PLATFORM_USER` nunca sai como copy pública.

## Leituras publicadas

`GET /api/v1/plans/catalog` — o catálogo comercial congelado, público. Só
informação comercial: código, rótulo, descrição, preço de tabela, capacidades e
limites. Nada de Stripe, período de cobrança ou avaliação gratuita.

`GET /api/v1/organizations/current/entitlements` — a situação da organização:
por recurso, `current`, `limit` e `remaining`. O razão não aparece. O cliente
lê; quem calcula teto é o servidor.

## Fronteira com a PR-PL-02

Não foi implementado aqui, e é de propósito: ciclo de assinatura, avaliação
gratuita, período de carência, cancelamento, upgrade/downgrade, periodicidade
mensal/semestral/anual, Stripe, checkout, portal de cobrança e qualquer
interface.

O desenho não impede o snapshot de assinatura que virá: o serviço recebe
`organizationId` e devolve direitos, sem expor `planId`. Quando a assinatura
existir, a origem dos direitos e a âncora da janela passam a vir dela, e nada
acima desta camada muda.
