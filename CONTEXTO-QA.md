# Orbit — Contexto para Engenharia de Qualidade

> Documento de entrada para quem vai testar o Orbit pela primeira vez, nas três
> superfícies: API, painel web e aplicativo de campo.

---

## 1. A ideia do produto

O Orbit é um **ERP SaaS multi-inquilino para empresas de refrigeração e
climatização (HVAC-R)**. Ele cobre o ciclo completo de uma prestadora de
serviços desse ramo:

> *Do chamado do cliente até o PDF assinado, sem ninguém redigitar nada.*

A tese do produto está em três frases que valem como critério de aceitação de
qualquer tela:

1. **O trabalho chega pronto a quem executa.** O técnico abre o aplicativo e
   encontra cliente, endereço, setor e os equipamentos daquele atendimento —
   sem ligar para o escritório.
2. **A evidência pertence à execução.** Foto, medição e assinatura ficam presas
   ao atendimento que as registrou, e ninguém as move depois.
3. **O documento nasce do que aconteceu.** O PDF é emitido a partir da
   execução real, com a trilha de quem fez o quê e quando.

### Os três tipos de trabalho

O produto distingue três coisas que, de fora, parecem a mesma:

| Tipo | O que é | Nasce de |
| --- | --- | --- |
| **Operação / OS** | Um atendimento avulso. Corretiva, instalação, inspeção. | Alguém cria, ou um orçamento aprovado vira uma. |
| **PMOC** | Plano de Manutenção, Operação e Controle. Contrato recorrente, exigido por norma, com Responsável Técnico e periodicidade. | Um plano configurado, que gera ciclos sozinho. |
| **RVT** | Relatório de Visita Técnica. Visita recorrente ou avulsa, com roteiro por tipo de manutenção. | Uma configuração, que gera ocorrências sozinha. |

Confundir os três é o erro mais comum de quem chega agora. **PMOC e RVT geram
operações**; operação avulsa não gera PMOC nem RVT.

---

## 2. Arquitetura e superfícies

| Camada | Stack | Pasta |
| --- | --- | --- |
| **API** | NestJS + Prisma + PostgreSQL (com RLS por inquilino) | `backend/` |
| **Painel web** | Next.js (App Router), React, Tailwind | `frontend/` |
| **Aplicativo de campo** | Flutter (Android/iOS), offline-first | `mobile/` |

### Fatos de arquitetura que mudam como se testa

- **Multi-inquilino com RLS no banco.** O isolamento entre organizações é
  aplicado por *Row Level Security* no PostgreSQL, não só por `WHERE` na
  aplicação. Vazamento entre inquilinos é falha de severidade máxima.
- **O navegador nunca fala com a API direto.** O web passa por um *BFF* em
  `/api/orbit/*`, que carrega os cookies `HttpOnly` da sessão e tem uma lista
  de rotas permitidas. Uma rota nova no backend precisa ser liberada ali.
- **O aplicativo é offline-first.** Comandos de campo (iniciar, concluir,
  responder checklist, registrar material) entram num *diário* local e sobem
  quando há rede. Cada comando tem `commandId` e chave de idempotência.
- **Superfícies são governadas por papel.** O mesmo login pode ser recusado na
  web e aceito no aplicativo. Isso é regra de produto (`allowedSurfaces`), não
  defeito.

---

## 3. O que está implementado

### Backend — 35 módulos

**Núcleo comercial e operacional**

- `identity` — cadastro, login, MFA, convites, recuperação de senha, perfil.
- `organizations` — organizações (antigas "unidades de negócio"), clientes,
  contatos, endereços, equipamentos.
- `operations` — ordens de serviço: criação, atribuição, autorização,
  checklist, anexos, histórico, linha do tempo, pedido de cancelamento.
- `quotes` — orçamentos, do catálogo à aprovação do cliente.
- `financial` — lançamentos, recibos, receita ligada ao documento de origem.
- `commissions` — comissionamento.
- `inventory` — estoque por organização, entradas, saídas e transferências.
- `technical-catalogs` / `catalog` — serviços, peças, preço e unidade.

**Manutenção programada**

- `pmoc` — planos, unidades de manutenção, ciclos, execuções por equipamento,
  conformidade, contrato assinável por link temporário.
- `rvt` — tipos de manutenção, configurações, ocorrências, execuções.
- `scheduling` — agenda, eventos, lembretes, fuso por organização.

**Documentos**

- `artifact-templates` — modelos de documento, versionados e ativáveis.
- `artifact-executions` — a execução de um modelo, com *snapshot* imutável.
- `artifact-rendering` — a renderização em PDF.
- `artifact-manifests` / `issued-documents` — o que foi de fato emitido.
- `document-engine`, `signatures`, `storage`.

