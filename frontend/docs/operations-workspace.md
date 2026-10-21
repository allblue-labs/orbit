# Orbit V2 — Operations Workspace (Frontend PR-04)

Ambiente operacional do Orbit, sobre a infraestrutura das PRs anteriores
([Frontend Core](./frontend-core.md), [Autenticação](./authentication.md),
[Dashboard](./dashboard.md)) e o [Metric Registry](./metric-registry.md).

O Design System não foi alterado.

---

## 1. Arquitetura

```
app/operacoes/page.tsx           Server Component — guards + shell
   └── OperationsList            Client — filtros, paginação, seleção
                                 └── GET /api/orbit/operations

app/operacoes/[id]/page.tsx      Server Component — guards + shell + params
   └── OperationWorkspace        Client — distribui as leituras
        ├── GET /operations/:id            → detalhes, cliente, ativo, equipe,
        │                                    agenda, anexos, extras
        ├── GET /operations/:id/timeline   → linha do tempo
        ├── GET /operations/:id/history    → auditoria
        ├── GET /checklist-executions?operationId=  → checklists
        └── GET /ai-executions?operationId=         → Orbit Intelligence
```

### Uma leitura, várias seções

`GET /operations/:id` já devolve unidade, cliente, ativo, equipe, anexos e o
resumo dos checklists — tudo aninhado por `operationInclude`. Seis seções
consomem essa **mesma** query, distribuída por props. Nenhuma delas dispara
requisição própria para dados que já vieram.

As quatro seções com endpoint próprio existem porque respondem a perguntas que
o detalhe não cobre, e cada uma tem a sua cadência:

| Seção | Endpoint | `staleTime` | Polling |
| --- | --- | --- | --- |
| Detalhe (6 seções) | `/operations/:id` | 30 s | não |
| Linha do tempo | `/operations/:id/timeline` | 15 s | 1 min |
| Histórico | `/operations/:id/history` | 1 min | não |
| Checklists | `/checklist-executions` | 30 s | não |
| Orbit Intelligence | `/ai-executions` | 5 min | não |
| Lista | `/operations` | 30 s | 1 min |

### Independência das seções

Cada painel usa `PanelFrame` + `PanelState` + `PanelErrorBoundary`
(`src/components/panels/`, promovidos nesta PR a partir dos primitivos do
Dashboard — antes eram `widget-*`, agora servem aos dois módulos):

- **rede falhando** → erro dentro do card, com "tentar novamente";
- **403** → estado de acesso negado, sem retry (não é falha, é ausência de
  acesso);
- **erro de renderização** → Error Boundary local isola o card;
- **vazio** → estado próprio, distinto de erro.

Verificado: com `history` respondendo 403, timeline e detalhe seguem em 200 e o
workspace continua utilizável.

### Escrita e invalidação

Toda mutação (status, atribuição, anexo) invalida detalhe, timeline, histórico
e a lista — porque o backend registra histórico em qualquer escrita e status e
equipe aparecem na listagem. Um único lugar decide isso: `affectedKeys(id)` em
`use-operations.ts`.

---

## 2. Server e Client Components

As duas rotas são **Server Components**: resolvem parâmetros, compõem guards
(`RequireAuth` → `RequireActiveSubscription` → `RequireCapability("operations.read")`)
e o `AppShell`. Não têm estado nem dados.

Tudo abaixo é **Client Component**, porque depende de interação: filtros,
paginação, seleção, formulário de status, upload, atualização automática.

Não há prefetch no servidor. As consultas dependem da unidade ativa e dos
filtros — ambos escolha do cliente. Buscar no servidor duplicaria a requisição
ou serviria o escopo errado; hydration não se paga aqui. Mesma decisão do
Dashboard, pelo mesmo motivo.

---

## 3. Regras de negócio ficam no backend

