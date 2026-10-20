# PR-28 — Técnico em Campo responsável e auxiliares técnico

## Modelo e autoridade

Antes desta PR, `OperationUser` representava participantes sem distinguir responsabilidade e apoio. Agora `Operation.responsibleFieldTechnicianId` é a autoridade única do Técnico em Campo responsável e `OperationAuxiliaryTechnician` registra `0..N` auxiliares técnico com atribuição e remoção auditáveis. `TECHNICAL_RESPONSIBLE` continua sendo responsabilidade documental do PR-27 e não satisfaz nenhuma destas funções operacionais.

Em eventos vinculados (`sourceModule=operations`, `sourceEntityType=OPERATION`), Operation é a autoridade e Scheduling mantém uma projeção unidirecional para agenda, conflitos e disponibilidade. Substituição, inclusão e remoção atualizam essa projeção na mesma transação. Eventos independentes usam allocations próprias com roles `RESPONSIBLE_FIELD_TECHNICIAN` e `AUXILIARY_TECHNICIAN`, validadas pelo mesmo perfil profissional e escopo de unidade.

## Assignment não é authorization

Ser responsável ou auxiliar não concede permission/capability. Guards continuam exigindo plano, capability, permission, tenant e unidade. Para execução, o backend combina permission existente com contexto de assignment; `operations.assign` representa a autoridade gerencial. Um auxiliar com apenas `scheduling.read` vê o contexto autorizado da agenda, mas não inicia, edita, conclui, anexa evidência ou gera documento.

`allowedActions` é calculado por ator no mapper público. Ele nunca deriva acesso financeiro e não substitui os guards das mutations.

## Comandos e histórico

- `PATCH /api/v1/operations/:id/responsible-field-technician` substitui explicitamente o responsável.
- `POST /api/v1/operations/:id/auxiliary-technicians` adiciona um auxiliar.
- `DELETE /api/v1/operations/:id/auxiliary-technicians/:userId` remove um auxiliar.

Promover um auxiliar remove seu vínculo auxiliar atomicamente. `OperationHistory`, `AuditLog` e Domain Events preservam anterior, novo, ator e instante. Durante `IN_PROGRESS`, a troca é permitida, mas `startedBy` e `completedBy` guardam os executores reais e nunca são reescritos pelo responsável atual.

## Integridade, migration e RLS

A migration cria FK, índices para responsável/fila e auxiliares, além de unique parcial `(operation_id,user_id) WHERE removed_at IS NULL`. O backfill só promove operações com exatamente um `OperationUser`; múltiplos vínculos são ambíguos e nenhum auxiliar é inventado. A tabela nova usa RLS + FORCE RLS, policy que confirma organização do pai e grants para `orbit_app`.

O perfil é organization-wide, mas a elegibilidade exige `BusinessUnitMembership` ativo na unidade da demanda. IDs de outro tenant, usuários inativos e perfis somente `TECHNICAL_RESPONSIBLE` falham fechados.

## Contratos e evolução

Operation publica `responsibleFieldTechnician`, `auxiliaryTechnicians`, `startedBy`, `completedBy` e `allowedActions`. Agenda publica os dois papéis e `assignmentAuthority`. O vínculo legado `users` permanece temporariamente para compatibilidade, sem autoridade V2.

PMOC V2 poderá referenciar essa estrutura por equipamento; RVT V2 poderá combinar responsável de campo, auxiliares técnico e Responsável Técnico documental sem misturar conceitos. Mobile poderá montar “Meu trabalho” filtrando responsável/auxiliar e respeitando `allowedActions`, sem reconstruir políticas no cliente.
