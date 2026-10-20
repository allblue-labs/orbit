# Orbit Mobile — Enterprise UX/UI Redesign V2

## Estado e escopo

**ORBIT MOBILE — ENTERPRISE UX/UI REDESIGN V2 CLOSED** — Home e árvore de navegação foram unificadas, a configuração por ambiente deixou de depender de digitação manual, o pad de assinatura isolou corretamente o gesto de desenho e o Perfil passou a mostrar a assinatura profissional ativa real por uma leitura autenticada mínima.

Este documento substitui a descrição visual de `mobile-experience-redesign.md`, que descreve a rodada anterior. Teste verde não representa aceite comercial automático.

- Repositório: Orbit; aplicativo Flutter em `mobile/`.
- Baseline inicial: `b3f3a23`, branch `feat/features-and-backlogs`.
- No início havia alterações do owner no schema/domínio PMOC e migration PR-FX-03. Foram preservadas.
- Durante a execução o owner criou `d649efc` (`implementa PR-FX-03 e correcoes parciais do app mobile`), incorporando também a primeira parte deste redesign. Não foi um commit criado por esta execução.
- Os refinamentos posteriores permanecem no working tree. Não houve push nem commit adicional.
- Novas dependências, migrations, regras de domínio e alterações web: zero. O backend recebeu somente uma projeção read-only autenticada da assinatura ativa; upload, substituição, revogação, `UserSignature` e histórico de artefatos permanecem inalterados.
- PR-FX-03 já consta no checkpoint do owner; não foi reimplementado.

## Auditoria inicial e direção

Capturas anteriores preservadas em `/private/tmp/orbit-mobile-v2-baseline-20260908/`.

| Tela | Problema observado antes | Mudança |
|---|---|---|
| Home | Destaque com gradiente dominava a página; métricas e atalhos competiam; inset extra | Cabeçalho de identidade, metric strip, atalhos e painel neutro compacto |
| Agenda | Lista textual dentro de agrupamento decorativo, navegação pouco temporal | Seletor de dias, calendário, horários em coluna e divisores |
| Atendimentos | Molduras por faixa e baixa densidade | Linhas compartilhadas, sem molduras de grupo; ordem autoritativa preservada |
| Documentos | Texto sem hierarquia de documento | Ícone PDF, nome, cliente, data e estado tipado |
| Perfil | Muitos campos administrativos, sem uso da foto já disponível | Avatar real/fallback, identidade, contexto mínimo e acessos operacionais |
| Wizard | Títulos redundantes grandes e competição entre ações | Cabeçalho compacto, progresso discreto, avanço secundário e ação primária fixa |

Alinhamento adotado: gutter único de 16 px; seções internas de páginas já recuadas usam inset zero. Hierarquia por tipografia, divisores e espaço, não por uma caixa para cada dado.

## Design system

| Papel | Decisão |
|---|---|
| Canvas | Branco |
| Superfícies de agrupamento | `#F7F8FA` e `#EEF0F3` |
| Texto | Quase preto; secundário cinza |
| Azul | Seleção, links, progresso, ação e ênfase pequena |
| Roxo | Token exclusivo de inteligência, sem uso estrutural novo |
| Status | Verde `#08784F`, âmbar `#8A5D00`, vermelho `#C32635`; fundos suaves |
| Spacing | Base existente reutilizada; gutter 16, intervalos internos 4/8/12/16 |
| Radius | Campos 10; agrupamentos 12; pill só para status/filtros |
| Elevação | Nenhuma sombra decorativa nas novas superfícies; bordas discretas |
| Ícones | Material existente, 24 px na navegação; símbolos sem novo pacote |
| Motion | Feedback padrão de toque/seleção; sem animação decorativa ou gradiente |

ThemeExtension e fachada semântica existentes foram preservados. Somente light mode está implementado.

### Tipografia

Inter é a fonte operacional. Space Grotesk fica restrita ao destaque numérico.

| Token | Tamanho | Peso | Uso |
|---|---:|---:|---|
| screenTitle | 21 | 600 | Títulos de página |
| sectionTitle | 16 | 600 | Seções e etapa atual |
| heroTitle | 17 | 600 | Atendimento ativo |
| itemTitle | 14 | 600 | Linhas |
| body | 14 | 400 | Texto de apoio |
| caption | 13 | 400 | Informação secundária |
| label | 12 | 600 | Filtros/estados/ações compactas |
| eyebrow | 11 | 600 | Rótulo auxiliar |
| numeric | 14 | 600 | Horários com algarismos tabulares |
| metric | 24 | 700 | Contadores operacionais |