O caso mais visível é a **transição de status**. O `OperationService` mantém a
máquina de estados (`OPEN → SCHEDULED | IN_PROGRESS | CANCELLED`, `COMPLETED → []`
etc.). O frontend **não** a replica: oferece todos os status e apresenta a
recusa do backend quando a transição é inválida.

Duplicar a máquina aqui criaria duas fontes de verdade que divergem no primeiro
ajuste de regra. Verificado: `COMPLETED → OPEN` volta 409 com a mensagem do
backend, exibida ao usuário.

O mesmo vale para permissões: os botões de ação consultam `session.hasPermission`
apenas para não oferecer o que seria recusado — a autorização efetiva é dos
guards do NestJS.

---

## 4. Orbit Intelligence

`GET /ai-executions?operationId=` é o único caminho real de IA por operação: o
backend vincula `AiExecution` a `operationId` e permite filtrar por ele.

**Contrato**: `AiExecution.output` é JSON livre, cujo formato depende do agente
e do `purpose`. O backend não publica schema de saída. A seção:

1. lê `summary`, `inconsistencies`, `alerts`, `recommendations` e `insights`
   **quando existem**, com verificação em tempo de execução;
2. cai para exibição do JSON bruto quando não reconhece a forma.

Assumir uma estrutura que o backend não garante quebraria a tela no primeiro
agente com saída diferente. Verificado com as duas formas.

Nada é gerado no frontend.

---

## 5. Reúso por módulos futuros

Um módulo novo (Clientes, Ativos, Relatórios) não recria nada:

| Precisa de | Use |
| --- | --- |
| Chamar a API | `apiClient` (PR-01) — nunca `fetch` direto |
| Serviço tipado | `createResourceService` ou um serviço no formato de `operations.service.ts` |
| Query keys | `queryKeys.list/detail/nested/query` |
| Consulta com cancelamento | `useApiQuery` / `useApiMutation` |
| Escopo ativo | `useActiveScope()` |
| Proteger a rota | `RequireAuth`, `RequireCapability`, `RequirePermission` |
| Painel com estados | `PanelFrame` + `PanelState` (`@/components/panels`) |
| Upload / download | `useUpload`, `download`, `saveBlob` |
| Exibir métrica | `presentMetric` (`@/metrics`) |
| Data e hora | `@/lib/formatters` |

O padrão de um módulo é sempre o mesmo: **tipos → serviço → hooks → seções →
rota Server Component com guards**. As seções recebem `PanelQuery` por props e
não sabem de onde o dado veio.

---

## 6. Incompatibilidades entre frontend e backend

Registradas sem contorno, mock ou lógica temporária.

### 6.1 Comentários — não existem no backend

O PR pede comentários na operação. O backend **não tem** o recurso: nenhum
modelo `Comment` no schema, nenhum endpoint, nenhum campo. O mais próximo é
`OperationHistory`, que é registro de auditoria gerado pelo sistema — não
aceita texto do usuário.

A seção não foi criada. Implementá-la exigiria inventar armazenamento no
frontend. Falta no backend: modelo, `POST/GET /operations/:id/comments` e
permissões.

### 6.2 Ordenação da lista — sem parâmetro

`OperationQueryDto` aceita busca, unidade, cliente, ativo, técnico, tipo,
status, prioridade, janela de agendamento e paginação — **não aceita ordenação**.
O backend ordena fixo por `scheduledStart asc, createdAt desc`.

Ordenar no cliente reordenaria apenas a página atual, dando impressão falsa de
ordem global. As colunas não são clicáveis e a ordem aplicada é declarada no
cabeçalho da lista. Falta no backend: `sort`/`order` no DTO.

### 6.3 Atribuir técnico — sem fonte de usuários

`POST /operations/:id/assignments` exige o `userId` de um membro da
organização, mas **não há endpoint que liste os usuários do tenant**:
`/identity/me` cobre só o próprio usuário e `/platform-admin/users` é global e
restrito ao administrador da plataforma.

