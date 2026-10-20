# ADR-005 — Customer Portal usa identidade externa separada

- Status: accepted
- Data: 2026-09-03

## Contexto

O RBAC interno representa owners, operadores e profissionais. Um contato de
Customer é um actor externo, com ownership limitado aos dados do próprio
Customer. Transformá-lo em `User` com uma role menor permitiria confusão de
tokens, sessões, MFA, memberships e futuras capabilities.

O mesmo e-mail também pode representar uma pessoa interna e externa, ou acessar
portais de organizações distintas.

## Decisão

Criar aggregate e storage próprios para Portal identity, credential, session,
invitation e reset. A V1 usa vínculo 1 identity → 1 Organization → 1 Customer.
O login recebe `organizationSlug` porque não há tenant-aware host; autorização
sempre usa IDs persistidos. Access JWT usa chave derivada, issuer/audience/type
exclusivos e não carrega RBAC interno.

## Consequências

- tokens e sessões não são substituíveis entre superfícies;
- mesmo e-mail interno/Portal e cross-organization é válido;
- toda leitura futura do Portal nasce de `portal identity → organization →
customer → resource ownership`;
- suporte/admin não ganha impersonation implícita;
- MFA/SSO e membership multi-Customer exigirão decisões futuras explícitas.
