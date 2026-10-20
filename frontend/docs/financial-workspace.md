# Financial Workspace (PR Frontend-19)

Consome exclusivamente os contratos da Backend PR-21 (`/financial/**`). Nenhum
mock, nenhuma métrica local, nenhuma regra financeira no navegador.

## O que a tela não faz

Não soma, não subtrai, não projeta e não decide o que está vencido. Saldo
realizado, saldo previsto, distribuição por categoria e série mensal chegam
prontos do servidor; `isOverdue` também. A única aritmética do módulo é
`Number("1250.40")` na hora de formatar — e o resultado nunca volta a ser
somado.

A razão é prática: o backend guarda `Decimal(14,2)` e publica string
justamente para não perder centavo em ponto flutuante. Refazer a conta aqui
criaria uma segunda aritmética financeira, e as duas divergiriam no primeiro
arredondamento — com a interface mostrando um número e o relatório outro.

## Rota e navegação

`/financeiro`, registrada em `ROUTES.financial`, no `matcher` do `proxy.ts` e
em `PROTECTED_PREFIXES`. `financial` entrou na allowlist do BFF.

No menu, fica em **Comercial**, ao lado de Clientes e Catálogo: o que se faz
aqui é acompanhar o dinheiro que a operação gera. Em "Administração" ficaria ao
lado de configuração de conta, que é outra tarefa.

## Cinco abas, uma fonte

| Aba | Endpoint |
| --- | --- |
| Visão geral | `GET /financial/analytics/summary` · `/timeline` · `/categories` |
| Lançamentos | `GET /financial/entries` |
| Receitas | `GET /financial/entries?type=INCOME` |
| Despesas | `GET /financial/entries?type=EXPENSE` |
| Categorias | `GET /financial/categories` |

**Receitas e Despesas não são módulos separados.** São o mesmo componente
(`entries.tab.tsx`) com `type` fixo — filtro do servidor, não recorte local.
Três listagens quase idênticas seriam a duplicação que o Workspace Core existe
para evitar; o que muda entre elas são três props.

## Realizado e previsto nunca se misturam

Não existe card de "saldo" que some os dois, em nenhuma superfície. Realizado é
caixa; previsto é expectativa. Na Visão Geral são duas seções rotuladas; no
gráfico, a distinção é por **traço** — linha cheia para o que aconteceu,
tracejada para o que ainda pode não acontecer. O traço sobrevive à impressão em
preto e branco, que a cor sozinha não faz.

## Procedência

`MANUAL` · `RECEIPT` · `QUOTE` · `SYSTEM` aparecem como badge em toda linha, com
cor distinta para as origens automáticas. Um lançamento de recibo com o mesmo
aspecto de um manual convidaria alguém a tentar corrigi-lo na tela em vez de
corrigir o documento.

Quem decide se **esta linha** pode ser editada é o `editable` que o backend
publica — ele já combina origem e situação. Repetir a condição no cliente
criaria uma segunda regra, que divergiria da primeira assim que o servidor
passasse a permitir algo mais. Se ainda assim a requisição sair, o 409 aparece
como veio.

## Escritas

| Ação | Endpoint |
| --- | --- |
| Criar | `POST /financial/entries` |
| Editar | `PATCH /financial/entries/:id` |
| Confirmar | `POST /financial/entries/:id/confirm` |
| Cancelar | `POST /financial/entries/:id/cancel` |
| Categorias | `POST` · `PATCH` · `DELETE /financial/categories` |
| Configuração | `PATCH /financial/settings` |

**Nenhuma usa optimistic update.** Todas podem ser recusadas por regra
financeira — confirmar o que já está confirmado, editar o que veio de recibo,
cancelar o que já foi cancelado, remover categoria em uso. Antecipar o
resultado mostraria por um instante um saldo que o servidor vai negar, e em
dinheiro esse instante basta para alguém decidir errado.

O formulário de edição **não tem** sentido, situação, procedência e unidade:
`UpdateFinancialEntryDto` não os aceita. Não é limitação da tela — mudar o
status por um `PATCH` silencioso apagaria quem confirmou e quando.

O cancelamento tem diálogo próprio porque o backend exige `reason` com no
mínimo três caracteres; um "tem certeza?" genérico mandaria uma requisição que
voltaria 400.

## Registries

- **Entity Registry** — entidade `financial-entry`, com badges de sentido,
  situação e origem. Sem rota por registro (`href: () => ROUTES.financial`): o
  detalhe abre em painel lateral, porque são doze campos.
- **Action Registry** — sete ações declaradas, mais `financial-entry.export`
  marcada como indisponível.
- **Metric Registry** — sete métricas financeiras. `MetricCategory` ganhou
  `FINANCIAL`, que **não** existe no `AnalyticsDomain` do backend: finanças são
  servidas em `/financial/analytics/*` com capability própria, e anunciar um
  domínio que o `KpiEngine` não publica seria mentira de contrato. Categoria
  aqui é apresentação — cor, ícone e agrupamento.
- **Navigation Core** — `entityCrumbs("financial-entry")`; cliente e operação
  viram links por `EntityLink`. Nenhuma URL é montada à mão.

## Dashboard

O widget `financial-health` estava em `WITHOUT_SOURCE` desde a PR-13, com o
texto "não existe modelo nem endpoint". A declaração estava certa até a PR-21 do
backend. Agora consome `/financial/analytics/summary` e `/timeline` no mesmo
período e unidade dos demais painéis.

