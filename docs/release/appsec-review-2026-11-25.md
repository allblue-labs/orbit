# Auditoria AppSec do Orbit — 25/11/2026

**A publicação permanece bloqueada.** As prioridades imediatas são proteger alterações
de fatores de autenticação, reduzir o custo de emissão anônima de desafios e
exigir aceite operacional antes de automatizar a exclusão de dados em produção.
Os aceites de publicação que dependem do ambiente e dos artefatos também estão
listados abaixo.

## Escopo e evidências

Revisão do código em `d9f61f10` para NestJS, PostgreSQL/RLS, Next.js, BFF,
Flutter e configuração de release. Foram examinadas fronteiras entre
usuários, organizações, unidades, portal do cliente e administração da
plataforma, além de sessão, MFA, uploads, downloads, webhooks, cache, logs,
artefatos e persistência no celular. A classificação usa as edições oficiais
mais recentes de cada projeto. [OWASP Top 10 para Web 2025](https://owasp.org/projects/top-ten) ·
[OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x00-header/) ·
[OWASP Mobile Top 10 2024](https://devguide.owasp.org/en/07-training-education/06-mobile-top-ten/)

O levantamento combina leitura do código, advisories npm, regressões
selecionadas e inspeção de headers do login público de staging. Os fluxos
privilegiados foram avaliados pelo contrato e pelas condições verificadas no
código. Entrega física de push, conteúdo de backup iOS e configurações
privadas dos provedores exigem validação própria.

## Achados

### AS-01 · P1 · Uma sessão ativa autoriza alterações duráveis de autenticação

**OWASP A07:2025 e M3:2024.** O perfil permite desativar TOTP usando a
identidade da sessão. Ativar um fator pede o código do fator novo. O cadastro
de passkey e de credencial de dispositivo também parte de uma sessão ativa.
No mobile, o servidor recebe um segredo rotativo, e a verificação biométrica
acontece no app. O servidor abre uma sessão ao validar esse segredo. Em caso
de comprometimento prévio de sessão, essas operações permitem enfraquecer os
fatores da conta ou prolongar o acesso. O WebAuthn verifica usuário e desafio
na cerimônia, e os códigos de recuperação são consumidos atomicamente. A
lacuna está na autorização para mudar ou adicionar os fatores.

Exigir reautenticação recente, com fator já cadastrado quando disponível,
para cadastrar, substituir e remover fatores. Vincular a aprovação à sessão
e à ação, com validade curta e uso único. Para contas privilegiadas, exigir
uma política explícita de MFA. Para a credencial mobile, considerar prova de
posse com chave não exportável. Cobrir equipe e portal em testes de regressão.
[Perfil e MFA](../../backend/src/modules/identity/presentation/profile.controller.ts#L175) ·
[Biometria da equipe](../../backend/src/modules/identity/presentation/biometric.controller.ts#L109) ·
[Credencial mobile](../../backend/src/modules/identity/application/biometric-login.service.ts#L174) ·
[Cofre Flutter](../../mobile/lib/core/security/biometric_vault.dart#L30) ·
[Orientação OWASP para troca de fatores](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#changing-mfa-factors)

### AS-02 · P1 · Emissão anônima de desafios WebAuthn consome o banco sem limite próprio

**OWASP A06:2025 e API4:2023.** Emitir um desafio abre uma transação,
limpa registros expirados e insere outro registro no PostgreSQL. Os dois
aliases web de emissão da equipe e do portal passam pelo BFF e estão fora
do limite específico de autenticação no Nginx. A rota direta tem proteção
no Nginx, mas a emissão carece de limite no próprio caso de uso. A limpeza
mantém desafios expirados por mais uma hora. O risco é disputar capacidade
de banco e PgBouncer com o login. A capacidade necessária para provocar
degradação ainda precisa ser medida em ambiente isolado.

Aplicar orçamento distribuído antes da transação para os pontos de entrada
de equipe e portal, com resposta 429, e mover a limpeza para tarefa
periódica. Incluir os aliases web na política de borda e validar limites e
disponibilidade do login com tráfego sintético controlado.
[Persistência do desafio](../../backend/src/common/biometrics/auth-challenge.store.ts#L22) ·
[BFF equipe](../../frontend/app/api/auth/biometric/options/route.ts#L8) ·
[BFF portal](../../frontend/app/api/portal/auth/biometric/options/route.ts#L8) ·
[Limites Nginx](../../deploy/staging/nginx/orbit-tls.conf#L93)

### AS-03 · P1 operacional · Retenção destrutiva habilitada por padrão

**OWASP A02:2025 e A10:2025.** O Compose e o exemplo de configuração
habilitam a retenção por padrão. Para objetos públicos, o worker pode
remover a origem e depois falhar ao expurgar a cópia da Cloudflare se a
credencial estiver ausente ou incorreta. O trabalho fica pendente, e a
cópia em cache pode continuar servida. O risco inclui excluir dados antes
de existir uma recuperação de produção ensaiada.

Deixar a ativação explícita no primeiro deploy e liberar a rotina após
validar purge com dados sintéticos, restore do banco com os objetos
referenciados e alertas de falha. O token de purge pertence à zona do CDN
de mídia.
[Valor padrão](../../docker-compose.yml#L220) ·
[Ordem de remoção e purge](../../backend/src/modules/storage/storage-cleanup.service.ts#L154) ·
[Validação da credencial](../../backend/src/modules/storage/public-media-cache.service.ts#L20)

### AS-04 · P2 · Dados operacionais armazenados em claro pelo app

**OWASP M9:2024 e M6:2024.** O cache salva respostas de operações em JSON
no SharedPreferences. As evidências offline são escritas em bytes no
diretório Documents e as filas em JSON no diretório de suporte. As chaves de
sessão usam armazenamento seguro e o cache é isolado por URL da API, usuário,
organização e unidade. O Android tem exclusões de backup e de transferência.
No iOS, o código revisto não marca os dados operacionais para exclusão de
backup nem estipula uma política própria de proteção dos arquivos. A inclusão
efetiva no backup depende da configuração do aparelho.

Minimizar os campos em cache, limitar a janela de retenção, aplicar proteção
de arquivo e excluir de backup os dados apropriados no iOS. Cifrar dados
sensíveis que precisem persistir offline com chave protegida pelo sistema.
Testar troca de usuário, logout, bloqueio do aparelho, sync pendente e
backup/restore nas builds reais.
[Cache](../../mobile/lib/core/storage/read_cache.dart#L86) ·
[Respostas persistidas](../../mobile/lib/features/operations/data/operations_repository.dart#L46) ·
[Mídia](../../mobile/lib/features/evidence/data/media_store.dart#L43) ·
[Fila](../../mobile/lib/core/uploads/upload_queue_store.dart#L81) ·
[Escopo de sessão](../../mobile/lib/app/session_runtime.dart#L28) ·
[Apple e exclusões de backup](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup)

### AS-05 · P2 · Política CSP ausente nas páginas gerais da Web

**OWASP A02:2025.** A configuração define uma CSP de enquadramento apenas
para `/legal/*`. O login de staging retornou HSTS, proteção contra frames
e `private, no-store`. O cabeçalho CSP ficou ausente. Isso reduz a defesa
caso seja introduzida injeção de script. Os pontos de HTML direto revisados
incluem a inicialização de tema e o componente de gráfico. Esta inspeção
não identificou dados controlados por usuário fluindo para esses pontos.

Introduzir CSP em modo de relatório, adaptar os scripts legítimos e depois
aplicar a política nas rotas públicas e autenticadas. Testar cadastro, login,
pagamento e visualização de documentos.
[Headers do Next](../../frontend/next.config.mjs#L14) ·
[Inicialização do tema](../../frontend/app/layout.tsx#L96)

### AS-06 · Gate · Auditoria da cadeia de distribuição incompleta

**OWASP A03:2025, A08:2025 e M2:2024.** Os grafos npm de runtime retornaram
zero advisories em Web e API. Os grafos completos retornaram 25 entradas
moderadas na API e sete na Web, incluindo a propagação transitiva. Os
advisories diretos observados afetam `glob` e `minimatch`. A política do
repositório aprovou estes resultados em 25/11, com as exceções atuais
válidas até 26/11/2026. O builder publica digests e proveniência mínima.
A aprovação do artefato exige inventário e scan das camadas OCI, incluindo
migrator e backup, e assinatura verificável dos digests. O inventário do
binário Android/iOS e de suas dependências nativas exige uma rodada própria.
[Política de CI](../../scripts/audit-policy.mjs#L19) ·
[Exceções temporárias](../../scripts/audit-exceptions.json) ·
[Builder](../../deploy/staging/bin/build-push.sh#L39) ·
[Advisory glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) ·
[Advisory minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## Controles revisados

A API aplica guards de autenticação, tenant, superfície, permissão e produto.
Os papéis de runtime e do migrator são separados, há políticas RLS e o
hotpath consulta a sessão e o escopo antes de reutilizar dados em cache.
O BFF valida origem, método e caminho, e a API reavalia a sessão e as
permissões. A emissão de upload tem limites e o R2 privado provê URLs
temporárias. Os testes selecionados dão cobertura a esses contratos
específicos. As jornadas entre dois tenants, unidades e perfis distintos
continuam como gate do SHA candidato.

Na rodada desta auditoria, passaram 62 testes do backend sobre MFA,
concorrência de autenticação, verificação SNS e configuração de storage.
Passaram 54 testes Web de allowlist, proxy e limites de corpo, e 24 testes
Flutter de sessão e biometria, incluindo troca de conta e isolamento de
avatar, documentos e cache. A leitura dos headers públicos do login de
staging confirmou `CF-Cache-Status: DYNAMIC` e `private, no-store`.

## Bloqueios recuperados e estado atual

A lista original de sete itens foi recuperada no
[registro do PR-19](production-blockers.md). O
[ensaio original](pr-19-release-qualification.md) e a
[Etapa 04](operacao-etapa-04.md#gate-de-release-em-staging) trazem evidências
de revisões diferentes.

| Bloqueio original | Estado em 25/11 |
| --- | --- |
| Dependências | `picomatch` deixou de aparecer nesta rodada. A política npm passou hoje, com exceções de desenvolvimento que vencem em 26/11. Requalificar o SHA final. |
| Build OCI e evidências | Builds amd64 com digests já foram publicados e usados em staging. Para produção, falta evidência conjunta de SBOM, assinatura verificável e scan das imagens finais. |
| Suítes completas | A rodada posterior da Web registrou 767 unitários, 335 testes de navegador e seis testes adicionais aprovados. Reexecutar no SHA final os gates Web, API e Flutter e os smokes com as migrations correspondentes. |
| Recuperação e rollback | O ensaio mais recente concluiu backup cifrado e restore do banco em PostgreSQL e storage descartáveis. Faltam o restore pareado com os objetos do R2 de produção, prova de alerta e rollback com os digests finais. |
| Purge e retenção | Staging agora usa volume local. A pendência se aplica à produção e inclui o achado AS-03. |
| Mobile, assinatura e push | O AAB histórico foi assinado. Validar AAB e archive do SHA final, números de versão e links para o domínio definitivo. Falta evidência de distribuição iOS, APNs e entrega física em foreground e background no Android e no iOS. |
| SES e SNS | Houve preflight SES em produção e simulação de feedback. Falta o aceite da candidata final com entrega observada na caixa de destino e confirmação de feedback. |

**Pendências adicionais da Etapa 04.** As quatro famílias de falhas Web
passaram na rodada posterior. Staging foi promovido. Não foi localizado um
comparativo formal p50/p95/p99 da baseline `3a2c5418` com a candidata em
staging. O evento real do Sentry permanece pendente de acesso à conta e
configuração de DSNs. As validações do hostname e dos controles Cloudflare de
produção dependem da origem definitiva.
