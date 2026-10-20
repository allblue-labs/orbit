# ADR-006 — Permissão de RBAC e direito comercial são conceitos separados

- Status: accepted
- Data: 2026-09-06

## Contexto

Antes da PR-PL-01 o Orbit tinha **um** vocabulário para duas perguntas. A
coluna `plans.capabilities` guardava cadeias como `operations.read` e
`financial.manage`, e o `CapabilityGuard` as conferia em 304 pontos de
controlador. Isso é uma lista de **permissões**, concedida por plano — não uma
descrição do que a organização comprou.

O nome escondia a diferença. Perguntar "esta organização tem
`rvt.document`?" mistura duas coisas que mudam por motivos diferentes: o que a
empresa contratou, que muda quando ela troca de plano, e o que uma pessoa pode
fazer, que muda quando alguém troca de papel. Um catálogo comercial construído
por cima dessa coluna herdaria a confusão e ainda a espalharia.

## Decisão

Manter as duas camadas separadas, com vocabulários próprios.

**Permissão de RBAC** continua onde está: `plans.capabilities` +
`@Capabilities(...)` + `@Permissions(...)`. Nada foi renomeado, movido ou
removido — 304 pontos de controlador dependem disso, e mexer neles seria uma
mudança de autorização disfarçada de arrumação.

**Direito comercial** nasce novo, em código, em
`modules/subscription-plans/catalog`: quinze `PlanCapability` e doze recursos
com teto. É o `EntitlementService` quem responde, e ele nunca lê
`plans.capabilities`.

Uma ação sensível às duas coisas passa pelas duas: a organização contratou a
área, **e** a pessoa tem permissão. A execução de IA é o caso vivo — o plano
sem inteligência não recebe as permissões `ai.*` na semeadura, e o
`EntitlementService` recusa `ORBIT_INTELLIGENCE` no serviço. Dois portões que
concordam, por caminhos independentes.

## Consequências

- nenhuma regra de produto decide por nome de plano; decide por capacidade;
- trocar o rótulo comercial de um plano não toca em autorização;
- o catálogo comercial vive em código e é a autoridade sobre tetos: uma linha
  editada no banco não afrouxa limite;
- a coluna `plans.capabilities` fica com o nome histórico, agora documentado
  como lista de permissões — renomeá-la é migração de autorização, e terá a sua
  própria PR se algum dia valer a pena;
- planos anteriores ao catálogo continuam sem teto comercial, por decisão
  nomeada (`LEGACY_UNGOVERNED`) e não por omissão.