**Campo**

- `mobile-field` — fila de trabalho, contexto do atendimento, comandos de
  execução, evidências, assinatura profissional, aceite do cliente, sincronismo
  offline.

**Plataforma**

- `subscription-plans` — catálogo de planos, direitos, limites, avaliação
  gratuita, ciclo de vida da assinatura.
- `billing` — cobrança e conciliação com o provedor.
- `platform-administration` — administração da plataforma (fora do inquilino).
- `notifications`, `jobs`, `analytics`, `dashboards`, `management-reports`,
  `reports`, `automations`, `integrations`, `ai-panel`, `customer-portal`,
  `customer-service-requests`, `workforce`.

### Painel web — rotas

`/dashboard`, `/operacoes` (com abas de PMOC, RVT e Pendências), `/agenda`,
`/clientes`, `/ativos`, `/catalogo`, `/orcamentos`, `/financeiro`,
`/relatorios`, `/documentos`, `/artefatos`, `/execucoes`, `/equipe`,
`/organizacao`, `/configuracoes`, `/notificacoes`, `/perfil`, `/plataforma`.

Públicas: `/login`, `/cadastro`, `/planos`, `/convite`, `/recuperar-senha`,
`/redefinir-senha`, `/contrato/[token]` (assinatura de contrato PMOC pelo
cliente), `/q/[token]` (leitura de etiqueta QR).

### Aplicativo — funcionalidades

Autenticação, fila de trabalho, detalhe do atendimento, roteiro de execução em
etapas, evidências (foto/vídeo com fila offline), assinatura profissional,
aceite do cliente, PMOC em campo, documentos, clientes, agenda, equipamentos
(leitura de QR), perfil com foto, central de sincronismo.

---

## 4. Vocabulário que confunde

Leia esta tabela antes de abrir o sistema. Metade dos falsos positivos de teste
vem daqui.

| Termo | O que é | O que **não** é |
| --- | --- | --- |
| **Conta / inquilino** | A empresa que assina o Orbit (`Organization` no banco). | — |
| **Organização** | Filial, sede ou departamento dentro da conta. No código ainda se chama `BusinessUnit`. | Não é a conta. Os dois aparecem na barra lateral; o de cima é a conta. |
| **Técnico Operacional** | Quem executa o serviço no cliente, em campo. | Não é o Responsável Técnico. |
| **Responsável Técnico** | Quem responde tecnicamente pelo contrato de PMOC e o assina com o certificado exigido. | Não atende em campo necessariamente. |
| **Auxiliar técnico** | Acompanha a execução. Aparece na fila, não é o executor. | Não pode concluir sozinho. |
| **Unidade (PMOC)** | A parte do sistema que recebe manutenção: condensadora, evaporadora, dutos. | Não é filial nem equipamento. |
| **Unidade (catálogo)** | Unidade de medida ou de cobrança: `UN`, `H`, `M²`. | — |
| **Operação** | O atendimento. | — |
| **Execução de artefato** | A instância de um modelo de documento sendo preenchida. | Não é a operação. |
| **Documento emitido** | O PDF final, com revisão e trilha. | Não é a execução. |

---

## 5. Papéis, permissões e superfícies

| Papel | Web | Aplicativo | Observação |
| --- | --- | --- | --- |
| **Owner** | ✓ | ✓ | Dono da conta. Acesso total. |
| **Administrador** | ✓ | ✓ | |
| **Responsável técnico** | ✓ | ✓ | Assina contratos de PMOC. |
| **Técnico Operacional** | ✗ | ✓ | **Só campo.** Login na web é recusado por regra. |
| **Auxiliar técnico** | ✗ | ✓ | **Só campo.** |
| **Atendimento** | ✓ | ✗ | |

Três camadas decidem se uma ação acontece, e elas são **diferentes**:

1. **Superfície** (`allowedSurfaces`) — por onde a pessoa pode entrar.
2. **Permissão** (`@Permissions`) — o que o papel dela pode fazer.
3. **Capacidade do plano** (`@Capabilities`) — o que a assinatura contratou.

Uma recusa pode vir de qualquer uma. A mensagem deve dizer **qual** — "seu
plano não inclui" e "você não tem permissão" não são a mesma coisa, e confundir
as duas é defeito.

---

## 6. Planos e limites