Inventário de tamanhos literais em `mobile/lib`: **20 → 13**. Não significa 13 novos tokens: o inventário inclui superfícies legadas. Permanecem 30 px no wordmark de autenticação, não em títulos operacionais; 22 px no login; 10 px em rótulos auxiliares legados. Fracionários 11.5/12.5/14.5/15.5 foram consolidados.

### Componentes

| Componente | Propósito | Consumidores |
|---|---|---|
| OrbitServiceRow | Projeção visual compartilhada, sem autoridade de domínio | Home, fila, Agenda, Documentos via wrappers existentes |
| OrbitMetricStrip | Métricas reais, reflow 4/2 colunas | Home |
| OrbitQuickAction | Atalho direto com Semantics/onTap e Tooltip | Home |
| OrbitHeroCard | Painel neutro do atendimento ativo | Home |
| OrbitSection / SectionBlock | Cabeçalho/alinhamento/estados sem caixa por padrão | Home, detalhe, Perfil e telas existentes |
| OrbitStatusBadge | Estado com texto e cor semântica | Listas, documentos e demais consumidores |
| OrbitAvatar | Foto HTTPS existente; iniciais quando ausente/erro | Home e Perfil |
| OrbitBottomNav | Cinco destinos icon-only com estado selecionado acessível | AppShell |
| OrbitWizard | Etapas e progresso visual sem enviar comandos | Execução |
| EvidencePreview | Miniatura em memória com placeholder seguro | Grade de evidências |

Contagem estática reproduzível de ocorrências `Nome(` nos arquivos Dart versionados, incluindo a declaração do construtor (não é contagem de instâncias em runtime):

| Nome | b3f3a23 | V2 |
|---|---:|---:|
| Card | 0 | 0 |
| OrbitCard | 8 | 5 |
| OrbitSection | 6 | 5 |
| OrbitListRow | 9 | 7 |
| OrbitServiceRow | 0 | 4 |
| OrbitHeroCard | 2 | 2 |
| OrbitQuickAction | 6 | 5 |
| OrbitMetricStrip | 2 | 2 |
| OrbitBottomNav | 0 | 2 |
| SectionBlock | 54 | 53 |

Os nomes existentes foram reaproveitados; não houve um wrapper novo para cada diferença de layout.

## Home e autoridade dos dados

- Uma consulta agregada a `/mobile/field/home`; nenhum fan-out novo para KPIs.
- Métricas reais: hoje, atrasados, em campo e próximos. Não foi inventado contador de concluídos ou KPI financeiro.
- Atalhos reais: fila, Agenda, Documentos e leitura de etiqueta quando o backend permite. Sincronização permanece no Perfil/barra contextual, não vira atalho principal.
- Atendimento ativo tem identificação, contexto, estado e ação Continuar.
- Agenda de hoje usa coluna temporal e até cinco itens. Documentos recentes também têm teto de cinco.
- O próximo atendimento conserva a deduplicação existente. Agendamentos recentes não repetem a seção quando há agenda de hoje.
- Canonicalização, status, permissão, prioridade, ordenação e paginação continuam no backend.

Agenda preserva `CivilDate` do servidor como autoridade de hoje. O calendário mensal seleciona datas civis; o botão Hoje limpa a escolha e consulta novamente o dia do servidor. Fila e documentos mantêm seus filtros publicados e cursores. Não foi criado filtro de concluídos sem suporte da API.

## Navegação antes/depois

| Destino | Ícone atual | Antes | Depois |
|---|---|---|---|
| Início | Home | Label permanente | Ícone, ponto e variante selecionada |
| Atendimentos | Checklist | Label permanente | Mesmo padrão |
| Agenda | Calendário | Label permanente | Mesmo padrão |
| Documentos | Documento | Label permanente | Mesmo padrão |
| Perfil | Pessoa | Label permanente | Mesmo padrão |

Labels permanecem em Semantics e Tooltip. Cada destino tem ação acessível explícita, estado selected e alvo de pelo menos 48×48 px. Altura: **61 px mais safe area**, independente de text scale. Owner e Técnico em Campo percorrem a mesma rota `/inicio`, a mesma `FieldDashboardScreen`, a mesma ordem de cinco destinos e a mesma árvore de componentes. Diferenças vêm apenas da sessão, permissões, capabilities, `allowedActions` e dados do backend. A antiga `features/home` foi removida e o router possui teste arquitetural contra sua reintrodução.

## Configuração por ambiente

