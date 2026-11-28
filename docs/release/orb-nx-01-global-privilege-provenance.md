# ORB-NX-01 — Proveniência global e namespace de papéis

Base: `3a13b34f48fc271241898534186e95b8dae037f7`, branch `feat/features-and-backlogs`, 14/11/2026.
Escopo exclusivo: NX-A01 da [auditoria PR-00.C](../integrations/nexus/orbit-v2-current-state-audit.md).

## Estado Git e preservação

As declarações de ausência de commit neste relatório descrevem o encerramento da implementação, antes da autorização posterior dos checkpoints.

Inicialmente, HEAD e referência local `origin/feat/features-and-backlogs` estavam no SHA-base, com somente os seis relatórios `docs/integrations/nexus/orbit-v2-*.md` não rastreados. Esses relatórios foram lidos e preservados, sem edição, staging ou inclusão em commit desta entrega.

As alterações ORB-NX-01 ficam no backend e neste registro/evidência de release. Não houve commit, push, merge, deploy ou operação no servidor. Nenhuma funcionalidade Nexus, OAuth/SSO, Corporate Admin, cobrança ou suspensão operacional foi implementada. A ORB-NX-02 não foi iniciada.

## Causa raiz e correção

Antes, `toAuthenticatedIdentity` juntava chaves de membership e de atribuição global; a checagem de grant dependia de a claim antiga conter `PLATFORM_ADMIN`; guards e RLS aceitavam o nome da role como autoridade. Assim, renomear papel de tenant após emitir a sessão podia transformar o nome em privilégio global.

Agora há uma prova interna `VerifiedPlatformAuthority`:

- `IdentityRepository.findIdentity` consulta concessões persistidas não revogadas, ligadas a papel global (`organizationId=null`) não excluído, sob contexto RLS do próprio usuário.
- A fábrica verifica também usuário da concessão, ID da atribuição e correspondência de role ID. Produz snapshot imutável com IDs das concessões, roles, permissões e superfícies globais.
- Uma marca runtime em `WeakSet` reconhece apenas instâncias emitidas pelo servidor. JSON, objeto de mesma estrutura, JWT e job serializado não reconstroem essa autoridade. O vínculo ao usuário é conferido em cada consumidor.
- `toAuthenticatedIdentity` distingue `organizationRoles` da prova global. Nomes reservados legados de tenant não entram no conjunto de roles compatível com clientes; permissões `platform.*` do tenant também são descartadas. Permissões e superfícies operacionais legítimas são preservadas.
- `JwtAuthenticationGuard` não consulta roles antigas para conceder autoridade. Recarrega o estado atual na mesma fronteira de autenticação usada por login e refresh; o helper booleano antigo foi removido.
- `RoleGuard` usa `AuthorizationService`, que exige a prova para roles do namespace reservado. `PermissionGuard` também não permite que owner ou wildcard de tenant concedam `platform.*`.
- O interceptor passa a prova apenas no contexto interno. `RlsContextProvider` exige prova vinculada ao usuário e ator `INTERNAL_USER` para gerar `app.is_platform_admin=true`.
- `/platform-admin` mantém role e permissão globais; `POST /plans` e `PATCH /plans/:id` passam a exigir também `platform.admin`, além da role global verificada.

O owner continua sendo `Organization.ownerUserId`: administra seu tenant e suas unidades, sem poder global implícito. Concessão corporativa futura, string `NEXUS_*` ou permissões genéricas não são convertidas em autoridade da plataforma.

## Arquivos e consumidores