| Plano | Mensal | Natureza |
| --- | --- | --- |
| Essencial | R$ 59,90 | Operacional básico |
| Profissional | R$ 149,90 | Operacional completo |
| Profissional + Inteligência | R$ 249,90 | Com os módulos de IA |
| Enterprise Ilimitado | sob contrato | Sem tetos |

Recursos com teto: organizações, usuários, técnicos operadores, auxiliares,
clientes ativos, equipamentos ativos, ordens de serviço criadas, documentos
PMOC emitidos.

**Avaliação gratuita:** 30 dias, **só no Essencial**, e concede apenas os
limites do Essencial.

**Regras de troca de plano:**

- Subir de plano **fora** da avaliação: imediato.
- Subir **durante** a avaliação: programado para o fim do período gratuito. Os
  limites continuam os do Essencial até lá.
- Descer de plano: programado para o fim do período pago. O que existe continua
  existindo; o que trava é criar mais.

---

## 7. Pontos de atenção para testar

Lista por ordem de risco. Cada item traz o que verificar e por que importa.

### 7.1 Isolamento entre inquilinos — severidade máxima

- Dois logins de contas diferentes, mesmas telas, em paralelo.
- Trocar o id na URL por um registro de outra conta: cliente, operação,
  equipamento, documento, orçamento. Deve dar 404, **não** 403 — 403 confirma
  que o registro existe.
- Mesmo exercício nos anexos e nos PDFs (as URLs de storage são assinadas).
- Conferir que o filtro por organização não vira um "todas" acidental.

### 7.2 As três camadas de recusa

- Técnico Operacional tentando entrar na web: deve ser recusado com mensagem
  de superfície, não "credenciais inválidas".
- Ação acima do plano: a mensagem deve falar de plano, e oferecer o caminho do
  upgrade.
- Ação sem permissão: deve falar de permissão.

### 7.3 Ciclo de vida da assinatura

- Avaliação de 30 dias: tentar subir de plano no primeiro dia. Os limites
  **devem continuar** os do Essencial.
- Descer de plano e conferir que os limites maiores valem até o fim do período
  e caem depois.
- Estourar um teto (ex.: criar o 6º cliente no Essencial) e conferir a
  mensagem.
- Assinatura vencida/suspensa: o produto deve dizer "regularize", não "seu
  plano não inclui".

### 7.4 Offline no aplicativo — alto risco

- Modo avião no meio do roteiro: iniciar, responder checklist, tirar foto,
  concluir. Tudo deve ficar na fila e subir ao voltar a rede.
- Reenviar o mesmo comando duas vezes (fechar e abrir o app): **não** pode
  duplicar. A idempotência é por `commandId`.
- Conferir que a tela nunca diz "concluído" para o que só está na fila local.
- Matar o app com foto pendente e reabrir: a foto deve sobreviver.

### 7.5 Documentos e evidências

- Um documento só nasce de uma execução real. Tentar emitir sem execução deve
  falhar.
- Modelo de documento precisa de **versão ativa** — sem ela, a emissão não
  acontece.
- A máquina de estados do documento é: `DRAFT → IN_PROGRESS → UNDER_REVIEW →
  APPROVED → COMPLETED → ARCHIVED` (com `PAUSED`). Testar transições inválidas.
- Evidência de um atendimento não pode aparecer em outro.
- O PDF deve conter a assinatura colhida em campo, não um espaço em branco.

### 7.6 URLs assinadas e expiração

- As URLs de storage **expiram em 5 minutos**. Abrir um PDF, esperar, recarregar.
- A foto de perfil e a assinatura usam o mesmo mecanismo.
- Uma URL assinada de outra conta não pode funcionar.

### 7.7 Datas, fuso e recorrência

- O fuso é por organização. Um PMOC trimestral que começa dia 31 deve cair no
  último dia do mês que não tem 31 — não "pular" para o dia 1.
- RVT em dias (semanal, quinzenal) e em meses (mensal, trimestral) seguem
  regras diferentes de propósito: 30 dias **não** é um mês.
- Vencimento e vigência viajam como data civil (`AAAA-MM-DD`), não instante.

### 7.8 Concorrência e versão

- Duas abas editando o mesmo registro: a segunda deve receber conflito, não
  sobrescrever.
- Dois usuários resolvendo o mesmo pedido de cancelamento.
- Dois técnicos iniciando o mesmo atendimento.

### 7.9 Cadastro e dados

- CEP: preencher deve trazer logradouro, bairro, cidade, UF **e país**.
- Cliente criado com endereço deve aparecer na aba Endereços.
- Equipamento novo nasce com QR gerado pelo sistema.
- E-mail de novo usuário vem com o domínio da organização embutido e não
  editável.