A remoção de técnico está implementada (o `userId` vem da própria operação). A
atribuição não: sem a lista, o campo seria um input de UUID cru. Falta no
backend: `GET /organizations/current/members` ou equivalente.

### 6.4 Agenda da operação — sem vínculo consultável

`EventQueryDto` filtra eventos por calendário, unidade, usuário, cliente e
ativo — **não por operação**. Não há como listar compromissos vinculados a uma
operação sem inferir o vínculo por cliente/ativo, o que traria eventos de
outras operações.

A seção usa os campos de agendamento da própria operação (`scheduledStart`,
`scheduledEnd`, `startedAt`, `completedAt`), que são reais. Falta no backend:
`operationId` no filtro de eventos, ou `source.entityId` consultável.

### 6.5 Checklist — leitura completa, escrita fora do escopo

`GET /checklist-executions?operationId=` devolve as execuções com snapshot,
respostas e progresso; a seção apresenta tudo. As rotas de escrita existem
(`PATCH /checklist-executions/:id/answers`, `complete`, `cancel`) e exigem um
formulário dinâmico dirigido por `templateSnapshot.items` — trabalho de um
módulo próprio de checklists, fora do escopo deste PR.

### 6.6 Respostas sem tipo exportado

O backend devolve payloads do Prisma montados por `operationInclude` e não
exporta tipos correspondentes (diferente de `dashboards`/`analytics`, que
publicam Read Models). As interfaces em `src/types/operations.ts` espelham
exatamente esses `include`/`select` e precisam acompanhar mudanças no
repositório — não há sincronização automática possível hoje.

### 6.7 Ação em lote

A seleção múltipla está na lista, mas o backend não expõe endpoint de ação em
lote. Hoje ela apenas informa quantas operações estão marcadas.

---

## 7. Validação executada

Cenários exercitados por HTTP contra o BFF real, com o NestJS substituído por
um stand-in cujos contratos foram copiados do código-fonte:

1. lista paginada, filtro por status e busca aplicados no servidor;
2. detalhe alimentando as seis seções que compartilham a leitura;
3. timeline, histórico, checklists e IA respondendo pelos seus endpoints;
4. Orbit Intelligence com saída reconhecida e com saída em formato livre;
5. transição inválida recusada (409) com a mensagem do backend;
6. seção em 403 sem derrubar as demais;
7. download binário de anexo pelo BFF, com `Content-Disposition` preservado;
8. operação inexistente (404);
9. rotas respondendo e redirecionando sem sessão.

```bash
npm run typecheck   # sem erros
npm run lint        # sem erros
npm run build       # 17 rotas
```


## Criação por etapas e valor manual

O `OperationFormDialog` cria em cinco etapas: cliente e local; serviço e
equipamentos; agenda e equipe; valores e checklist; revisão. A criação só é
enviada na confirmação final. Voltar mantém os dados e cancelar descarta o
rascunho. A edição continua agrupada numa única tela.

Complemento e ponto de referência são dados de `CustomerAddress`. O wizard
reutiliza `CustomerAddressFormDialog` para cadastrar ou editar o endereço sem
sair do atendimento. Salvar nesse diálogo atualiza o cadastro compartilhado do
cliente imediatamente, mesmo se a operação for cancelada depois.

`manualAmount` aceita número não negativo com até duas casas decimais. Na leitura,
o decimal é serializado como string. Zero é um valor explícito; `null` remove a
preferência e restaura o total do orçamento vinculado. O valor manual não altera
o orçamento nem registra um recebimento. `amountVisibleInField` continua
controlando a exibição no aplicativo; quando habilitado, o valor manual tem
prioridade sobre o orçamento. O status de pagamento fica nulo para valor manual.

A publicação requer a migration `20261021140000_operation_manual_amount` antes
de iniciar a API atualizada, além do rebuild da API e do frontend. A migration
acrescenta uma coluna decimal opcional e uma restrição para impedir negativos.