| Área | Arquivos / responsabilidade |
| --- | --- |
| Prova global | [verified-platform-authority.ts](../../backend/src/common/verified-platform-authority.ts), [identity.repository.ts](../../backend/src/modules/identity/infrastructure/identity.repository.ts) |
| Identidade, login/refresh e superfícies | [authentication.service.ts](../../backend/src/modules/identity/application/authentication.service.ts), [identity.types.ts](../../backend/src/modules/identity/domain/identity.types.ts), [surface-access.ts](../../backend/src/modules/identity/domain/surface-access.ts), [jwt-authentication.guard.ts](../../backend/src/modules/identity/infrastructure/jwt-authentication.guard.ts) |
| Guards e RLS | [authorization.service.ts](../../backend/src/common/authorization.service.ts), [request-context.ts](../../backend/src/context/request-context.ts), [foundation.interceptors.ts](../../backend/src/interceptors/foundation.interceptors.ts), [rls-context.provider.ts](../../backend/src/database/rls/rls-context.provider.ts) |
| Namespace e endpoints | [role-namespace.ts](../../backend/src/common/role-namespace.ts), [organization.service.ts](../../backend/src/modules/organizations/organization.service.ts), [subscription-plan.controller.ts](../../backend/src/modules/subscription-plans/subscription-plan.controller.ts) |
| Persistência | [migration.sql](../../backend/prisma/migrations/20261114195000_orbnx01_role_authority_namespace/migration.sql), comentário de proveniência em [schema.prisma](../../backend/prisma/schema.prisma) |
| Preflight sem escrita | [audit-role-namespace.sql](../../backend/scripts/audit-role-namespace.sql) |
| Unitários novos | [verified-platform-authority.spec.ts](../../backend/src/common/verified-platform-authority.spec.ts), [role-namespace.spec.ts](../../backend/src/common/role-namespace.spec.ts) |
| Fixtures unitárias ajustadas | [surface-access.spec.ts](../../backend/src/modules/identity/domain/surface-access.spec.ts), [jwt-authentication.guard.spec.ts](../../backend/src/modules/identity/infrastructure/jwt-authentication.guard.spec.ts) |
| HTTP/PostgreSQL novo | [global-privilege-provenance.e2e-spec.ts](../../backend/test/global-privilege-provenance.e2e-spec.ts) |

Busca de consumidores: todos os usos executáveis de `PLATFORM_ADMIN`, `platformRoleAssignments`, roles globais, `hasActivePlatformRole` e derivação da flag RLS foram inspecionados. Os controladores existentes permanecem com os mesmos caminhos. Seeds administrativos continuam criando papel global + atribuição própria; sua configuração SQL privilegiada explícita não foi transformada em permissão de tenant. Rotinas sistêmicas existentes que usam SQL administrativo diretamente não foram alteradas nesta PR.

## Compatibilidade de sessão, web, mobile e workers

Nenhum campo público novo é exigido. `AccessTokenClaims`, resposta de login/refresh, `/identity/me/access` e contratos sincronizados mantêm sua estrutura. Roles globais legítimas continuam presentes no campo compatível `roles`. A prova não entra no JWT, DTO público ou fila; a verificação de boundary de contratos confirma a separação.

JWT antigo continua válido criptograficamente enquanto a sessão estiver válida, mas suas roles não concedem autoridade no servidor. Após revogação confirmada no banco:

- Se o usuário ainda tem acesso legítimo ao tenant/superfície, continua nessa função e recebe **403** nas ações globais, inclusive usando token antigo ou refresh.
- Se dependia exclusivamente do grant global para acessar a superfície, recebe **401**, a sessão é revogada pelo guard e o refresh é recusado.
- Um grant global legítimo recém-concedido é reconhecido no próximo request mesmo se o token anterior não o mencionava.

A revogação é verificada na fronteira de cada requisição, não uma interrupção retroativa de uma transação já iniciada. Clientes que mostrem uma role antiga a partir do JWT podem manter indicação visual até atualizar o contexto; isso não autoriza a API. Workers de tenant continuam construindo contexto sem prova global e mantendo o recorte de organização/unidades. Uma cópia serializada de contexto não transporta bypass global.

## Migration e tratamento dos dados legados

Migration nova: `20261114195000_orbnx01_role_authority_namespace`. Nenhuma tabela/coluna é criada ou removida; o schema só recebeu comentário. A migration adiciona funções de normalização/reserva, preflight de contagem e trigger de proteção. Não altera roles, memberships, convites, grants, credenciais ou sessões existentes.