### 7.10 Mensagens e confirmações

- Toda criação/confirmação que fecha um diálogo deve avisar que deu certo.
- Toda ação destrutiva deve pedir confirmação.
- Nenhuma mensagem de erro pode expor stack, host ou id interno.
- Tudo em pt-BR.

### 7.11 Acessibilidade e responsividade

- Telas a 320px de largura, com texto do sistema ampliado em 2x.
- Navegação por teclado e foco visível.
- Leitor de tela nos fluxos críticos do aplicativo.

---

## 8. Passo a passo A — do cadastro ao relatório de OS

### Pré-requisitos
Navegador limpo (sem sessão), e-mail válido, CNPJ válido para o cadastro.

### A.1 Criar a conta

1. Abrir `/planos` ou `/cadastro`.
2. **Passo 1 — Escolha do plano.** Selecionar *Essencial* para exercitar a
   avaliação de 30 dias.
3. **Passo 2 — Sua conta.** Nome, sobrenome, e-mail e senha (mínimo 12
   caracteres). Esta pessoa será o **Owner**.
4. **Passo 3 — Organização.** Nome do workspace, razão social, CNPJ.
5. **Passo 4 — Organização principal.** A base da operação (filial/sede).
6. Aceitar os termos e concluir.

**Verificar:** a conta entra em avaliação; o Owner tem acesso web e mobile; a
organização principal aparece em Configurações.

### A.2 Preparar o cadastro mínimo

7. **Equipe** (`/equipe`) — criar um *Técnico Operacional*. O e-mail já vem com
   o domínio da organização. Guardar o link/senha temporária gerado.
8. **Clientes** (`/clientes`) — criar uma empresa. Preencher o CEP e conferir
   que o endereço vem completo. Adicionar um contato com telefone.
9. **Ativos** (`/ativos`) — cadastrar um equipamento para esse cliente. O
   identificador QR é gerado pelo sistema.
10. **Artefatos** (`/artefatos`) — conferir que existe um modelo de documento do
    tipo Ordem de Serviço com **versão ativa**. Sem isso, a emissão falha.

### A.3 Criar e executar a operação

11. **Operações** (`/operacoes`) — *Nova operação*. Informar cliente, endereço
    de atendimento, setor, tipo, data/hora, equipamento e o Técnico
    Operacional responsável.
12. Se a conta exigir autorização de atribuição (Configurações › Operações),
    autorizar o atendimento na aba **Pendências**. Sem isso ele não chega ao
    aplicativo.
13. **No aplicativo**, entrar como o técnico. O atendimento deve aparecer na
    fila com cliente, endereço, ponto de referência e telefone.
14. Abrir o atendimento e tocar em **Iniciar o Atendimento**.
15. Percorrer o roteiro: checklist, evidências (fotos), materiais e
    observações.
16. Na etapa de confirmação: assinatura profissional e **aceite do cliente**.
17. Tocar em **Concluir atendimento**.

### A.4 Emitir o relatório de OS

18. Ainda no aplicativo, na etapa final, gerar o documento; ou, na web, em
    `/execucoes`, criar a execução de artefato a partir da operação.
19. Acompanhar o estado até `COMPLETED` e disparar a renderização.
20. Abrir o PDF em `/documentos`.

**Verificar no PDF:** número da OS, cliente, endereço, equipamentos, o que foi
feito, materiais, as evidências e **as duas assinaturas** (técnico e cliente).
Nada deve ter sido redigitado.

---

## 9. Passo a passo B — PMOC

### B.1 Preparar

1. Cliente e equipamentos já cadastrados (passos A.8 e A.9).
2. **Unidades de manutenção** — em `/pmoc/unidades`, conferir as unidades
   (condensadora, evaporadora, dutos…) e o roteiro de cada uma.
3. Garantir que existe um usuário com perfil de **Responsável Técnico** e com
   **assinatura cadastrada** (pelo aplicativo, em Perfil › Assinatura). Sem
   assinatura, o contrato sai sem ela.

### B.2 Configurar o plano

4. `/operacoes` › aba **PMOC** › *Novo plano*. O assistente tem os passos:
   - **Cliente** — e o código do plano é sugerido automaticamente.
   - **Programação** — vigência e frequência (Semanal, Mensal, Bimestral,
     Trimestral, Semestral, Anual). A quantidade de execuções depende disso.
   - **Equipamentos** — a cobertura do plano.
   - **Unidades** — o que será atendido, com o roteiro.
   - **Responsável** — Técnico Operacional (quem executa) e **Responsável
     Técnico** (quem assina o contrato).
   - **Revisão** — a projeção de ciclos e a matriz equipamento × execução.
