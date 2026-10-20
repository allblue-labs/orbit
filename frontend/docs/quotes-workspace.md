# Quotes Workspace (PR Frontend-20)

Consome exclusivamente os contratos da Backend PR-22 (`/quotes/**`). Sem mocks,
sem cálculo comercial e sem regra de negócio no navegador.

## A máquina de estados não é reimplementada

O backend publica `transitions` em cada orçamento — `canEdit`, `canSend`,
`canApprove`, `canReject`, `canCancel`, `canConvert`. Todo botão da interface
depende de **duas** condições: a sessão pode ver a ação (Action Registry) e o
orçamento a aceita agora (`transitions`).

Deduzir do status criaria uma segunda máquina de estados no cliente, e as duas
divergiriam no primeiro estado novo — o tipo de divergência que faz a interface
oferecer um botão que o servidor recusa. Qualquer recusa continua sendo
autoridade do backend; o que a camada evita é oferecer o que já se sabe que
levaria 409.

## Nenhum valor é calculado

Subtotal, desconto, total do orçamento e total de cada item vêm prontos.
Multiplicar quantidade por preço no navegador daria um número que pode divergir
do banco por arredondamento — o backend calcula em SQL justamente porque um
`CHECK` confere a mesma expressão.

Toda escrita devolve o orçamento inteiro, já recalculado, e a resposta vai
direto para o cache do detalhe. Não há estado local de totais para ficar
desatualizado. O diálogo de item **não mostra prévia de total**: exibir uma
conta que não é a que vale seria pior que não exibir nenhuma.

## Rota e navegação

`/orcamentos` e `/orcamentos/[id]`, registradas em `ROUTES.quotes`, no
`matcher` do `proxy.ts` e em `PROTECTED_PREFIXES`. `quotes` entrou na allowlist
do BFF. No menu, fica em **Comercial**, ao lado de Clientes, Catálogo e
Financeiro.

## Cinco abas, um endpoint

| Aba | Consulta |
| --- | --- |
| Visão geral | `GET /quotes` |
| Em elaboração | `GET /quotes?status=DRAFT` |
| Enviados | `GET /quotes?status=SENT` |
| Aprovados | `GET /quotes?status=APPROVED` |
| Encerrados | `GET /quotes?status=REJECTED\|EXPIRED\|CANCELLED` |

**Encerrados oferece um seletor** em vez de somar os três. `QuoteQueryDto`
aceita uma situação por consulta, e juntar três resultados no cliente quebraria
paginação e contagem. A escolha também é honesta com o domínio: recusa é
decisão do cliente, expiração é prazo que passou, cancelamento é desistência de
quem propôs — os três têm cores distintas e nunca compartilham rótulo.

Uma listagem serve as cinco abas e também o Customer Workspace: o que muda são
três props.

## Editor

Cabeçalho e itens na mesma tela; o que muda entre rascunho e proposta enviada é
o que aceita interação, não o layout.

- **Cliente e unidade não são editáveis** — `UpdateQuoteDto` não os aceita, e
  trocar o destinatário de uma proposta é criar outra proposta.
- **Itens vêm do Catálogo** por `kind` (`PRODUCT`, `SERVICE`, `PART`), com
  busca no servidor. O preço de `salePrice` é ponto de partida: alterá-lo é
  esperado, porque negociar é o que um orçamento faz.
- **Item avulso** existe para o que não está no Catálogo; o contrato exige
  descrição e preço nesse caso.
- **O aviso de fotografia** aparece no diálogo e sob a tabela: os itens guardam
  o que valia quando entraram, e mudar o Catálogo depois não muda nada ali.

Quando o rascunho não pode ser enviado, a tela diz **o que falta** — item,
valor ou validade —, derivado dos mesmos campos que o servidor exige.

## Detalhe

`/orcamentos/[id]` mostra identificação e situação, cliente, unidade, validade,
itens com os valores do servidor, histórico, operação vinculada, impacto
financeiro e as ações permitidas.

O **histórico** é montado a partir dos carimbos que o próprio orçamento carrega
— criação, envio, decisão, expiração, cancelamento, conversão. Não existe
endpoint de histórico de orçamento: o backend grava `AuditLog` para cada
transição, mas nenhuma rota o publica para o tenant, a mesma ausência já
declarada em Clientes e Equipamentos. A seção diz isso em vez de reconstruir
eventos.

## Fluxo visual

```
Orçamento ──▶ Aprovado ──▶ Receita PREVISTA        (Financeiro)
                  └──────▶ Conversão ──▶ Operação  (campo)
```

Os dois caminhos aparecem como **trilhas independentes**. Mostrá-los como uma
esteira só seria mentira: aprovar já cria a previsão; converter é uma decisão
separada, que pode nunca acontecer.

**Aprovado nunca é apresentado como recebido.** O rótulo diz "receita prevista",
a cor é a mesma âmbar que o Financeiro usa para `PENDING`, e o texto explica que
a confirmação acontece lá, quando o dinheiro entrar. A palavra "recebido" não
aparece nesta tela.

## Integrações

| Módulo | Como |
| --- | --- |
| **Customer** | aba Orçamentos, com `GET /quotes?customerId=` no servidor; reusa a mesma listagem e não repete dado do cliente |
| **Catalog** | seleção de itens por `kind`, com busca server-side; o preço vira fotografia no orçamento |
| **Financial** | `GET /financial/entries?source=QUOTE&sourceEntityId=` mostra a previsão **deste** orçamento |
| **Operations** | `EntityLink` para a operação convertida; nenhuma URL montada à mão |

## Alteração de backend

