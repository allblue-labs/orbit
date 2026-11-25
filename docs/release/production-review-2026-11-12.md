# Revisão de produção — Orbit — 12/11/2026

**Parecer: NÃO APROVADO para uma nova liberação de produção.**

Base inspecionada: `da493e613da0d117fa9effaf96af0daf07889e84`, branch
`feat/features-and-backlogs`. O checkout estava limpo. Esta entrega registra a
inspeção; não altera regras de negócio nem corrige os achados silenciosamente.
A execução proposta está no [plano de PRs](production-pr-plan-2026-11-12.md).

## Escopo, método e limites da evidência

Revisão transversal do NestJS, PostgreSQL/Prisma/migrations/RLS, Next.js/BFF,
Flutter e integrações nativas Android/iOS, Docker, workers, arquivos,
assinaturas, cobrança, autorização e operação da release. Foram combinados
inspeção de código, auditoria de dependências, suítes completas disponíveis e
provas direcionadas em PostgreSQL temporário com papel sem SUPERUSER/BYPASSRLS.

Os resultados abaixo distinguem defeito reproduzido, constatação de código e
qualificação operacional pendente. Uma falha de teste não foi automaticamente
classificada como falha do produto. A inspeção é orientada a riscos; não é uma
afirmação de que cada linha do repositório foi examinada ou de que a ausência
de achados em um caminho prova ausência de vulnerabilidades.

Não foram usados dados, credenciais ou contas de produção. Os serviços externos
ficaram desligados nos testes de integração; o e-mail usou o modo de teste e a
cobrança foi exercitada com os provedores de teste das suítes. As provas não
enviaram push, e-mail ou cobrança reais. O banco temporário foi removido.
Configurações locais não foram tratadas como prova da configuração de produção.

Não houve pentest contra o host público, validação dos consoles AWS/Firebase,
teste físico em aparelhos, execução completa do Playwright com tenant real,
restore de backup de produção ou teste de carga representativo da implantação.
Esses itens permanecem gates explícitos, não sucessos presumidos.

## Verificações executadas

| Verificação | Resultado nesta revisão |
| --- | --- |
| Instalação do banco do zero | Todas as migrations aplicadas; papel restrito provisionado |
| Inventário das tabelas com `organization_id` | 117; 115 com RLS e FORCE RLS; `sessions` e `identity_invitations` são exceções do plano de identidade e requerem revisão específica |
| Backend — suíte unitária completa | 246 suítes: 242 passaram, 4 falharam; 1.955 testes passaram e 15 falharam |
| Backend — integração completa | 38 suítes: 22 passaram, 16 falharam; 370 testes passaram e 89 falharam |
| Backend — lint sem `--fix` | 23 erros em 5 arquivos; não alterado durante a inspeção |
| Backend — build | Passou |
| Frontend — suíte unitária completa | 66 arquivos, 656 testes passaram |
| Frontend — TypeScript | Passou |
| Frontend — build de produção | Passou com `next build --webpack`; o bundler padrão não foi requalificado nesta rodada |
| Frontend — lint | 1 erro: `termsAccepted` não utilizado no cadastro |
| Frontend — linguagem de produto | 8 ocorrências de texto técnico, inclusive em PMOC e permissões |
| Flutter — análise estática | Passou, sem issues |
| Flutter — suíte completa | 1.153 passaram, 60 ignorados e 112 falharam; 111 são do instrumento de capturas/goldens e 1 de expectativa de texto de conectividade |
| Dependências de produção — backend | 15 pacotes sinalizados: 4 high e 11 moderate |
| Dependências de produção — frontend | 4 pacotes sinalizados: 1 critical e 3 high |

As contagens do `npm audit` são de pacotes afetados, não de ataques demonstrados
ou de CVEs distintas. As versões foram obtidas dos lockfiles. A consulta aos
advisories foi feita nesta revisão, sem instalar atualizações.
O [resumo estruturado de evidências](evidence/production-review-2026-11-12.json)
registra comandos, contagens e limites das provas sem copiar logs com dados de
fixtures, tokens ou informações de ambiente.

