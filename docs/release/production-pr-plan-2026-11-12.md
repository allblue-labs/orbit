# Plano sequencial de PRs — revisão de produção de 12/11/2026

Base: [relatório e evidências](production-review-2026-11-12.md).
O parecer atual é **NÃO APROVADO**. Os itens são unidades de correção locais,
não PRs já abertas no GitHub nem promessas de integração externa concluída.

## Protocolo de execução

1. Implementar uma PR por vez, com escopo e critérios abaixo.
2. Acrescentar provas de regressão para segurança/regras alteradas, revisar o diff
   e executar os checks pertinentes. Separar falhas preexistentes documentadas de
   falhas introduzidas. A PR-03 deve eliminar a baseline vermelha, sem enfraquecer
   autorização, cobrança ou invariantes para atender fixtures antigas.
3. Fazer commit local identificável ao concluir cada PR. Atualizar este documento
   com hash, resultado e dependências externas. **O owner faz o push.**
4. Não iniciar a próxima implementação enquanto a anterior tiver trabalho local
   obrigatório aberto. Um aceite físico/externo pode permanecer explicitamente
   pendente; nesse caso a PR não é considerada qualificada para produção.
5. Reexecutar os gates consolidados sobre o código final na PR-19. Sem dados ou
   credenciais de produção em testes ou evidências versionadas.

**PR-00 — Auditoria e planejamento:** esta entrega. Somente documentação e
evidência sanitizada; nenhuma correção de comportamento.

## Ordem e critérios de aceite

| PR | Prioridade | Escopo | Achados |
| --- | --- | --- | --- |
| 01 | P1 | Dependências de produção do backend | F01 |
| 02 | P1 | Dependências de produção do frontend | F02 |
| 03 | P1 | Baseline confiável e pipeline dos projetos | F15 |
| 04 | P1 | Consumo atômico de MFA e rotação de sessão | F03, F04 |
| 05 | P1 | Rate limit e cadeia confiável de proxies | F05 |
| 06 | P1 | Firebase ponta a ponta no Android/iOS | F09 |
| 07 | P1 | SES: entrega transacional durável e preflight | F10, F11 |
| 08 | P1 | SES/SNS: bounce, complaint e supressão | F11 |
| 09 | P1 | Upload limitado e objetos confirmados imutáveis | F08 |
| 10 | P1 | Autorização e escopo de notificações realtime | F06 |
| 11 | P1 | Contenção SSRF em integrações e web push | F07 |
| 12 | P2 | Integridade relacional entre tenants/unidades | F12 |
| 13 | P1 condicional | Retenção física em LOCAL/S3 e legado | F13 |
| 14 | P1 | Menor privilégio e configuração de implantação | F14 |
| 15 | P2 | Workers, deadlines de storage e observabilidade | F16, F20 |
| 16 | P2 | Agregações e custo de leitura do dashboard | F17 |
| 17 | P2 | Tipagem e limites de responsabilidade em RVT | F19 |
| 18 | P2/P3 | Textos, datas, journeys e apresentação de produção | F18 |
| 19 | Gate final | Aceite integrado, restore, carga e artefatos | F20 e pendências externas |

### PR-01 — Dependências do backend

Atualizar com versões corrigidas compatíveis, incluindo parser, Socket.IO,
multipart e imagem. Revisar locks e overrides; não usar `audit fix --force`.
Verificar advisories novos na data da execução e classificar alcance dos moderados.

**Aceite:** audit de produção sem critical/high não tratados; parser inválido e
upload abortado não encerram o processo; contratos HTTP/upload/websocket/imagem,
build e testes pertinentes passam. Registrar versões e exceções justificadas.

### PR-02 — Dependências do frontend

Atualizar Next/React/tooling compatível, sharp e source-map-js; tratar Zod e seus
consumidores com migração explícita se necessária. Verificar a saída standalone.