| Alvo | Arquivo/entrada |
|---|---|
| Desenvolvimento padrão | fallback já existente, bloqueado em release |
| Android Emulator | `config/development.android.json` (`10.0.2.2`) |
| iOS Simulator | `config/development.ios.json` (`localhost`) |
| Aparelho físico/local | `config/local.json`, criado a partir do exemplo ignorado |
| Staging | `config/staging.json`, obrigatório e ignorado |
| Produção | `config/production.json`, obrigatório, HTTPS e ignorado |

`make run-local`, `run-android`, `run-ios`, `run-staging`, `build-android-prod` e `build-ios-prod` encapsulam `--dart-define-from-file`. VS Code possui os três presets de desenvolvimento; o README registra o argumento equivalente para Android Studio. Não há token ou chave nesses arquivos; URL base não é segredo. Configuração ausente falha antes de chamar Flutter, e o guard compile-time/runtime da FX-02 continua recusando endpoint de bancada, vazio ou de exemplo em release.

## Wizard, evidências e assinatura

Wizard mantém preparação, execução, evidências, materiais, confirmação e finalização. Avançar etapa é navegação, não comando. A ação primária existente continua fora do scroll, com safe area. Não houve alteração em OCC, blockers, allowedActions, journal, confirmação do cliente ou emissão de documentos.

Evidências confirmadas: até seis miniaturas, grade 2/1 colunas conforme escala, demais itens permanecem legíveis como metadata. Apenas JPEG/PNG/WebP autorizados e até 4 MiB são buscados pela rota de acesso assinada existente. Identidade/operação/expiração da concessão, tamanho e SHA-256 são conferidos. O cliente canônico limita bytes recebidos, não envia Bearer ao storage e recebe cancelamento pelo ciclo de vida do provider. Falha de rede/decodificação mostra placeholder, não detalhes técnicos. Pendências locais continuam separadas das evidências confirmadas.

O Perfil e `Minha assinatura` mostram a imagem ativa real. `GET /mobile/field/me/signature` publica uma concessão opaca, relativa, curta e vinculada por HMAC à organização, ao ator autenticado, ao hash da versão ativa e à expiração. `GET /mobile/field/me/signature/preview` relê a assinatura ativa por RLS, valida grant, MIME, tamanho, magic bytes e SHA-256 e entrega no máximo 2 MB com `no-store` e `nosniff`. A URL não contém bucket, object key, StorageFile ID, caminho interno ou identidade de outro usuário.

O app aceita apenas o path same-origin exato, dois parâmetros fechados, prazo máximo, MIME permitido, tamanho bounded e hash hexadecimal; o download continua autenticado no backend Orbit e nunca envia o Bearer ao storage. Bytes e grants vivem somente em providers `autoDispose`. Expiração ou primeira falha força uma única renovação do status, sem loop. Ausência, loading e erro possuem estados próprios. O backend não recebeu migration, endpoint para escolher usuário, regra de escrita ou mudança de lifecycle.

O mesmo `OrbitSignaturePad` atende assinatura profissional e aceite do cliente. Um gesto iniciado dentro dele entra imediatamente na arena e desenha sem mover o scroll pai; fora dele, a página continua rolando. A altura responde ao viewport em retrato e o foco do teclado é encerrado ao iniciar o traço.

## Capturas e aceite visual

As capturas usam telas reais, fontes empacotadas e fixtures exclusivamente de teste. Não foram inseridos dados fictícios em produção. O Wizard final usa `OperationExecutionScreen`, não uma maquete paralela.

Matriz: **320/375/390/430 px × escalas 1/1.3/1.5/2 × sete telas = 112 capturas**. A sétima é a lista legada de serviços para regressão.

| Largura | Overflow automatizado | Clipping/reflow na revisão manual | Alinhamento e densidade |
|---:|---|---|---|
| 320 | Sem erros na matriz | Atalhos viram linhas em 2×; títulos não usam reticências | Gutter 16; informação aumenta verticalmente sem reduzir texto |
| 375 | Sem erros na matriz | Revisadas amostras em 1.5× | Métricas em duas colunas; Timeline mantém eixo temporal |
| 390 | Sem erros na matriz | Seis telas principais revisadas em 1× | Composição operacional compacta |
| 430 | Sem erros na matriz | Revisadas amostras em 1.5×/2× | Mesmos componentes e eixo de alinhamento |

A revisão manual é amostral; o gate automatizado cobre todas as combinações. Foram encontrados visualmente e corrigidos: quebra isolada da última letra de Documentos, data longa no cabeçalho da Agenda, campos do Perfil comprimidos e contexto centralizado fora do gutter. A captura do Perfil verifica também o alinhamento de `Perfil no app` em 16 px e o avatar de 56 px.

Capturas finais principais, em `test/screenshots/out/390_1.0/`:

