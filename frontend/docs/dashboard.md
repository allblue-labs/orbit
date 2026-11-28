# Orbit V2 — Dashboard (Frontend PR-03)

> A apresentação das métricas migrou para o [Metric Registry](./metric-registry.md)
> na PR-04, e os primitivos de painel viraram `@/components/panels`.

Integração do Dashboard com os Read Models reais de Dashboard, Analytics e
Scheduling, sobre a infraestrutura das PRs anteriores
([`frontend-core.md`](./frontend-core.md), [`authentication.md`](./authentication.md)).

O Design System não foi alterado.

---

## 1. A decisão central: layout e dados vêm de lugares diferentes

Inspecionando o backend antes de implementar, uma diferença determinou toda a
arquitetura desta PR:

| Endpoint | O que é real |
| --- | --- |
| `GET /dashboard` | **A resolução** dos widgets. `DashboardRepository.context()` consulta o banco e o `WidgetResolver` filtra por segmento × módulos do plano × plano × permissões, definindo ordem, tamanho e categoria. |
| `GET /dashboard` → `widget.data` | **Nada.** `DashboardRepository.read()` devolve fixtures escritas no código (`attention-1`, `totals: { critical: 2, … }`). Nenhuma consulta ao banco. |
| `GET /analytics/*` | **Tudo.** `AnalyticsRepository.snapshot()` consulta operações, ciclos PMOC, visitas RVT e ativos sob RLS; os engines calculam KPIs, tendências, health e projeções. |
| `GET /scheduling/agenda` | **Tudo.** Eventos e ocorrências reais do banco. |

Por isso:

```
GET /dashboard        →  quais widgets, em que ordem  (autoridade de layout)
GET /analytics/*      →  os números                   (autoridade de dados)
GET /scheduling/agenda →  os eventos
```

O campo `widget.data` é deliberadamente ignorado. Renderizá-lo colocaria
números inventados na tela com aparência de observação real — exatamente o que
esta PR precisa evitar.

### Fluxo

```
DashboardView (Client)
   │  useDashboardLayout ─────────────► GET /api/orbit/dashboard ──► NestJS
   │  useAnalyticsDashboard ──────────► GET /api/orbit/analytics/dashboard
   │  useAnalyticsHealth ─────────────► GET /api/orbit/analytics/health
   │  useOrbitIntelligence ───────────► GET /api/orbit/analytics/intelligence
   │  useEnvironmentalImpact ─────────► GET /api/orbit/analytics/environmental-impact
   │  useAgenda ──────────────────────► GET /api/orbit/scheduling/agenda
   ▼
resolveWidgets(layout.widgets)  →  [{ widget, Component }]
   ▼
<Component widget={…} analytics={…} scheduling={…} />
```

As leituras acontecem **uma vez** no `DashboardView` e são distribuídas aos
widgets por props. Nenhum widget refaz a mesma consulta.

---

## 2. Widget Registry

`src/components/dashboard-widgets/widget-registry.tsx` mapeia a tag estável
`ResolvedDashboardWidget.id` para o componente.

**Autorização não mora no registry nem nos componentes.** O `WidgetResolver`
do backend já filtrou por segmento, módulos, plano e permissões antes de
devolver a lista — o frontend recebe só o que o tenant pode ver. A página
inteira ainda é protegida por `RequireAuth`, `RequireActiveSubscription` e
`RequireCapability("dashboard.read")`, espelhando os decorators do
`DashboardController`.

Widget com tag desconhecida é **ignorado** — o painel segue funcionando — com
`console.warn` uma vez por tag em desenvolvimento.

Verificação de cobertura contra o registry do backend (26 widgets):

```bash
node -e '…'   # ver seção 6
# integrados: 12 · declarados sem fonte: 14 · não cobertos: 0
```

---

## 3. Widgets

### Integrados a dados reais (12)