**Aceite:** audit sem critical/high não tratados, TypeScript, schemas de cadastro,
formulários e aceite público passam; build de produção e smoke de BFF, navegação,
imagens, cookies e renderização. Não anunciar que uma CVE foi explorada quando o
resultado comprova apenas a atualização do componente.

### PR-03 — Baseline e pipeline

Fixar relógios nos testes, corrigir matchers de senha, providers/mocks antigos e
fixtures de PMOC/RVT/campo/cobrança. Reescrever casos RBAC para vínculos reais no
banco em vez de forjar restrições nas claims de um owner. Separar o instrumento
de capturas visuais da suíte de regressão; revisar mudanças visuais antes de
aceitar goldens. Corrigir os erros de lint listados, inclusive linguagem de produto.
Tratar também os 19 alertas moderate/low restantes na cadeia de desenvolvimento
do backend (Glob/Minimatch/Deepmerge e ferramentas dependentes), registrados na
[PR-01](pr-01-backend-dependencies.md), e definir o gate da CI para esse grafo.
Incluir os moderate da cadeia TypeScript ESLint/Minimatch do frontend e a
variante Linux, conforme [PR-02](pr-02-frontend-dependencies.md).

**Aceite:** comandos padrão dos três projetos reproduzíveis em ambiente limpo,
suítes unitárias e E2E verdes, checks sem `--fix`, e pipeline versionada que execute
migrations/RLS, audit, builds e testes. A exclusão do instrumento visual da suíte
padrão não pode esconder um teste funcional com falha.

### PR-04 — MFA e refresh concorrentes

Consumir recovery code de forma atômica, sem reconstruir lista a partir de
snapshot antigo. Rotacionar sessão exigindo hash anterior, validade e não
revogação na mesma operação; definir replay/grace com comportamento consistente
entre web, mobile e réplicas. Incluir concorrência de tentativas de login na análise.

**Aceite:** apenas um consumo do mesmo recovery code; consumos de códigos
diferentes não ressuscitam códigos usados. Refresh paralelo nunca entrega pares
divergentes como se ambos fossem vigentes. Logout/troca de senha/revogação
continuam efetivos, com testes reais de banco e de duas instâncias.

### PR-05 — Rate limit e proxies

Estabelecer identidade de origem confiável no Nginx/BFF/API, com remoção de headers
forjáveis e confiança limitada aos proxies conhecidos. Adotar contador coordenado
entre instâncias e separar limites por ação/origem/conta sem permitir enumeração.

**Aceite:** usuários diferentes não dividem indevidamente o limite do container;
spoof de `X-Forwarded-For` não contorna o limite; réplicas concordam; 429 tem
`Retry-After`, limite de memória/armazenamento e mensagem compreensível.

### PR-06 — Firebase completo e qualificação nativa

Unificar o transporte Firebase com um token FCM real no iOS ou adotar roteamento
explícito de providers que cubra APNs; não enviar token APNs ao Admin como FCM.
Configurar cliente iOS/Firebase/APNs e conferir Android/Google Services. Manter
credenciais privadas exclusivamente no servidor e configuração pública de cliente
segregada por ambiente. Builds de distribuição devem falhar quando o push exigido
estiver sem configuração, sem comprometer o desenvolvimento com Personal Team.

Exercitar atribuição, autorização, cancelamento, substituição de técnico, documentos,
dedupe, token expirado/rotacionado, preferência do usuário, sessão trocada e logout.
Preservar mensagens mínimas e a leitura autenticada dos detalhes. Conferir deep link
canônico e a diferença entre aviso materializado, enfileirado, aceito e exibido.

**Aceite de código:** testes reais de registro/outbox/worker/RLS e preflight de
build/configuração. **Aceite externo obrigatório:** Android físico e iPhone com
credencial/provisionamento compatíveis, app aberto/background/encerrado, notificação
visível e destino correto com usuário certo. Instruir o owner nas telas Firebase,
Apple Developer e Play quando a execução chegar a esses passos. Não pedir JSON
privado pelo chat nem considerar mocks como comprovação de entrega real.