Chaves/nome passam por NFD, remoção de diacríticos, uppercase, normalização de separadores e limite de 80 caracteres. São reservados os namespaces `PLATFORM`, `GLOBAL`, `CORPORATE`, `NEXUS`, seus prefixos com `_` e o alias compacto `PLATFORMADMIN`. A API e o banco validam variantes como `platform admin`, `Plátform---Admín` e `nexus.admin`. Falhas de domínio usam mensagem em pt-BR, status 400; gravações SQL proibidas recebem `23514 / roles_authority_namespace`.

O trigger cobre INSERT e mudanças de organização/chave/nome, inclusive caminhos SQL alternativos. Conflitos preexistentes ficam preservados; uma atualização que não altere esses campos não faz saneamento automático. Converter role atribuída globalmente em role de tenant também é recusado, complementando o trigger anterior de `PlatformRoleAssignment`.

Procedimento para uma futura implantação, **não executado no servidor nesta entrega**:

1. Executar o [preflight somente leitura](../../backend/scripts/audit-role-namespace.sql) com conexão administrativa de leitura autorizada, antes da migration. O script é independente das novas funções e não expõe credenciais. Uma conexão de tenant não serve como inventário global porque RLS oculta outros tenants.
2. Registrar IDs de roles, organizações, vínculos/convites e anomalias de grants encontrados, sob acesso restrito. Incluir soft-deleted para evitar reativação silenciosa de conflito.
3. Aplicar a release/migration pelo processo aprovado. A própria migration conta e informa conflitos antes de instalar a proteção, sem exigir reparo destrutivo.
4. Repetir o preflight. Para cada divergência, confirmar origem e intenção com o responsável. Renomeação/recriação ou reatribuição só pode ocorrer por tratamento explícito posteriormente autorizado; nenhuma dessas ações é automática nesta PR.

Nenhum inventário de dados de produção foi feito. A aplicação já nega a autoridade global dos registros legados, mesmo sem saneamento desses nomes. Rollback para o código vulnerável reabre o achado; restaurar permissividade não é estratégia de recuperação aceitável. Preferir correção adiante e manter a proteção de persistência.

## Regressões e resultados

As execuções integradas usam `scripts/verify-integrations.mjs`: criam PostgreSQL 17.11 descartável em loopback, aplicam migrations e seed, provisionam `orbit_app`, executam apenas os arquivos selecionados e removem o contêiner ao final. A API e a conexão SQL de prova usam runtime sem `SUPERUSER`/`BYPASSRLS`.

Conexões administrativas só preparam/inspecionam fixtures. Para emular uma linha legada que existiria antes da migration, o teste desabilita e restaura o trigger **dentro de uma transação administrativa da fixture**, no banco descartável. Isso não ocorre no caminho de validação do produto: HTTP e consultas sem filtros usam a conexão restrita. O script read-only deve encontrar essa divergência e o teste exige que ela permaneça no banco sem produzir privilégio.

| Requisito | Evidência |
| --- | --- |
| Role renomeada e nome reservado | Unitários de namespace e cinco variantes HTTP + INSERT/UPDATE SQL restrito recusados |
| Sessões antes/depois da alteração | Fixture legada, login novo, token anterior, refresh e login MOBILE continuam sem poder global |
| Sem grant legítimo / claim antiga | JWT válido assinado com roles globais sintéticas é ignorado para autorização; endpoints recusam |
| Grant legítimo | Token anterior ao grant recebe admin autorizado e flag RLS verdadeira; criação/edição de plano funcionam |
| Grant revogado | Tokens de antes/depois do grant e refresh perdem autoridade sem esperar expiração |
| Isolamento | Probe HTTP real executa SELECT sem WHERE em organizações/unidades; tenant A/A1 não vê B, B1 ou A2 |
| Endpoints sensíveis | GET platform-admin, POST/PATCH plans; owner/membro negados, admin global autorizado |
| Owner preservado | Criação/edição de role comum, organização própria e todas as suas unidades permanecem disponíveis |
| Admin sem tenant | Login e consultas globais funcionam; revogação remove a superfície e invalida sessão |
| Persistência de grants | Tenant não cria role global/grant por SQL restrito; role de tenant não pode ser atribuída globalmente; role global atribuída não pode migrar para tenant |