Na suíte backend inicial, testes HTTP também sofreram restrições de portas do
sandbox. A execução indicada na tabela é a repetição com portas locais
permitidas, para separar esse efeito das falhas da base.

### Interpretação das falhas de testes

- Há testes Stripe/assinatura dependentes do relógio real com datas fixas de
  outubro/2026, testes de senha que aplicam um matcher de propriedade a
  `undefined` quando a senha válida corretamente não produz erro, e módulos de
  teste sem os novos providers/mocks exigidos pela aplicação.
- Alguns E2E constroem uma conta owner e tentam restringi-la alterando claims
  do JWT. A autenticação atual consulta a autoridade no banco a cada pedido;
  portanto receber 200 nesse cenário não demonstra, por si só, bypass de RBAC.
  A prova correta exige membros e vínculos reais com permissões diferentes.
- Há incompatibilidades de fixtures com contratos atuais de PMOC, autorização
  de campo, início de atendimento, assinatura e cobrança. As 89 falhas E2E
  precisam ser triadas preservando as regras atuais, sem trocar expectativas
  cegamente nem enfraquecer guards para deixar a suíte verde.
- O instrumento mobile de capturas declara que não é teste de regressão, mas
  entra em `flutter test`. Foram observadas diferenças de imagem e capturas
  do wizard que chegam ao estado de autenticação exigida. Isso não equivale a
  111 defeitos visuais de produção. O harness precisa voltar a exercitar a
  jornada pretendida antes de aprovar novas referências visuais.

## Achados prioritários

**P1** bloqueia a aprovação correspondente de segurança, produto ou operação.
**P2** é melhoria importante de integridade, manutenção ou escala, a qual deve
ter critério de aceite e tratamento explícito. Não há declaração de RCE
demonstrada nem de invasão de produção nesta revisão.

### F01 — P1 — Dependências do backend com advisories relevantes