### PR-07 — SES durável e prontidão da conta

Criar outbox transacional para boas-vindas, recuperação e convites, com idempotência,
retry/backoff e erro permanente. Impedir que uma falha de envio transforme um
cadastro já persistido em uma tentativa ambígua para o cliente. Preservar sigilo de
tokens, validade, consumo único e neutralidade da resposta de recuperação.

Adicionar preflight de região, identidade verificada, envio habilitado e quotas.
Evitar introduzir uma flag local que simule autorização de produção pela AWS.

**Aceite:** falhas/restart recuperam envio sem duplicar conta ou divulgar token;
um token expirado/substituído não é enviado por retry tardio; SDK aceitou e-mail
não é apresentado como comprovante de recebimento. Na sandbox, usar destinatário
verificado ou mailbox simulator. Envio geral permanece pendente da aprovação AWS
na região correta e de teste posterior, conduzido com o owner.

### PR-08 — Feedback SNS e supressão

Implementar o blueprint com verificação de assinatura/certificado SNS, TopicArn e
conta/região esperados; validar SubscriptionConfirmation sem buscar URL arbitrária.
Persistir evento idempotente associado a entrega conhecida e aplicar supressão de
hard bounce/complaint. Considerar todos os destinatários do evento.

**Aceite:** eventos falsos/alterados, tópico estranho, replay e certificados/URLs
inseguros são recusados; falha transitória reentrega; bounce temporário não exclui
conta; remetente consulta supressão; payload e endereços não vazam em logs. Testar
com simulator/SNS e registrar o vínculo real no SES quando disponível.

### PR-09 — Upload e integridade

Limitar bytes durante leitura e transmissão, rejeitar cedo tamanho/MIME inválidos,
cancelar streaming e tratar abortos. Evitar buffer irrestrito no BFF/API. Associar
upload à reserva e estado; promover para chave final imutável após validar conteúdo
e hash, ou usar mecanismo equivalente que impeça sobrescrita tardia.

**Aceite:** excesso, ausência de Content-Length, transferência lenta, cancelamento,
replay e overwrite após confirm protegidos em LOCAL e S3/MinIO. O conteúdo exibido
e usado em relatórios permanece o mesmo que foi confirmado; quotas e concorrência
limitam o custo. Logs/erros preservam URLs assinadas e nomes privados.

### PR-10 — Realtime autorizado por tenant e sessão

Qualificar o gateway legado ou desativá-lo fora dos cenários efetivamente
suportados. Se mantido, resolver identidade atual no servidor, usar salas por
tenant/usuário/sessão e encerrar acesso por revogação, expiração e troca de vínculo.

**Aceite:** socket anterior ao logout não recebe novos eventos; duas organizações
do mesmo usuário não compartilham payload; papel desativado perde acesso; escala
multi-instância tem entrega definida. Não duplicar mecanismos de notificação
sem contrato claro com a caixa de avisos já implementada.

### PR-11 — Saída HTTP com proteção SSRF

Centralizar política para URLs de IA e web-push fornecidas por usuário: destinos
permitidos, DNS/IP inicial e final, IPv4/IPv6, redirects, credenciais na URL,
portas e limites de tempo/resposta. Provedores enterprise internos devem exigir
configuração explícita e auditável do deployment, não opt-in de tenant arbitrário.

**Aceite:** loopback, redes privadas/link-local/metadata, DNS rebinding e redirects
inseguros não geram requisição; provedores autorizados continuam funcionando;
testes usam destinos controlados, nunca infraestrutura interna de produção.

### PR-12 — Integridade entre organizações e unidades