Comandos de verificação:

```sh
# Na raiz: banco descartável, sem consumir DATABASE_URL do host como alvo.
node scripts/verify-integrations.mjs backend --testPathPatterns='global-privilege-provenance|identity-concurrency|rls.e2e'

# Em backend/:
npm test -- --runInBand --watchman=false --testPathPatterns='verified-platform-authority|role-namespace|authorization.service|foundation.guards|jwt-authentication.guard|authentication-concurrency|login-refusal|surface-access|organization.service|request-context|identity.repository'
npm run typecheck
npm run build
npm run contracts:guard
npm run lint:public-errors
```

| Verificação final | Resultado real |
| --- | --- |
| Unitários direcionados | **11 suítes / 60 testes aprovados**, 11,126s |
| HTTP/PostgreSQL consolidado | **3 suítes / 43 testes aprovados**, 82,022s; inclui 12 cenários novos e regressões de RLS/concorrência existentes |
| Typecheck / build Nest | Aprovados |
| ESLint nos arquivos TypeScript alterados | Aprovado |
| Boundary de contratos sincronizados | Aprovado, sem alteração do contrato público |
| Guard de erros públicos | Aprovado, 72 códigos; nenhum matching de mensagens backend nos clientes |
| Diff e preservação da auditoria | Sem erro de whitespace; seis relatórios PR-00.C preservados |

ESLint foi executado nos arquivos TypeScript alterados. A primeira execução geral apontou apenas formatação em fixture nova, corrigida e revalidada. As primeiras tentativas integradas detectaram erros da fixture (chave de plano longa e e-mail não normalizado); foram corrigidos sem enfraquecer validações ou regras de produto. A rodada consolidada também executou o preflight read-only contra a linha legada sintética. Detalhes e hashes ficam na [evidência](evidence/orb-nx-01-global-privilege-provenance.json).

## Limites e riscos residuais

Não foram repetidas suítes extensas de produto, builds web/mobile, carga, varredura de CVEs ou testes em produção. Não houve inventário externo de roles, CI remoto, deploy ou aceite de release. A ferramenta Node local é 25.1.0; a CI/release continua responsável pela matriz Node 22 declarada no projeto. O driver emite aviso de depreciação preexistente sobre queries concorrentes; o cenário intencional de worker inválido da suíte RLS também produz log de erro esperado.

Permanecem fora do escopo NX-A02 (suspensão), NX-A03 (admin/billing canônico), reconciliação Stripe e demais PRs de produção/integração. Passar este gate específico não aprova o lançamento completo nem habilita integração Nexus.

**Parecer: ORB-NX-01 tecnicamente concluída no gate local de segurança solicitado.** Nenhum resultado de mock é apresentado como prova de RLS real. HEAD final permanece `3a13b34f48fc271241898534186e95b8dae037f7`; a worktree contém a implementação e estes registros, além dos seis documentos anteriores ainda não rastreados. Não há commit ou arquivos em staging. O parecer não é aprovação de produção ou das demais ORB-NX/PRs.


## Registro posterior dos checkpoints autorizados

Após autorização explícita do usuário, foram preparados dois checkpoints locais separados:

- **PR-00.C:** commit `7e8fec077fd9fbbb1f80f31ed1ebe7a6137b6e77`, exclusivamente os seis relatórios de auditoria.
- **ORB-NX-01:** o commit que contém este registro, exclusivamente implementação, migration, preflight, testes e evidências da correção.

Os hashes dos 21 arquivos do backend foram conferidos contra a evidência dos testes e permaneceram iguais. Os seis relatórios anteriores também foram preservados. Nesta etapa só foi atualizada a identificação documental dos checkpoints; não houve nova alteração de comportamento que justificasse repetir os testes. Nenhum push, merge ou deploy foi realizado.