| Widget | Fonte | Observação |
| --- | --- | --- |
| `attention-center` | `/analytics/intelligence` | `priorities` são os indicadores que o backend classificou fora do saudável; `risks` reúne dimensões avaliadas e degradadas; clima simulado não gera alertas operacionais |
| `executive-kpis` | `/analytics/dashboard` → `metrics` | 8 indicadores executivos do `KpiEngine`, com contexto, base de cálculo e procedência; métricas auxiliares não viram cards |
| `health-score` | `/analytics/health` | score, status e dimensões com peso e drivers |
| `operational-trend` | `/analytics/dashboard` → `series` + `forecasts` | séries bucketizadas pelo backend; projeções com método e confiança |
| `orbit-intelligence` | `/analytics/intelligence` | prioridades, riscos, tendências e projeções |
| `upcoming-events` | `/scheduling/agenda` | exige `scheduling.read`; sem acesso, mostra estado de acesso negado |
| `weather-environmental-intelligence` | `/analytics/environmental-impact` | marcado como fonte simulada (seção 4) |
| `hvac-pmoc-status` | `/analytics/dashboard`, domínio `PMOC` | |
| `hvac-equipment-health` | domínio `EQUIPMENT` | |
| `hvac-sla` | `operations.sla_compliance` + `operations.completion_rate` | |
| `hvac-technicians` | domínio `TECHNICIANS` | |
| `hvac-contracts` | domínio `CONTRACTS` | sem indicador: clientes ativos não representam contratos |

### Critérios dos indicadores (revisão de novembro/2026)

Os componentes, a grade e o tamanho do radar são preservados. As contagens
respeitam organização, unidade ativa, exclusão lógica e permissões de domínio.
`rvt.read` libera somente RVT; não implica acesso a PMOC ou operações.

| Indicador executivo | O que responde |
| --- | --- |
| Atendimentos em aberto | Toda a fila não concluída e não cancelada, inclusive demandas criadas antes do período |
| Atendimentos atrasados | Parte da fila cujo término previsto já venceu |
| Sem técnico definido | Parte da fila sem responsável operacional; auxiliar não substitui responsável |
| Sem agendamento | Parte da fila sem início previsto |
| Concluídos no período | Encerrados no recorte, pela data de conclusão, mesmo que criados antes |
| Concluídos no prazo | Conclusões até o término previsto / conclusões do período que tinham término previsto |
| Ciclos PMOC pendentes | Ciclos com vencimento ultrapassado e ainda não concluídos, inclusive anteriores |
| Visitas RVT pendentes | Visitas com data ultrapassada e ainda não concluídas, inclusive anteriores |

PMOC vence ao fim da data civil na unidade do contrato. A regularidade do RVT
considera a conclusão até o fim do dia agendado no fuso da configuração: o
horário de início da visita **não** é tratado como prazo para encerrá-la.
Compromissos futuros e cancelados não prejudicam a avaliação.

O **Índice de Saúde** combina cinco dimensões observáveis: fila no prazo,
fila com agenda, fila com técnico, PMOC em dia e RVT em dia. As três primeiras
usam somente a fila em aberto. PMOC/RVT usam compromissos vencidos no período
mais pendências anteriores ainda não resolvidas. Cada dimensão mostra seu
numerador e denominador. Dimensões sem base ficam sem nota e com peso zero;
as restantes têm pesos iguais, normalizados. Faixas descritivas: 90–100
saudável, 70–89 atenção e abaixo de 70 crítico. Esses cortes não representam
SLA contratual. Nenhuma dimensão usa quantidade de clientes, status cadastral
de equipamento ou clima simulado. Sem dimensões avaliáveis, a interface mostra
“—” e os resumos da API publicam `healthScore: null`.

O **Radar comparativo** usa apenas taxas de 0 a 100, sempre com maior sendo
melhor: Prazo, Agenda, Equipe, PMOC e RVT. Agenda e Equipe avaliam as demandas
criadas em cada janela conforme o cadastro **atual**; não reconstituem como
estavam as atribuições no passado. Prazo usa as conclusões em cada janela.
PMOC/RVT usam a regularidade descrita acima. Exibe o mesmo trecho transcorrido
do mês anterior, no fuso efetivo do usuário, sem antecipar o restante de hoje.
Quando o mês anterior é mais curto, limita o término ao seu último dia.

O gráfico prioriza pelo menos três eixos com base nos dois períodos. Sem isso,
pode mostrar somente um período com três eixos avaliáveis. Uma série só é
desenhada se possuir dados em todos os eixos exibidos; ausência nunca vira um
vértice zero. Sem três indicadores avaliáveis, exibe orientação. Contagens ficam
fora dos eixos. Diferenças entre taxas são expressas em pontos percentuais;
contagens só mostram variação relativa quando o período anterior é positivo.
Fila atual e pendências não exibem comparação histórica inventada.