Duas decisões:

1. **O widget busca os próprios dados**, em vez de subir para as leituras
   compartilhadas de `dashboard-view`. A regra do compartilhamento existe para
   que dez widgets não repitam a mesma consulta; aqui há um consumidor, e a
   leitura é privilegiada — quem não tem `financial.read` receberia 403 em toda
   abertura do Dashboard.
2. **`WidgetDataSources.analytics.query`** passou a publicar o recorte
   (período + unidade) que já era calculado ali. Não é uma leitura; é o
   parâmetro que gerou as demais, e é o que permite a um widget consultar fonte
   própria **no mesmo recorte** em vez de escolher um período por conta.

## Configurações

Aba **Financeiro** em `/configuracoes`, consumindo `FinancialSettings`. Duas
chaves, porque o contrato tem duas — `autoRecordReceipts` e `defaultCurrency`.
Nenhuma flag inventada.

O aviso sobre desligar está na tela, não só aqui: desativar **não apaga** os
lançamentos existentes e reativar **não recupera** o período desligado. Sem
isso, alguém desliga esperando limpar o caixa e liga de volta esperando
reconstruí-lo — e nenhuma das duas coisas acontece.

Sem `financial.read`, a aba diz que o acesso não inclui o módulo, e explica que
ele é concedido separadamente de operações e clientes.

## Segurança

`WorkspacePage` guarda a rota por `financial.read`, vinda do Entity Registry.
Cada ação passa por `useAction`, que consulta capability e permissão declaradas.
A aba de Configurações e o widget do Dashboard checam `hasCapability` antes de
pedir qualquer número.

Nada disso é autorização — o servidor decide e recusa. O que a camada evita é
oferecer o que já se sabe que levaria 403, e pedir dado que não viria.

Cada painel e cada aba têm `TabBoundary` ou estado próprio: a série falhar não
apaga os indicadores, e o Analytics cair não derruba a listagem.

## Contratos usados

```
GET    /financial/entries              search type status source categoryId
                                       businessUnitId customerId operationId
                                       from to overdue page limit
GET    /financial/entries/:id
POST   /financial/entries
PATCH  /financial/entries/:id
POST   /financial/entries/:id/confirm
POST   /financial/entries/:id/cancel
GET    /financial/categories           type
POST   /financial/categories
PATCH  /financial/categories/:id
DELETE /financial/categories/:id
GET    /financial/analytics/summary    from to businessUnitId
GET    /financial/analytics/timeline   from to businessUnitId
GET    /financial/analytics/categories from to businessUnitId
GET    /financial/settings
PATCH  /financial/settings
```

## Lacunas declaradas

| Lacuna | Situação |
| --- | --- |
| **Sem exportação** | Não há endpoint que produza CSV, XLSX ou PDF do financeiro. O Document Center emite documentos de execução, não relatórios. Declarada como `financial-entry.export` indisponível, em vez de omitida — é a pergunta que todo mundo faz na primeira semana. |
| **Sem rota para o documento de origem** | `origin.entityId` é o id do `ArtifactManifest`, e o Document Center navega por execução, não por manifesto. O painel mostra a referência e diz que não há para onde ir, em vez de montar uma URL que daria 404. |
| **Sem filtro por cliente ou operação na interface** | O contrato aceita `customerId` e `operationId`, mas não há seletor: escolher entre centenas de clientes exigiria um combobox com busca que o Workspace Core ainda não tem. O caminho contrário funciona — o lançamento leva ao cliente. |
| **Sem vínculo de cliente/operação no formulário** | Mesma razão. O `POST` aceita os dois; o preenchimento hoje vem da origem automática, que já os traz do documento. |
| **Sem conversão de moeda** | `currency` é gravada por lançamento, mas não há taxa de câmbio no backend. O resumo publica a moeda padrão da organização e não soma moedas diferentes. |
| **Sem contabilidade, conciliação, DRE, impostos, contas bancárias e gateway** | Fora do escopo do domínio, declarado na aba de Configurações. |
| **Orçamento ainda não gera receita prevista** | `source = 'QUOTE'` existe no contrato e a interface já o rotula; falta o módulo de orçamentos publicar o evento de aprovação. |

## Verificado contra a API

48 verificações contra `http://localhost:6001/api/v1`, em organizações
descartáveis:

- receita e despesa manuais, com valor devolvido como `"1250.50"`;
- confirmar, confirmar de novo (409), cancelar sem motivo (400), cancelar
  preservando valor e motivo;
- paginação, busca, filtros por tipo, situação, competência, e a recusa do
  filtro contraditório `overdue=true&status=CONFIRMED` (400);
- dez categorias semeadas pelo backend, criação de categoria customizada,
  recusa de remover categoria semeada (409);
- recibo emitido virando lançamento `RECEIPT` · `INCOME` · `CONFIRMED`, com
  valor e competência do documento, `editable: false`, `origin.entityId`
  apontando para o manifesto, e edição recusada (409);
- `autoRecordReceipts` desligado não lança, religar não recupera, o que já
  existia permanece;
- isolamento: outra organização vê zero, leitura cruzada 404, lançar na unidade
  alheia 404;
- **capability financeira**: criado um plano sem `financial.*`, a organização
  migrada para ele e a sessão renovada — as seis rotas de leitura e a de
  escrita respondem **403**, enquanto `GET /operations` continua **200**. É o
  Stage 8 provado no ponto que importa: ver a operação não dá o dinheiro dela.
