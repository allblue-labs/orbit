# Integridade relacional entre tenants — PR-12

O banco passa a exigir coerência de organização nos vínculos de domínio, além
das policies RLS e seleções validadas pelos serviços. A prova A → cliente B em
`rvt_configurations` agora falha mesmo quando a linha filha passa no WITH CHECK.
Não há alteração de permissões, desativação de RLS, limpeza automática ou correção
por adivinhação do tenant de um registro.

## Inventário e contrato congelado

O inventário parte das **455 FKs reais** da baseline PR-11, incluindo relações
criadas por SQL que não aparecem integralmente no schema Prisma. **208** dessas
FKs ligam tabelas que têm `organization_id`. O manifesto está em
[src/database/relational-integrity/rules.json](../src/database/relational-integrity/rules.json).

| Tratamento | Resultado |
| --- | --- |
| Novas FKs compostas | 185; inclui a referência de calendário do RVT que não tinha FK |
| FKs compostas anteriores | 10 preservadas, sem recriar vínculos já protegidos |
| Igualdade também de unidade | 31 FKs de hierarquia/execução com unidade obrigatória |
| Referências globais ou do mesmo tenant | 10 guards para papéis e modelos/versões |
| Junções sem coluna própria de tenant | 4 guards: operação/equipamento, orçamento/equipamento, plano/unidade PMOC e alocação de agenda/equipamento |
| Exceção de identidade reutilizável | Histórico de entrega → instalação física de push |

Os índices únicos de destino e de busca de origem são criados somente quando
não há índice compatível. As FKs novas complementam as relações lógicas do
Prisma; não se deve removê-las ao gerar migrations futuras por introspecção.
`npm run integrity:generate` reproduz a migration a partir deste contrato v1.
O manifesto v1 e a migration aplicada ficam **congelados**: ampliações futuras
precisam de versão/migration aditiva, preservando seus checksums. Os testes
conferem os vínculos originais, todas as FKs novas e sua validação.

## Organização, unidade e história

- FKs relacionam `(referência, organization_id)`; nas 31 hierarquias de unidade
  relacionam também `business_unit_id`. Erros de FK têm SQLSTATE `23503`.
- Cascades e restrições de exclusão anteriores são mantidos. Nos relacionamentos
  opcionais, SET NULL atua somente no ID da referência, sem apagar o tenant da
  linha filha. Alterações dos IDs/tuplas referenciadas ficam restritas.
- O tenant dos objetos referenciados é imutável. Isso protege também os guards
  indiretos e globais contra reparenting concorrente, inclusive com snapshots
  antigos. O fluxo autorizado de multi-organização cria os objetos no tenant de
  destino; identidades de usuário e memberships continuam compartilháveis.
- Papéis e modelos globais continuam aceitos onde o produto já os usa. Um modelo
  privado de outro tenant é recusado; uma versão global não pode apontar para um
  template privado. Os guards de namespace/proveniência dos papéis continuam
  valendo, e esta PR não transforma um papel de tenant em autoridade global.
- RVT valida cliente/unidade do equipamento ao criar ou trocar uma associação,
  inclusive evidência ligada a equipamento e UUIDs em `equipment_ids` da visita.
  Locks de leitura protegem essa validação até terminar a escrita. Ela não
  reinterpreta snapshots históricos segundo o dono atual de um equipamento.
- Referências a equipamentos históricos, identidade QR e lançamentos de estoque/
  financeiro podem manter unidade diferente da unidade atual do objeto ou da
  operação. Continuam exigindo o mesmo tenant; autorização por unidade e os
  snapshots existentes permanecem obrigatórios. Pais com unidade opcional
  (calendário, mídia, catálogo) conservam o compartilhamento por organização;
  esta PR não inventa uma unidade para seus registros globais/agrupados.

A exceção `mobile_push_deliveries.installation_id` é deliberada: o mesmo celular
é reatribuído ao usuário/tenant corrente por `app_register_mobile_installation`.
Seu ID físico pode aparecer no histórico anterior. Congelar esse tenant ou
cascadear seu tenant para entregas antigas quebraria troca segura de conta ou
reescreveria o histórico. O serviço de push continua verificando destinatário,
tenant e elegibilidade atuais antes de enviar. A FK de existência é preservada;
não se cria permissão de ler a instalação de outra conta.

`sessions` e `identity_invitations` mantêm as exceções de RLS do plano de
identidade; não se habilita RLS nelas indiscriminadamente. O usuário global não
recebe um tenant artificial. Nos registros de identidade/auditoria em que
`organization_id` é legitimamente nulo, o comportamento MATCH SIMPLE permanece.

## Preflight e aplicação futura

```sh
cd backend
npm run build
# Disponibilize DATABASE_URL administrativa por ambiente seguro; não cole senha
# na linha de comando nem forneça APP_DATABASE_URL ao preflight.
npm run integrity:check
```

O comando **não carrega dotenv automaticamente**. Use o mecanismo seguro de envs
da administração do ambiente. Executa transação READ ONLY / REPEATABLE READ,
com visibilidade administrativa e `row_security=off`, sem escrita. Uma credencial
sujeita a RLS não pode produzir um relatório falsamente limpo. Saídas:

- `0`: nenhum conflito nas 199 regras de integridade contínua;
- `2`: conflitos, somente identificador de regra e contagem, sem nomes, documentos
  ou valores de tenants;
- `1`: conexão/schema/permissão indisponível; não significa aprovação.

Investigar cada regra e identificar a relação correta com o responsável pelos
dados. Não excluir registros nem trocar `organization_id` automaticamente.
O preflight verifica as invariantes contínuas; as verificações de cliente atual
no instante da associação RVT não invalidam retroativamente snapshots históricos.

1. Fazer backup e ensaiar a migração em cópia controlada, incluindo restore.
2. Rodar o preflight sobre a baseline PR-11. Conflitos interrompem o rollout.
3. Pausar gravações e aplicar `20261117100000_relational_tenant_integrity` com a
   credencial administrativa. Há criação de índices e locks de escrita; reservar
   janela e medir a duração em dados representativos. `lock_timeout=10s` e
   `statement_timeout=10min` limitam cada aquisição/statement, não o rollout inteiro.
4. A migration é transacional: repete o preflight, instala/valida as FKs e guards,
   e revalida os casos protegidos por trigger após obter os locks. Dados inválidos,
   falta de privilégio ou timeout fazem rollback, sem correção parcial de linhas.
5. Reconciliar privilégios pelo provisionador atualizado e implantar a API. As
   funções de validação são trigger-only, SECURITY DEFINER com search_path fixo,
   sem retorno de dados e sem EXECUTE direto para o runtime/PUBLIC.
6. Repetir o preflight e validar cadastro, login, RVT/PMOC, troca de conta mobile
   e os caminhos de multi-organização. Retomar gravações após os checks.

Não houve execução desses passos em servidor real nesta PR. Um rollback de
binário pode conservar as constraints; não as desligar para voltar a aceitar
referências inconsistentes. Uma migration que falhar antes do commit deve ser
investigada e marcada como revertida no histórico Prisma **somente após confirmar
o rollback e o estado real do banco**, antes de tentar novamente.

Referências: [FKs compostas, SET NULL por coluna e validações na inserção](https://www.postgresql.org/docs/17/ddl-constraints.html),
[RLS e visibilidade administrativa](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