- [Home](../test/screenshots/out/390_1.0/01_field_dashboard.png)
- [Agenda](../test/screenshots/out/390_1.0/04_agenda.png)
- [Atendimentos](../test/screenshots/out/390_1.0/03_fila.png)
- [Documentos](../test/screenshots/out/390_1.0/05_documentos.png)
- [Wizard](../test/screenshots/out/390_1.0/07_wizard.png)
- [Perfil](../test/screenshots/out/390_1.0/06_perfil.png)

Capturas específicas do aceite em `test/screenshots/out/final/`:

- [Home canônica — Owner](../test/screenshots/out/final/owner_home.png)
- [Home canônica — Técnico em Campo](../test/screenshots/out/final/technician_home.png)
- [Pad de assinatura em retrato](../test/screenshots/out/final/signature_pad.png)

As duas Homes finais têm dimensões 390×852 e SHA-256 idêntico (`c9442107…c2377d4`), provando identidade visual entre perfis. O relógio visual da Home é fixado no harness; produção continua usando `DateTime.now()`, sem goldens que mudem de acordo com o dia da execução.

São artefatos locais ignorados pelo Git. Reproduzir com `flutter test test/screenshots/capture_test.dart --update-goldens`; comparar depois sem `--update-goldens`. As fixtures não são evidência de execução em aparelho físico.

## Validação técnica

- `flutter analyze`: **0 issues**.
- Suíte completa `flutter test --reporter expanded`: **749/749 testes passaram**, sem skips, incluindo os **59 smoke tests** contra o backend local.
- Suíte sem dependência externa: **690/690 passaram**.
- Matriz e capturas finais: **116/116 passaram** — 112 combinações de tela/largura/escala, Owner, Técnico, pad e teste de tinta visível da fixture.
- Configuração e release guard: **31/31 passaram**; targets locais usam `--dart-define-from-file`, produção recusa arquivo ausente antes do build e a compilação release com `production.example.json` falhou, como esperado, na avaliação constante antes de produzir APK.
- Regressões presentes na suíte: Home, Agenda, fila, documentos, Wizard, Perfil (capturas), FX-01 assinatura, FX-02 erros públicos/cold start, offline/sincronização e QR.
- Backend: Prettier sem mudanças; ESLint dos arquivos do escopo passou; suíte unitária completa **656/656** (105 suites), teste focado **8/8** e build Nest passaram.
- E2E backend real: **7/7 passaram**, incluindo preview autenticado, expiração, adulteração, isolamento cross-tenant, ausência de storage internals e leitura exata dos bytes.
- Android debug com `config/development.android.json`: APK compilado em **65,2 s**.
- iOS simulator debug com `config/development.ios.json`: Runner.app compilado em **65,7 s**, sem assinatura/instalação em aparelho.
- `git diff --check`: sem erros.

Warnings existentes de plataforma permanecem explícitos: `file_picker`/`mobile_scanner` ainda aplicam Kotlin Gradle Plugin e `flutter_secure_storage` ainda não suporta Swift Package Manager. Não foram atualizadas dependências fora do escopo para esconder esses avisos.

O comando de lint backend para o repositório inteiro continua reportando 64 violações PMOC já presentes fora deste diff. O lint direto de todos os arquivos backend tocados por esta entrega passa. Esses débitos preexistentes não foram reformatados ou absorvidos silenciosamente neste escopo.

Refinamentos posteriores a `d649efc` permanecem no working tree, incluindo os ajustes visuais anteriores do V2 e estas correções finais. O componente `orbit_operational.dart` e a primeira parte da revisão já estão no commit do owner. Artefatos de captura e build não foram adicionados ao Git.

## Product acceptance

Há hierarquia, métricas úteis, atalhos reais, Agenda temporal, linhas compartilhadas, títulos compactos, navegação acessível, branco predominante e muito menos contenção decorativa. Texto ampliado recebe reflow, não redução artificial da escala. Não há pesquisa/IA falsa, regra nova no cliente ou fluxo comercial inventado.

**ORBIT MOBILE — ENTERPRISE UX/UI REDESIGN V2 CLOSED.** Os gates objetivos do prompt estão fechados: Home única, navegação estruturalmente idêntica, presets centrais, guard de release preservado, gesto de desenho isolado, preview real e seguro no Perfil, suíte integral verde e builds Android/iOS verdes.

Limitações reais: não houve sessão manual com VoiceOver/TalkBack, instalação em aparelho físico nem aceite comercial humano; Semantics, reflow, matriz visual e compilação de ambas as plataformas foram exercitados pelo harness. Isso não altera o fechamento técnico, mas continua sendo atividade recomendada antes da publicação nas lojas.