`body-parser` 2.3.0, `engine.io` 6.6.9, `multer` 2.3.0 e `sharp` 0.35.4 estão
entre os pacotes high. O parser JSON global em
[`main.ts`](../../backend/src/main.ts#L49) aceita descompressão pelo padrão do
middleware; o advisory do body-parser descreve encerramento do processo por
entrada comprimida, antes da autenticação. A superfície está presente no código;
não foi enviado payload de DoS ao ambiente público.

Referências: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[Engine.IO](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv),
[Multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) e
[sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
**Correção: PR-01.**

### F02 — P1 — Dependências do frontend vulneráveis

O lockfile mantém Next.js 16.3.4, sharp 0.35.4, source-map-js 1.2.1 e Zod
3.25.76. Há advisory crítico no Next e alertas high nos demais. O runtime do
Docker usa Debian/glibc, relevante para o advisory de imagem/sharp. A exploração
depende do caminho de processamento utilizado; não foi demonstrada RCE. Não há
`use cache`, `ImageResponse` ou `dangerouslyAllowSVG` nos caminhos pesquisados.
Isso delimita a análise de alcance, mas não torna adequado manter os pacotes
afetados. O ajuste do Zod pode exigir migração de API, não `audit fix --force`.

Referências: [Next/image](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) e
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
**Correção: PR-02.**

### F03 — P1 — Código de recuperação MFA reutilizável em concorrência

[`MfaService`](../../backend/src/modules/identity/application/mfa.service.ts)
verifica os hashes do snapshot e
[`consumeMfaRecoveryCode`](../../backend/src/modules/identity/infrastructure/identity.repository.ts#L675)
substitui a lista por `UPDATE` incondicional. Duas verificações do mesmo código
podem passar; códigos diferentes também podem sobrescrever a remoção um do outro.
Na prova com persistência real, duas chamadas paralelas aceitaram o mesmo código.
O verificador de hash foi controlado para sincronizar a corrida; nenhuma conta
real foi usada. Os testes atuais validam recusas/códigos de erro, não esse consumo
concorrente. **Correção: PR-04.**

### F04 — P1 — Rotação de sessão sem compare-and-swap e coordenação distribuída

[`refresh`](../../backend/src/modules/identity/application/authentication.service.ts#L149)
lê o hash antigo, emite o novo par e chama
[`rotateSession`](../../backend/src/modules/identity/infrastructure/identity.repository.ts#L206)
com `where: { id }`. Não exige que o hash antigo ainda seja o vigente. A prova
confirmou duas rotações simultâneas bem-sucedidas; só o último hash permanece.
Isso quebra a propriedade de consumo único e pode entregar um refresh já
inválido a um cliente. O single-flight/grace do
[BFF](../../frontend/src/server/auth/refresh.ts#L29) é memória de um processo e
não resolve concorrência entre réplicas ou com o mobile. **Correção: PR-04.**

### F05 — P1 — Limite de autenticação compartilha o IP do BFF

O [middleware](../../backend/src/common/sensitive-endpoint-rate-limit.middleware.ts#L25)
usa `request.ip` e 20 chamadas por minuto/rota por padrão. O
[BFF](../../frontend/src/server/backend-client.ts) não propaga uma identidade de
origem confiável e o bootstrap não configura essa cadeia de proxies. Clientes web
do mesmo processo aparecem para a API como a mesma origem de rede. O limite pode
recusar logins, cadastros e refreshes de pessoas diferentes; em múltiplas réplicas
os contadores divergem. Não basta aceitar qualquer `X-Forwarded-For` enviado pelo
cliente. **Correção: PR-05.**

### F06 — P1 — Realtime mantém autorização antiga e sala sem tenant

O [gateway](../../backend/src/modules/notifications/notification.gateway.ts#L36)
confere token e sessão somente ao conectar. Não revalida revogação, desativação ou
vínculos quando entrega mensagens. A sala `user:${userId}` não inclui organização;
o [serviço](../../backend/src/modules/notifications/notification.service.ts#L203)
envia título, corpo e payload a ela. Conexões existentes podem continuar após
revogação, e sessões do mesmo usuário em organizações diferentes compartilham a
sala. Constatação de código; não foi realizado teste público de socket. O cliente
web atual usa consulta HTTP para avisos; a exposição legada deve ser removida ou
qualificada, não presumida segura por estar pouco usada. **Correção: PR-10.**

### F07 — P1 — Destinos de saída controlados pelo tenant sem contenção SSRF

O [adapter de integração](../../backend/src/modules/integrations/provider/openai-compatible-integration.adapter.ts#L22)
aceita qualquer host HTTPS; o
[provedor IA](../../backend/src/modules/ai-panel/ai-provider.ts#L52) usa `fetch`
sem política de redirects/DNS/endereço final. O
[registro de web push](../../backend/src/modules/notifications/notification.dto.ts#L124)
também aceita endpoint HTTPS arbitrário, enviado pelo servidor via web-push.
Foi confirmado localmente que `https://127.0.0.1` passa nessas validações de URL.
Isso prova a ausência da restrição, não uma leitura bem-sucedida de rede interna.
A execução depende das permissões/fluxo e do destino alcançável. Exigir HTTPS
sozinho não é contenção de SSRF. **Correção: PR-11.**

### F08 — P1 — Upload sem teto no streaming e sem congelamento do objeto

[`readBody`](../../backend/src/modules/storage/storage-object.controller.ts#L164)
acumula chunks e concatena o corpo sem limite, timeout ou cancelamento por tamanho.
Os limites de domínio chegam após armazenamento/leitura. O BFF também materializa
o corpo para retry. Além disso, a assinatura LOCAL cobre chave/operação/expiração,
e [`put`](../../backend/src/modules/storage/providers/local-filesystem.storage.ts#L60)
sobrescreve a chave. A prova confirmou que a assinatura permanece válida após a
primeira gravação e o conteúdo pode ser alterado. O
[`confirm`](../../backend/src/modules/storage/file-object.service.ts#L160) calcula
hash, mas não promove para uma chave final imutável. É possível divergir o conteúdo
do hash validado durante a vida da URL. Essa prova foi sobre objeto fictício do
próprio teste, não sobre documento de outra pessoa. **Correção: PR-09.**

### F09 — P1 — Firebase não fecha o caminho iOS; builds aceitam push incompleto

O [app iOS](../../mobile/lib/core/push/push_channel.dart#L87) registra APNs puro;
o [backend Firebase](../../backend/src/modules/notifications/firebase-push.provider.ts#L50)
responde `PERMANENT_FAILURE / FCM_TOKEN_REQUIRED` para esse provedor. Configurar
somente as credenciais do Admin SDK não corrige a incompatibilidade.

No [Android](../../mobile/android/app/build.gradle.kts#L91), a configuração Google
é opcional e a ponte devolve `false/null` quando Firebase não inicializa. No
[iOS](../../mobile/ios/Flutter/Push.xcconfig#L4), o entitlement começa desativado e
depende de arquivo local. A ausência dos arquivos neste checkout não prova sua
ausência em produção; o problema de release é permitir gerar o artefato final
sem verificar a configuração. Os IDs Android `com.allbluelabs.orbit` e iOS
`com.allbluelabs.orbitOperator` devem ser mapeados aos respectivos apps Firebase;
serem diferentes entre plataformas não é, isoladamente, um defeito.

É necessária evidência real em Android/iPhone, nos estados aberto, em segundo
plano e encerrado, com atribuição/autorização de OS, RVT e PMOC, troca de usuário,
token renovado e navegação correta. Aceite do SDK não prova exibição no aparelho.
[Requisitos oficiais Firebase](https://firebase.google.com/docs/cloud-messaging/flutter/client).
**Correção: PR-06.**

### F10 — P1 — SES síncrono e sem entrega durável para identidade

Boas-vindas, recuperação e convite chamam o SES no ciclo HTTP. O
[`register`](../../backend/src/modules/identity/application/registration.service.ts#L53)
espera o envio após criar a conta e antes de provisionar assinatura/login. Falhas
de recuperação/boas-vindas são capturadas e registradas, mas não há outbox de
identidade para entrega posterior. Convite pode persistir e depois falhar no envio.
As três tentativas do SDK são úteis, porém não sobrevivem ao fim da requisição
ou à queda do processo. Há risco de comunicação perdida e cadastro parcialmente
concluído na visão de quem tenta novamente. **Correção: PR-07.**

### F11 — P1 — Feedback SES e habilitação externa ainda não qualificados

O [SNS](../../backend/src/modules/email/ses-feedback.blueprint.ts#L2) existe apenas
como blueprint. Não há endpoint ativo, persistência de bounce/complaint ou consulta
de supressão pelo remetente. A saída da sandbox continua aguardando a AWS, conforme
informado pelo owner; esta revisão não consultou a conta. A restrição é regional:
na sandbox só destinatários verificados ou simulador são permitidos. A aprovação
externa não pode ser marcada como concluída por um commit.
[Regras oficiais SES](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
**Correções: PR-07, PR-08 e aceite externo da PR-19.**

### F12 — P2 — Integridade relacional não garante coincidência de tenant

Na prova com runtime restrito, foi aceita uma `rvt_configuration` da organização
A referenciando um cliente da B. As FKs por ID garantem existência, não igualdade
de `organization_id`. RLS não substitui essa invariante de relacionamento. A prova
foi uma escrita direta no banco de teste; não demonstrou bypass em um endpoint
de criação de RVT. Os serviços também validam seleções, e isso deve ser mantido.
Auditar sistematicamente relações tenant/unidade/cliente/equipamento e adicionar
constraints compostas ou guards transacionais de banco com preflight para dados
existentes. As duas exceções do plano de identidade no inventário de RLS não foram
classificadas automaticamente como vazamento. **Correção: PR-12.**

### F13 — P1 condicional — Retenção não encerra o ciclo físico em todos os providers

O [purge](../../backend/src/modules/billing/retention/subscription-data-retention.service.ts#L251)
enfileira objetos encontrados em `storage_files`. O
[provider S3/MinIO](../../backend/src/modules/storage/providers/s3-compatible.storage.ts#L108)
recusa qualquer `remove`, mantendo jobs em retry. Além disso, anexos legados têm
`storage_key` em `operation_attachments` e arquivos próprios fora de `storage_files`;
esse caminho não entra na outbox física mostrada. Isso conflita com a política
solicitada de excluir o conteúdo operacional após 30 dias. O problema S3 é
condicionado ao uso desse provider; não foi assumida a configuração real de
produção. Validar também legado, órfãos e retenção de backups. **Correção: PR-13.**

### F14 — P1 — Processo de API recebe credenciais administrativas desnecessárias

O [Compose](../../docker-compose.yml#L44) entrega ao runtime tanto
`APP_DATABASE_URL` quanto a URL administrativa e senha do administrador da
plataforma. Executar como papel restrito é positivo, mas manter a credencial
administrativa no mesmo processo aumenta o impacto de uma execução de código
ou vazamento de ambiente. Bootstrap/seeds devem ser tarefas separadas. As portas
da API e frontend também são publicadas em todas as interfaces; a exposição real
depende do firewall. Rever bindings para a topologia com Nginx no host, sem alterar
a escuta interna dos containers de forma incompatível. **Correção: PR-14.**

### F15 — P1 de qualificação — Gates vermelhos e ausência de pipeline versionado

Os resultados completos não sustentam aprovação. O repositório tem scripts e
checklists, mas não foi encontrada configuração `.github/workflows` ou outra
pipeline versionada equivalente para impor os gates de toda a release. A linguagem
de produto também deixa de rodar dentro do lint combinado quando o ESLint falha
primeiro. Os fixtures, relógios e mocks precisam ser corrigidos com testes reais
de papéis/escopo, sem aprovar uma matriz que não exercita o produto. **Correção:
PR-03; fechamento na PR-19.**

### F16 — P2 — Workers e I/O competem com HTTP sem isolamento de carga

O [worker](../../backend/src/modules/jobs/background-job.worker.ts#L117) percorre
as filas sequencialmente e executa trabalho no mesmo processo da API. Com o poll
padrão, reivindica um job por fila por rodada. PDF e composição podem atrasar
push e demais filas. Os `fetch` de S3 não têm timeout explícito nem cancelamento
de corpo. Separar execução pesada, impor concorrência/backpressure e deadlines,
e medir atraso por fila, memória e event loop. Não foi realizado teste de carga
de produção. O benchmark local já presente no E2E de preview PMOC 100 × 12 teve
p95 de aproximadamente 153 ms; isso não mede a pilha sob carga concorrente.
**Correção: PR-15.**

### F17 — P2 — Dashboard materializa fatos e repete snapshots

O [repository](../../backend/src/modules/analytics/analytics.repository.ts#L55)
carrega operações e compromissos para calcular em memória. A página consulta
dashboard, saúde, inteligência e as duas janelas do radar; os endpoints delegam
ao mesmo overview, repetindo leituras. A correção de conteúdo do dashboard deve
ser preservada ao introduzir agregação SQL e reaproveitamento seguro por tenant,
unidade, permissões e janela. Evitar cache compartilhado sem todas essas chaves.
**Correção: PR-16.**

### F18 — P2/P3 — Coerência de textos, datas e experiência ainda tem lacunas

O [resumo de atendimento](../../backend/src/modules/mobile-field/attendance-summary.ts#L41)
converte respostas arbitrárias com `String(value)` e arrays com `join`, permitindo
`[object Object]` em dados compostos. No
[financeiro do dashboard](../../frontend/src/components/dashboard-widgets/financial-health.widget.tsx#L70),
o corte `iso.slice(0,10)` usa data UTC de uma janela construída no fuso do usuário:
fusos positivos podem consultar um dia anterior. Há oito textos técnicos detectados
pelo checker e metadados públicos ainda chamados de
[“Orbit Design System — Fundação Visual”](../../frontend/app/layout.tsx#L34).
Revisar journeys com teclado, foco, erro recuperável e texto ampliado usando
fixtures válidas; não redesenhar componentes para simplesmente atualizar goldens.
**Correção: PR-18.**

### F19 — P2 — Contratos frágeis em domínios críticos

RVT, mobile-field e execução desabilitam regras `no-unsafe-*` e usam `any` em
fronteiras de persistência, contexto e montagem de documentos. O
[repository RVT](../../backend/src/modules/rvt/rvt.repository.ts#L3) também desliga
o guard de consultas concorrentes numa transação. PMOC tem serviço/repository
com aproximadamente 2.900/3.700 linhas. Isso torna revisão de escopo, concorrência
e contratos mais cara e permite regressões sem erro de compilação. Refatorar
gradualmente por caso de uso, começando por RVT e sem reescrever o produto todo.
**Correção: PR-17.**

### F20 — P1 de qualificação — Evidência operacional final ainda falta

Há runbooks de backup/restore, migração e rollback, mas o próprio
[registro de dívidas](known-debts.md) mantém gates obrigatórios abertos. Não há
evidência desta release para restore conjunto de banco/objetos, imagens finais
com SBOM, carga representativa, alarmes de fila/e-mail/push e aprovação dos
artefatos assinados nas lojas. Métricas de push locais ao processo não constituem
monitoramento persistente com alertas. Esse é um bloqueio de aceite, não uma
afirmação de que backups inexistem no servidor. **Correção: PR-19.**

## Cobertura OWASP Top 10:2025

Referência: [lista oficial](https://top10.owasp.org/2025/).

| Categoria | Inspeção e achados |
| --- | --- |
| A01 — Broken Access Control | RLS, RBAC atual no servidor, escopo por unidade, links públicos, WebSocket e SSRF; F06, F07, F12 |
| A02 — Security Misconfiguration | Runtime, portas, cookies, Firebase de release, SES, credenciais administrativas e headers; F09, F14, F20 |
| A03 — Software Supply Chain Failures | Lockfiles, audit de produção, Docker e pipeline; F01, F02, F15, F20 |
| A04 — Cryptographic Failures | Hash de senha, tokens opacos/hashed, AES-GCM, URLs HMAC, cookies HttpOnly e armazenamento seguro mobile inspecionados; gerência/restore/rotação de chaves requer aceite operacional |
| A05 — Injection | DTOs, SQL parametrizado e SQL dinâmico com identificadores internos, HTML e dados de relatório inspecionados; sem SQLi/XSS demonstrada nos caminhos revistos; F18/F19 pedem contratos mais fortes |
| A06 — Insecure Design | Corridas de consumo, outbox, imutabilidade e ciclo de retenção; F03, F04, F08, F10, F13 |
| A07 — Authentication Failures | Sessão revogada, MFA, refresh, tentativas e origem confiável; F03–F06 |
| A08 — Software or Data Integrity Failures | Hash/confirm de upload, FKs, snapshots, jobs, assinatura de webhook Stripe e migrations; F08, F12, F13, F19 |
| A09 — Security Logging and Alerting Failures | Logs estruturados/redação de dados existentes; falta qualificar coleta persistente, alertas e rastreio de falha até usuário; F10, F11, F20 |
| A10 — Mishandling of Exceptional Conditions | Parsers, limite de upload, retries, deadlines e gates reais; F01, F08, F10, F15, F16 |

## Controles positivos que devem ser preservados

- Sessão e permissões privadas são revalidadas no backend a cada requisição HTTP.
- Cookies web HttpOnly/SameSite e proteção de origem do BFF estão implementados.
- RLS é efetivamente forçada na maioria das tabelas de tenant e os testes usam
  papel restrito, não somente consultas com filtros de aplicação.
- Stripe verifica assinatura sobre bytes originais e não deve conceder novo plano
  apenas pelo redirect do checkout; os testes usam provedor controlado.
- Tokens de identidade são opacos e persistidos como hash; consumo do reset de
  senha já usa atualização condicional. MFA precisa alcançar a mesma propriedade.
- Mobile tem escopo de sessão/cache, armazenamento seguro de tokens, exclusão de
  backups Android e payloads de atribuição genéricos, sem nome do cliente na tela
  bloqueada. Esses controles não devem ser removidos ao integrar Firebase.
- Código SES/Firebase não registra chaves, tokens ou corpos de mensagens em logs;
  o portal externo ainda incompleto fica desativado fora dos testes.

## Condição para mudar o parecer

Concluir as PRs bloqueadoras, resolver ou aceitar explicitamente os P2 com limites
operacionais definidos, repetir os gates no SHA final e anexar as evidências
externas da PR-19. A aprovação da AWS e a entrega real no aparelho são estados
externos; permanecem pendentes até comprovação. O relatório não autoriza uma
migração ou um push automático para produção.