Inventariar relações de domínio e adicionar igualdade de tenant/unidade no banco,
começando por RVT e seus vínculos com cliente/equipamento. Preparar preflight para
dados preexistentes e índices de suporte; manter RLS e filtros da aplicação.

**Aceite:** a referência A→cliente B reproduzida na auditoria é recusada pelo banco;
paths legítimos de multi-organização continuam disponíveis pelo fluxo autorizado;
migration em base vazia e upgrade funcionam. Registrar exceções deliberadas do
plano de identidade, sem simplesmente habilitar RLS em tabelas globais e quebrar login.

### PR-13 — Retenção física e providers

Reconciliar a exclusão operacional após 30 dias com `remove` de S3/MinIO, anexos e
documentos legados, órfãos e a outbox de exclusão. Preservar acesso até o prazo
contratado e abortar purge diante de reativação/pagamento em reconciliação.

**Aceite:** ensaio de expiração/reativação; exclusão física completa nos providers
usados, retries idempotentes e status auditável. Reconciliação entre registros e
objetos antes/depois; política de backups documentada. Não executar purge real
nem migração destrutiva automaticamente sobre dados de cliente.

### PR-14 — Menor privilégio no deploy

**Cobertura antecipada no staging (12/11/2026):** o trabalho de infraestrutura
retirou credenciais administrativas do runtime, separou bootstrap, restringiu
portas, aplicou limites, filesystem protegido e imagens privadas por digest.
Verificações reais estão em
[`../../deploy/staging/deployment-2026-11-12.json`](../../deploy/staging/deployment-2026-11-12.json).
Reavaliar o delta e a qualificação mobile antes de executar esta PR; não
reintroduzir credenciais privilegiadas no processo HTTP para manutenção.

Retirar URL administrativa do banco e senha de bootstrap do processo HTTP/worker;
reservá-las a migrator/bootstrap de uso controlado. Manter startup verificando
papel restrito. Rever publicação de portas, limites de recursos, configuração
segura, dependências por digest e gestão/rotação de segredos.

**Aceite:** API sobe e funciona sem credenciais administrativas, seeds continuam
executáveis como tarefa explícita, portas correspondem à topologia real do Nginx,
imagens rodam sem root e o ambiente não quebra recursos legítimos do mobile.

### PR-15 — Workers, storage e observabilidade

Separar trabalho pesado do HTTP e definir filas/concorrência/backpressure para não
fazer push aguardar PDF. Introduzir deadlines/cancelamento e retry bounded no
provider de storage. Exportar métricas por fila e resultado de provider de forma
persistente, com alertas e procedimento de reprocessamento de dead letters.

**Aceite:** lentidão/falha de storage/PDF não esgota pool HTTP nem bloqueia todos os
avisos; retomada não duplica efeitos; teste concorrente mede p95, event loop,
memória, conexões e idade da fila com cenário documentado.

### PR-16 — Custo de analytics

Mover contagens/taxas para agregações e reaproveitar leitura de overview quando
possível. Medir planos de consulta e índices em volume representativo. Preservar
os critérios e estados sem dados introduzidos na revisão do dashboard.

**Aceite:** mesmos numeradores/denominadores, backlog antigo, conclusões por data,
datas civis PMOC/RVT e permissões; cache nunca cruza tenant/unidade/papéis;
benchmark demonstra limite de consultas, payload e memória sem materializar toda
a história operacional.

### PR-17 — Contratos e responsabilidade em RVT

Substituir `any` e suppressions globais nos casos de criação, atribuição, execução
e relatório RVT por DTOs, read models e payloads Prisma explícitos. Extrair unidades
de responsabilidade preservando transações. Aplicar o mesmo padrão gradualmente a
mobile-field/PMOC em mudanças posteriores justificadas, evitando uma reescrita ampla.

**Aceite:** lint de segurança de tipos e concorrência ativo nos arquivos tratados,
contratos sincronizados e mesmos efeitos de autorização, calendário, execução,
evidência e relatório sob testes HTTP e banco.