5. Concluir. **O plano nasce ATIVO.**

**Verificar:** o número de ciclos bate com vigência ÷ frequência; a matriz
mostra todos os equipamentos; o plano aparece na listagem com situação colorida
e próximo vencimento.

### B.3 Contrato assinado pelo cliente

6. Na listagem, *Enviar para assinatura*. O sistema gera um **link temporário**
   (72 horas) com uma chave de autorização.
7. Copiar o link e abri-lo **sem sessão** (janela anônima).
8. Conferir o resumo do contrato e assinar digitalmente.

**Verificar:** gerar um segundo link invalida o primeiro; link expirado e link
já assinado mostram mensagens diferentes; a assinatura do cliente entra no PDF
do contrato, junto com a do Responsável Técnico.

### B.4 Executar um ciclo em campo

9. No aplicativo, o técnico escalado vê a manutenção na fila.
10. Abrir → **Iniciar** → percorrer o roteiro da unidade → registrar
    evidências → concluir.
11. Emitir o relatório de execução daquele equipamento.

**Verificar:** cada equipamento tem contagem própria de execução; concluir o
último equipamento fecha o ciclo e abre o seguinte; a conformidade do plano
muda (`em dia`, `próximo`, `vencido`).

---

## 10. Passo a passo C — RVT

### C.1 Preparar

1. **Tipos de manutenção** — em `/rvt`, conferir o catálogo de tipos e o
   roteiro de cada um.

### C.2 Configurar

2. `/operacoes` › aba **RVT** › *Nova configuração*. Informar cliente,
   organização, equipamentos, tipo de manutenção, modo de agenda
   (**recorrente** ou **avulsa**), cadência e vigência.
3. Salvar. O sistema **gera as ocorrências planejadas** na hora.

**Verificar:** cadência em dias e em meses produzem datas diferentes (30 dias
≠ 1 mês); a última ocorrência respeita o fim da vigência; modo avulso gera uma
só.

### C.3 Executar

4. Abrir uma ocorrência → *preparação* → **iniciar execução**.
5. Na execução: acrescentar equipamentos, registrar as leituras do roteiro,
   anexar evidências, colher o **aceite do cliente** e concluir.
6. Emitir o artefato e renderizar o PDF.

**Verificar:** uma execução avulsa (`ad-hoc`) pode ser criada sem configuração
prévia; o PDF traz as leituras e o aceite; a ocorrência sai da fila depois de
concluída.

---

## 11. Ambiente

```bash
# Subir tudo (API, banco, web)
docker compose up -d

# API            → http://localhost:6001/api/v1
# Painel web     → http://localhost:3000
# Saúde da API   → http://localhost:6001/health/ready
```

```bash
# Testes
cd backend  && npx jest          # 1.338 testes / 183 suítes
cd frontend && npx vitest run    # 500 testes / 48 arquivos
cd mobile   && flutter test      # ~1.000 testes
```

**Aplicativo:** o endereço padrão da API é `http://10.0.2.2:6001/api/v1` — o
alias do emulador Android para a máquina. Em aparelho físico é preciso passar o
IP da rede via `--dart-define`.

---

## 12. Defeitos corrigidos recentemente

Vale reservar um ciclo de regressão para estes, porque todos chegaram a passar
despercebidos:

1. **Foto de perfil e assinatura não subiam** no aplicativo — a URL assinada
   apontava para `localhost`, inalcançável do aparelho.
2. **A foto subia e não aparecia** — o perfil publicava uma coluna que nunca
   era escrita, e a URL assinada expirava em 5 minutos dentro da sessão.
3. **O roteiro pulava a segunda etapa** quando não havia checklist previsto.
4. **O assistente do PMOC** nascia em rascunho em vez de ativo.
5. **A avaliação gratuita** financiava limites de plano superior.
6. **Rebaixar de plano** não refletia no registro da assinatura — nada
   executava a reconciliação.
7. **Endereço do cliente** não chegava à aba Endereços.
8. **País** não vinha preenchido na consulta de CEP.

---

## 13. Como reportar

Para cada achado, informar:

- **Superfície** (API / web / aplicativo) e versão do build.
- **Papel** usado e plano da conta.
- **Passos**, com os dados reais usados.
- **Esperado × obtido**, e por quê — citando a regra quando houver.
- **Evidência**: captura, vídeo, e o `x-request-id` da resposta quando for API.
- **Severidade**, considerando que vazamento entre inquilinos, perda de
  evidência e documento errado são sempre máxima.