O seletor de 7/30/90 dias inclui hoje e começa à meia-noite no fuso efetivo do
usuário. O backend limita o fim ao instante atual. A fila continua incluindo
pendências mais antigas que o período; somente os resultados e compromissos
avaliados usam o recorte. “Sem base de cálculo” difere de uma taxa observada de
0%. Não há meta numérica fictícia nos cards.

### Declarados sem fonte real (14)

Renderizam o card com o motivo, em vez de exibir fixture:

| Widget | Por quê |
| --- | --- |
| `team-performance` | O Analytics publica a contagem de técnicos alocados, não produtividade por técnico |
| `recent-activity` | Não existe endpoint de atividades da organização; o histórico é por operação (`/operations/:id/history`) |
| `pharmacy-*` (6) | O Analytics cobre operações, PMOC, equipamentos, técnicos e contratos — não estoque, lotes, compras, dispensações ou curva ABC |
| `agro-*` (6) | Idem: não há domínios de áreas, culturas, maquinário, insumos, irrigação ou produção |

---

## 4. Procedência dos indicadores

O backend classifica cada KPI em `AnalyticsKpi.dataQuality`. O frontend
preserva essa semântica:

| Valor | Tratamento | Motivo |
| --- | --- | --- |
| `OBSERVED` | sem marca | contagem direta dos fatos; é o caso normal |
| `DERIVED` | sem marca | cálculo do backend sobre fatos observados; é informação legítima |
| `PROXY` | **marca discreta** + tooltip | muda a interpretação: aproximações precisam declarar a limitação; `contracts.active_proxy` foi retirado por contar clientes como contratos |
| `MOCK` | **marca explícita** | não pode parecer observação real |

A origem técnica (`source`, ex.: `operation_users`) aparece no tooltip de
todos, para auditoria.

Marcar `OBSERVED` e `DERIVED` poluiria o painel sem informar nada — a marca só
aparece quando muda como o número deve ser lido.

Dois Read Models declaram procedência no bloco inteiro:

- `EnvironmentalImpactReadModel.source = 'MOCK_DERIVED'`
- `WeatherEnvironmentalIntelligenceReadModel.source = 'MOCK'`

O widget de clima carrega um `Alert` explícito: o backend ainda não integra
provedor meteorológico, e esses números não descrevem as condições reais da
operação.

**Nenhum KPI, projeção, Health Score ou insight é calculado no frontend.** A
única transformação é de forma (achatar séries para o gráfico) e de
apresentação (formatação numérica e de data).

---

## 5. Cache, atualização e escopo

Cadência por volatilidade (`REFRESH_POLICY` em `use-dashboard.ts`):

| Read Model | `staleTime` | Polling |
| --- | --- | --- |
| layout | 10 min | não |
| analytics (KPIs, séries) | 1 min | 2 min |
| health | 2 min | 5 min |
| intelligence / forecasts | 5 min | não |
| clima / impacto ambiental | 10 min | 15 min |
| agenda | 1 min | 2 min |

Coerência com organização e unidade ativas, sem invalidação manual:

1. `businessUnitId` entra na query (`AnalyticsQueryDto` e `AgendaQueryDto` o
   aceitam) → trocar de unidade muda a query key e refaz a leitura;
2. trocar de organização descarta as queries do escopo anterior
   (`RequestContextProvider`, PR-02);
3. `from` é quantizado no dia local; no radar, a referência é quantizada no minuto. Sem isso, cada render
   geraria uma key nova e um refetch infinito.

---

## 6. Server e Client Components

`app/dashboard/page.tsx` é **Server Component**: compõe guards e `AppShell`,
sem estado nem dados. `DashboardView` é **Client Component** porque o painel é
interativo (faixa de período, polling, gráficos).

Não há prefetch/dehydration no servidor: as leituras dependem da unidade
ativa, que é uma escolha do cliente. Buscar no servidor duplicaria a consulta
ou serviria o escopo errado — o benefício de hydration não se sustenta aqui.

---

## 7. Isolamento de falhas

- **Erro de rede** → estado do TanStack Query dentro do card (`WidgetError`),
  com "tentar novamente".
- **403** → tratado à parte: é ausência de acesso, não falha; sem botão de
  retry.
- **Erro de renderização** → `WidgetErrorBoundary` por widget. Um widget que
  quebra não derruba o painel.
- **Vazio** → estado próprio, distinto de erro.

---

