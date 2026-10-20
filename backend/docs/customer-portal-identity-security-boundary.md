# Customer Portal — Identity & Security Boundary

## Decisão

O Customer Portal usa `CustomerPortalIdentity`, `CustomerPortalSession`,
`CustomerPortalInvitation` e `CustomerPortalPasswordReset`. Nenhum desses
registros é um `User`, `Credential`, `Session`, membership, role ou capability
interna. Uma pessoa pode ter o mesmo endereço de e-mail nos dois mundos sem
compartilhar senha, sessão, MFA ou autorização.

Na V1, uma identidade pertence a exatamente uma Organization e um Customer.
Várias pessoas podem representar o mesmo Customer. Dentro de uma Organization,
o e-mail normalizado é único; em Organizations diferentes ele pode se repetir.

## Resolução de tenant e escopo

Como o deployment atual não possui hostname tenant-aware, o login exige
`organizationSlug + email + password`. O slug é apenas a chave de descoberta no
login. Após autenticação, `organizationId` e `customerId` vêm exclusivamente do
vínculo persistido e da sessão. Nenhum endpoint público aceita esses IDs como
autoridade.

`Customer` é organization-scoped no modelo atual; não pertence a uma única BU.
Por isso o Portal não possui seletor de BU. Reads futuros devem combinar
Organization + Customer ownership e só atravessar Units quando o recurso
continuar pertencendo ao mesmo Customer. Essa regra é o ponto de extensão da
PR-33. `CustomerPortalAuthorizationPolicy.scope()` produz esse predicado a
partir do actor validado e `assertOwns()` responde como ausência (404) para
resource de outro Customer/tenant, evitando probing.

## Fluxos

### Convite e ativação

1. Operador interno com `crm.manage` e `customers.update` cria o convite.
2. O backend valida Customer e Contact no tenant, cria/reutiliza a identidade
   `INVITED`, revoga convite pendente anterior e persiste somente SHA-256 do
   token opaco aleatório.
3. A ativação trava o convite, verifica validade/single-use, grava Argon2id,
   marca o e-mail como verificado e ativa a identidade em uma transação.
4. Ativações concorrentes têm uma única vencedora.

Não existe self-signup, senha padrão, seed de cliente ou senha compartilhada.
O adapter de delivery é deliberadamente no-op e nunca registra token: conectar
o provedor transacional de e-mail é dívida explícita antes de produção.

### Login, refresh e logout

- access token: JWT de 15 minutos, secret derivado com domain separation,
  issuer/audience e `type=portal_access` exclusivos;
- claims mínimas: identity, session, organization, customer e actorType;
- refresh: opaco, 48 bytes aleatórios, somente SHA-256 no banco, 30 dias e
  rotação compare-and-swap;
- múltiplas sessões são permitidas;
- logout revoga apenas a Portal Session;
- identity, Customer ou Organization desabilitado/inativo invalida a sessão no
  próximo request;
- troca/reset de senha revoga sessões antigas (troca autenticada preserva a
  sessão corrente, coerente com o fluxo interno).

Rotas:

```text
POST  /api/v1/portal/auth/login
POST  /api/v1/portal/auth/refresh
POST  /api/v1/portal/auth/logout
POST  /api/v1/portal/auth/activate
POST  /api/v1/portal/auth/password/reset-request
POST  /api/v1/portal/auth/password/reset-confirm
PATCH /api/v1/portal/auth/password
GET   /api/v1/portal/me
POST  /api/v1/customers/:customerId/portal/invitations
POST  /api/v1/customers/:customerId/portal/identities/:identityId/disable
POST  /api/v1/customers/:customerId/portal/identities/:identityId/revoke-sessions
```

## Isolamento de actors

O guard interno ignora controllers Portal por `@Public()`, mas as rotas
protegidas usam `CustomerPortalGuard`. Esse guard aceita somente issuer,
audience, secret derivado, actorType e token type do Portal e revalida a sessão
no PostgreSQL. Um token Portal falha no guard interno; um token interno falha no
guard Portal. Não há impersonation implícita nem conversão por e-mail.