### PR-18 — Textos, datas e jornadas de produção

Formatar respostas compostas de checklist de forma legível no resumo congelado;
converter a janela financeira para data civil no fuso correto. Corrigir linguagem
técnica em PMOC/permissões e metadados públicos do produto. Revisar os caminhos de
cadastro/pagamento, atendimento/assinatura, QR e documentos em web e mobile com
fixtures que alcancem a tela correta.

**Aceite:** resumo sem `[object Object]`/IDs internos, fuso positivo e negativo
consultam a mesma janela civil pretendida, textos em pt-BR orientam a próxima
ação; navegação por teclado, foco, rótulos, texto ampliado e áreas de toque são
conferidos. Capturas atualizadas somente após inspeção visual das telas reais.

### PR-19 — Qualificação final da release

Repetir a matriz consolidada no SHA final, gerar imagens/artefatos assinados com
proveniência e SBOM, conferir migrations e restore conjunto banco/objetos, testar
rollback e carga. Atualizar os registros antigos de dívidas com evidências desta
release. Conferir URL pública mobile `https://orbit.allblue-labs.com/api/v1`, flavor,
versionCode/buildNumber, links de loja, signing e configuração Firebase por plataforma.

**Aceite externo:** FCM real no Android/iPhone, SES fora da sandbox na região
usada, DNS/IAM/identidade/feedback corretos, e-mail recebido e webhooks verificados;
TLS/proxy/firewall/backup/alarmes reais conferidos pelo owner. Não versionar chaves
ou dados pessoais como comprovante. Uma dependência externa ainda pendente mantém
o parecer bloqueado para o recurso correspondente.

## Registro de execução

| PR | Estado | Commit local | Evidência / pendência |
| --- | --- | --- | --- |
| 00 | Revisão concluída | `9404804` | Relatório e evidência sanitizada; sem push |
| 01 | Implementada | `5b922b8` | [Resultados](pr-01-backend-dependencies.md): audit de produção zerado; Node 22/Linux validado; falhas preexistentes mantidas para PR-03; sem push |
| 02 | Implementada | `f582e88` | [Resultados](pr-02-frontend-dependencies.md): audit de produção zerado; Zod 4; 668 testes e cinco smokes standalone; pendências de linguagem/tooling na PR-03; sem push |
| 03 | Implementada; gates locais aprovados | `2c922e0` | [Resultados](pr-03-baseline-ci.md): backend 1.995 + 459; web 671 + 307 + 5; mobile 1.265 + 60; builds e auditoria aprovados; CI remota aguarda push do owner; exceções de tooling até 26/11/2026; sem push |
| 04 | Implementada; gates locais aprovados | `605fa10` | [Resultados](pr-04-identity-concurrency.md): MFA atômico, refresh canônico entre réplicas, login concorrente e recovery de 16 caracteres; backend 2.009 + 39, web 673 + 2 + 5, mobile 125; migration obrigatória, sem deploy/push |
| 05 | Implementada; gates locais aprovados | `bc2026c` | [Resultados](pr-05-rate-limit-proxies.md): contagem SQL entre réplicas, origem autenticada Nginx/BFF/API e sessão preservada em 429; backend 2.025 + 46, web 678 + 2 + 6, mobile 155; migration e dois novos segredos obrigatórios; sem deploy/push |
| 06 | Código implementado; aceite externo obrigatório pendente | Identificado por `fix(notifications): PR-06` na mensagem | [Resultados](pr-06-firebase-push.md): FCM Android/iOS, filas de atribuição/autorização, navegação por destinatário e barreira de release; backend 2.030, push/RLS 15, mobile 1.278, web 678; builds Debug aprovados; configurar Firebase/APNs e testar aparelhos físicos antes de qualificar; sem deploy/push |
| 07–19 | Planejadas | — | Executar sequencialmente; critérios acima |