## 8. Incompatibilidades encontradas

Registradas sem contorno fictício:

1. **`GET /dashboard` devolve fixtures em `widget.data`.** Só `context()`
   consulta o banco. Enquanto o `DashboardRepository` não ler fatos reais, o
   endpoint serve como autoridade de layout, não de dados.

2. **Os componentes de dashboard do Design System foram desenhados para o
   contrato mockado**, não para os Read Models:

   | Componente | Incompatibilidade |
   | --- | --- |
   | `KpiGrid` | exige `id` de uma união fixa (`operations_open`…) e resolve o ícone por esse id; os ids reais são `operations.total`, `pmoc.compliance`… |
   | `OperationsEvolutionChart` | exige série `backlog`, que o `TrendEngine` não publica |
   | `ProductivityChart` | exige `completed`/`inProgress`/`efficiency` por usuário; não há Read Model |
   | `StatusDonutChart` | exige distribuição por status; o Analytics não a publica |
   | `AttentionCenter` | severidades e campos (`value`, `actionLabel`, `href`) divergem do contrato |
   | `AlertsPanel`, `RecentActivityPanel` | sem fonte real |
   | `DashboardHeader` | faixas `today/7d/30d` vs. `7D/30D/90D` do `DashboardQueryDto` |

   Preencher os campos ausentes exigiria inventar dados. Os widgets novos
   reutilizam os primitivos do Design System (`StatCard`, `KpiCard`,
   `ChartWrapper`, `Timeline`, `Card`, `Badge`, `Progress`) para manter a
   identidade visual sem fabricar informação.

3. **`src/data/dashboard.ts` continua no repositório.** A dependência da
   aplicação foi removida — nenhuma página o importa. Ele permanece porque os
   nove componentes em `src/components/dashboard/` importam seus **tipos**, e
   removê-los seria alterar o Design System. Hoje esses componentes e o arquivo
   de mock estão sem nenhuma referência: a remoção é uma limpeza de Design
   System, e essa decisão é de quem mantém o DS.

4. **`/analytics/intelligence` devolve contexto, não narrativa.** O
   `OrbitIntelligenceReadModel` (com `summary` e `recommendations` textuais) só
   existe como fixture no `/dashboard`. O widget apresenta os sinais
   estruturados reais, sem texto gerado.

5. **`/analytics/environmental-impact` ignora o período.** O controller não
   recebe `AnalyticsQueryDto` — o hook não envia janela, e o widget não sugere
   que o dado acompanhe a faixa selecionada.

6. **Não há série de backlog nem distribuição por status.** O `TrendEngine`
   publica `operations.created`, `operations.completed` e `pmoc.generated`.

---

## 9. Validação executada

Cenários exercitados por HTTP contra o BFF real, com o NestJS substituído por
um stand-in cujos contratos foram copiados do código-fonte:

- layout resolvido com 15 widgets, contexto e ordem preservados;
- registry: 12 integrados, 2 sem fonte, 1 tag desconhecida ignorada sem quebrar;
- os 8 indicadores com `dataQuality` correta, `PROXY` sinalizado;
- `/analytics/{health,intelligence,environmental-impact}` e
  `/scheduling/agenda` respondendo pelo BFF;
- `source: MOCK_DERIVED` e `MOCK` preservados no transporte;
- 403 isolado em um Read Model sem derrubar os demais;
- `businessUnitId` e `from` chegando ao backend a partir do escopo ativo.

Cobertura do registry contra o backend (26 widgets): 12 integrados, 14
declarados sem fonte, **0 não cobertos**.

```bash
npm run contracts:sync   # inclui os Read Models de dashboards/analytics/scheduling
npm run typecheck        # sem erros
npm run lint             # sem erros
npm run build            # 16 rotas
```

### Validação da revisão de novembro/2026

- 26 testes de engines, autorização e resolução do dashboard.
- 32 testes de apresentação, radar, datas e preservação da grade.
- 5 cenários no PostgreSQL temporário com migrations e papel sem `BYPASSRLS`: isolamento de organização/unidade, fila antiga, conclusão atual, domínio negado e vencimentos locais.
- 2 cenários no Chromium com respostas controladas: oito indicadores e radar completos; organização vazia sem nota ou taxa fictícia.

Os cenários do navegador validam a apresentação; os cenários de PostgreSQL
validam as consultas reais. Nenhum usa credenciais ou dados de produção.