`RequestContext` declara `actorType`, `portalIdentityId` e `customerId`. A
`RlsTransaction` aplica essas variáveis com `set_config(..., true)`, portanto o
contexto morre no fim da transação e não vaza pelo pool. Worker continua usando
seu contexto preexistente e nunca recebe Portal actor.

## RLS e invariantes

Todas as cinco tabelas novas usam `ENABLE RLS` e `FORCE RLS`. As policies de
identidade/sessão exigem actor, Organization, Customer e identity simultâneos.
O gerenciamento interno exige o tenant atual e `customers.update`. Convite,
reset e rate limit públicos só são manipulados por funções estreitas
`SECURITY DEFINER`; acesso direto sem contexto não possui policy e falha
fechado.

FK composta impede sessão/token de apontar para identity de outro Customer ou
tenant. Trigger valida também que Customer e Contact pertencem ao mesmo escopo.
Índices parciais garantem um convite e um reset pendente por identidade.

## Transporte Web, CORS e CSRF

O Nest publica Bearer tokens para clientes API. O futuro BFF do Portal deve
guardar refresh em cookie com nome próprio (`orbit_portal_refresh`),
`HttpOnly`, `Secure` em produção, `SameSite=Lax` e path restrito ao namespace
Portal. Nunca usar o cookie interno nem `localStorage` para refresh. Se o BFF
adotar mutations cookie-authenticated, deverá aplicar token CSRF/origin check.

O HTTP bootstrap atual não habilita CORS, porque o Web usa BFF same-origin. Se
um Portal separado passar a chamar o Nest diretamente, seu origin deverá ser
adicionado por allowlist explícita no deployment; wildcard não é aceitável.
Também não há middleware geral de security headers no backend para duplicar;
esses headers continuam responsabilidade da borda Web/reverse proxy.

## Threat model

| Ameaça                           | Controle                                                  |
| -------------------------------- | --------------------------------------------------------- |
| credential stuffing              | rate limit PostgreSQL + lockout após 5 falhas             |
| enumeração                       | mensagem e timing genéricos; reset sempre aceito          |
| furto de sessão                  | access curto, refresh opaco/hashado, rotação e revogação  |
| replay de invite/reset           | hash, expiry, row lock e consumo single-use               |
| cross-customer/tenant            | claims derivadas da sessão, FK composta, RLS/FORCE        |
| confusão de token interno/Portal | secret derivado, issuer, audience, type e guard separados |
| furto de token de e-mail         | token nunca armazenado em claro nem logado                |

Métricas usam apenas nomes de evento (`login.attempt`, `login.success`,
`invite.activation`, `password.reset`, `session.active`), sem IDs, Customer ou
e-mail como label.

## Limitações conhecidas

- delivery real de invite/reset ainda precisa de adapter de e-mail;
- MFA, SSO, federação, self-signup e impersonation estão fora de escopo;
- UI/BFF do Portal ainda não existe;
- Read Models operacionais (OS, PMOC, RVT, documentos etc.) pertencem à PR-33;

## Closure Gate PostgreSQL

O gate final aplicou a migration
`20260906120000_pr32_customer_portal_identity_boundary` pelo fluxo oficial do
projeto. A validação em PostgreSQL real revelou dois problemas de execução nas
funções públicas do Portal: uma referência ambígua a `status` durante a
ativação e a desserialização, pelo Prisma, do retorno `void` do registro de
falha de login.

A migration original permaneceu imutável. A correção foi entregue de forma
aditiva em `20260906130000_pr32_portal_function_runtime_fix`, qualificando a
coluna ambígua e preservando os grants restritos ao `orbit_app`; o repositório
passou a projetar o retorno `void` como texto para compatibilidade com o driver.

Estado validado no encerramento:

- 44 migrations aplicadas e nenhuma pendente;
- RLS e FORCE RLS habilitados nas cinco tabelas do Portal;
- `orbit_app` sem `SUPERUSER` e sem `BYPASSRLS`;
- E2E dedicado aprovado duas vezes, com 16 testes por execução;
- E2E global aprovado, com 24 suites e 245 testes;
- testes unitários aprovados, com 85 suites e 467 testes;
- builds, lint, contratos, Next.js e Flutter aprovados.