Uma, aditiva: **`sourceEntityId` no `FinancialEntryQueryDto`**. O Financeiro
publicava `origin.entityId` mas não permitia filtrar por ele, então mostrar a
previsão de um orçamento exigiria buscar páginas e filtrar no navegador — o que
erra por paginação e é exatamente o "inventar relacionamento no cliente" que o
enunciado proíbe. O filtro é opcional e cai sobre uma coluna já indexada por
`(organization_id, source, source_entity_id)`.

## Defeito corrigido no backend

A validação contra a API encontrou um defeito da PR-22:
`PATCH /quotes/:id/items/:itemId` recalculava o total do item num **segundo**
`UPDATE`, e o `CHECK` `total = ROUND(quantity * unit_price, 2) - discount` é
avaliado a cada instrução — a primeira deixava quantidade nova com total velho e
a escrita falhava. Era a mesma classe de defeito já corrigida no desconto do
orçamento, que sobreviveu na edição de item porque o E2E cobria adicionar e
remover, não editar. Corrigido numa instrução só, e o E2E ganhou o caso.

## Registries

- **Entity Registry** — `quote`, com rota própria por registro (ao contrário do
  lançamento financeiro: um orçamento é um documento com itens e cabe numa
  página) e badges de situação.
- **Action Registry** — oito ações, mais `quote.document` declarada
  **indisponível**.
- **Metric Registry** — quatro contagens; `MetricCategory` ganhou `COMMERCIAL`,
  pela mesma razão de `FINANCIAL`: não existe domínio comercial no
  `AnalyticsDomain`, e anunciá-lo seria mentira de contrato.
- **Navigation Core** — `entityCrumbs("quote")`; cliente e operação por
  `EntityLink`.

## Métricas

Quatro, todas do `meta.total` de consultas server-side com `limit: 1` — a mesma
técnica do Catálogo e do Execution Center. **Não há métrica de valor**: `/quotes`
não publica soma de totais por situação, e somar a página daria o valor da
página. O valor previsto que existe de verdade é o do Financeiro.

## Documento

`quote.document` está declarada **indisponível** no Action Registry, com o
motivo: o template `ORBIT_ORCAMENTO` existe e o Rendering Engine sabe emiti-lo,
mas o backend ainda não mapeia um orçamento para uma `ArtifactExecution`.
Nenhum PDF é gerado aqui — um segundo gerador seria a segunda verdade sobre o
que é um documento emitido.

## Segurança

`WorkspacePage` guarda a rota por `quotes.read`, vinda do Entity Registry. Cada
ação passa por `useAction`. A trilha financeira do detalhe checa
`financial.read` antes de consultar: a capability financeira é independente da
comercial, e perguntar assim mesmo devolveria 403 a cada abertura da página.

Cada painel tem `TabBoundary` próprio: o Financeiro cair não derruba os itens.

## Contratos usados

```
GET    /quotes                        search status customerId businessUnitId
                                      from to validUntilBefore page limit
GET    /quotes/:id
POST   /quotes
PATCH  /quotes/:id
DELETE /quotes/:id
POST   /quotes/:id/items
PATCH  /quotes/:id/items/:itemId
DELETE /quotes/:id/items/:itemId
POST   /quotes/:id/send
POST   /quotes/:id/approve
POST   /quotes/:id/reject
POST   /quotes/:id/cancel
POST   /quotes/:id/convert-to-operation
GET    /financial/entries?source=QUOTE&sourceEntityId=
GET    /catalog/products?kind=&search=&status=ACTIVE
GET    /customers?search=
```

## Lacunas declaradas

| Lacuna | Situação |
| --- | --- |
| **Sem documento do orçamento** | falta o mapeamento Quote → ArtifactExecution no backend; declarado como ação indisponível |
| **Sem histórico de alterações** | `AuditLog` grava cada transição e cada mudança de item, mas nenhuma rota o publica para o tenant |
| **Sem contagem de propostas no card do cliente** | `GET /customers/:id` publica `counts` de equipamentos e operações, não de orçamentos; a aba não exibe crachá |
| **Sem indicador de valor no funil** | `/quotes` não publica soma por situação; somar a página seria inventar um KPI |
| **Sem revisão de proposta** | alterar preço depois de enviado exige criar outra; o backend não versiona |
| **Sem envio por e-mail** | `send` registra o envio; a entrega ao cliente acontece fora da plataforma |
| **Sem moeda além do padrão** | `currency` é gravada, mas não há taxa de câmbio nem seletor |
| **Sem pagamento, NF-e, assinatura, funil de CRM, comissão, estoque e cálculo fiscal** | fora do escopo declarado |

## Verificado contra a API

43 verificações contra `http://localhost:6001/api/v1`, em organizações
descartáveis:

criar orçamento e receber `transitions` do servidor; selecionar cliente;
adicionar `PRODUCT`, `SERVICE` e `PART` com snapshot completo; preço negociado
sobrepondo o do Catálogo; totais calculados pelo servidor (`4538,80`); editar
quantidade e desconto recalculando (`5158,00`); desconto do orçamento no total
(`5000,00`); desconto maior que o subtotal recusado; **snapshot preservado após
renomear e reprecificar o produto no Catálogo**; enviar; edição recusada depois
do envio; aprovar; receita `PENDING` de `5000,00` localizada pelo filtro novo;
converter em `OS-ORC-000001`; repetir devolvendo a mesma operação, com uma só no
banco; recusa sem motivo recusada; rejeitar; cancelar depois de aprovado com a
previsão passando a `CANCELLED` sem sumir; filtros, busca e paginação;
orçamentos por cliente; **expiração** encontrada na leitura, com `canApprove`
falso e aprovação recusada; e **capability comercial**: com um plano sem
`quotes.*`, as três rotas respondem 403 enquanto `/customers` e
`/catalog/products` continuam 200 — ter a carteira ou a tabela de preços não é
poder propor um valor em nome da empresa.
