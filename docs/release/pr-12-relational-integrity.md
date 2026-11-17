# PR-12 — Integridade entre organizações e unidades

Achado **F12**, base limpa `7e5edf3`, implementação local em 16/11/2026.
Commit de implementação: a registrar após os gates locais.
Sem push, merge, deploy, operação em banco de cliente ou migração destrutiva.

## Implementação

- Inventário das **455 FKs reais** da baseline, incluindo as não representadas
  integralmente pelo Prisma; 208 FKs entre tabelas com escopo de organização.
- **185 FKs compostas novas**, mantendo as dez compostas anteriores; **31** exigem
  também igualdade de unidade. A referência de calendário do RVT passa a ter FK.
- Dez guards permitem modelos/papéis globais ou do mesmo tenant; quatro verificam
  junções sem coluna própria de organização. O tenant dos objetos referenciados
  fica imutável, impedindo reparenting posterior, inclusive com snapshots antigos.
  Um pai ausente é recusado no guard, sem ser confundido com pai global nulo numa
  corrida entre INSERTs. FKs, RLS e filtros dos serviços continuam independentes.
- RVT verifica cliente/unidade do equipamento no instante da associação, evidência
  e lista de equipamentos da visita. Snapshots históricos não são reescritos
  quando a propriedade/unidade atual de um equipamento muda legitimamente.
- Preservados usuários globais, papéis/modelos compartilhados e as exceções RLS
  de identidade (`sessions`, `identity_invitations`). A instalação física de push
  é uma exceção temporal documentada: rebind não move entregas históricas para o
  novo tenant e não permite enviar mensagens antigas ao novo usuário.
- Preflight administrativo READ ONLY com saída por regra/contagem; migration
  transacional, locks/timeouts, validação das FKs e rechecagem dos guards.
  Nenhuma linha é corrigida, mesclada ou excluída automaticamente.
- Índices existentes são reaproveitados; na baseline descartável foram criados
  **111 índices**, em vez de duplicar indiscriminadamente todos os caminhos de busca.
  Funções privadas de validação não recebem EXECUTE direto pelo runtime; o
  provisionador publica grants/revogações desse conjunto atomicamente.

A revisão completa também corrigiu uma inicialização do recovery de cobranças:
`next_run_at` com precisão de milissegundos podia arredondar `now()` para além do
`now()` estável da mesma transação. O INSERT inicial passa a truncar milissegundos,
sem alterar valores, períodos, direitos, retries ou idempotência de pagamentos.
O cenário de recuperar webhook perdido na primeira descoberta voltou a passar.

Sem dependência/env nova ou alteração de frontend/mobile. A API conserva seus
DTOs, guards e seleções anteriores. As FKs complementares são SQL versionado,
não uma troca automática de relações do cliente Prisma.

## Validação

- **272 suítes / 2.275 testes unitários aprovados**, incluindo reprodução exata
  da migration a partir do manifesto e cobertura do inventário.
- **51 suítes / 657 testes E2E aprovados**, com todas as 123 migrations em
  PostgreSQL descartável, 149 tabelas provisionadas sob `orbit_app` sem
  SUPERUSER/BYPASSRLS. As dez provas novas de integridade usam DML direto com
  contexto de runtime; também passaram os fluxos HTTP reais de todos os módulos.
- A prova A → cliente B é recusada por `23503`. Cobertos unidade divergente mesmo
  com ambas as unidades no contexto, equipamento de outro cliente, UUID estrangeiro
  em array, pai global/privado/ausente e SET NULL sem perder o tenant da linha.
- Upgrade sujo recusa antes do commit, preserva o registro conflitante e não deixa
  constraints parciais. Após correção explícita da fixture, o upgrade conserva os
  registros e passa. Esse ensaio usa somente banco descartável.
- Regressão de push agora mantém uma entrega pendente antes de trocar a conta no
  mesmo aparelho: preserva seu tenant original, termina como SKIPPED e não envia
  o conteúdo ao token da nova conta.
- Preflight compilado passou com **199 regras / zero conflitos**. Smoke adicional
  confirmou `scope_rpc=false`, `asset_rpc=false`, `ddl=false` no runtime e repetiu
  a aplicação em base vazia/provisionamento com o agrupamento atômico de grants.
- Build Nest, TypeScript completo, lint dos arquivos TypeScript alterados,
  fronteiras sincronizadas, 75 códigos públicos e diff sem erros aprovados.
  Runtime local Node **25.1.0**; nova imagem Node 22/Linux e gates consolidados do
  SHA final permanecem na CI/PR-19. Não houve build nativa/web ou push real novo.

A primeira execução completa encontrou cinco falhas: uploads concorrentes acima
limite numa fixture de PMOC; bootstrap do checkpoint de recovery por precisão de
timestamp; uma fixture de legado que escolhia arbitrariamente uma organização
STARTER com assinatura canônica; e duas fixtures de guards com tenant inexistente.
As reservas de mídia foram separadas da corrida de quatro finalizações (que
continua concorrente), o legado agora é construído sem assinatura e os guards
consultam um tenant ACTIVE real. Uma repetição unitária identificou listener
implícito intermitente no roteamento de operações; a fixture ganhou listener
local estável. Nenhuma permissão, quota, validação ou asserção de segurança foi
relaxada. As quatro suítes afetadas passaram 130 testes antes da repetição integral.

Operação, exceções deliberadas e limites do preflight:
[guia de integridade](../../backend/docs/relational-integrity.md).
Migration: `20261117100000_relational_tenant_integrity` — exige preflight, backup,
ensaio em cópia controlada e janela de gravações pausadas antes de aplicar no ambiente.
Nenhum desses passos foi executado em servidor real. A aprovação geral de produção
continua condicionada às demais PRs e aos aceites externos existentes.

Evidência estruturada: [PR-12](evidence/pr-12-relational-integrity.json).
