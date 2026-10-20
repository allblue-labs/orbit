# PR-36 validation checkpoint — 2026-09-15

Este documento registra o último ponto verificável do release gate. Ele não
substitui o checklist e não promove uma execução parcial a sucesso.

## Source

- branch: `feat/features-and-backlogs`;
- baseline: `071f66762188e5dd721f85c95028a3d48f4c79d2`;
- subject: `assinatura vencida deixa ler, e a autorizacao de atendimento passa a existir`;
- nenhuma alteração preexistente do owner foi resetada;
- os dois testes Flutter modificados no checkpoint são somente o resultado de
  `dart format` sobre arquivos adicionados pelo owner.

## Correções do checkpoint

- `seed:owner` continua manual, mas agora reconcilia os dados estruturais que o
  cadastro real cria: papéis de campo, superfícies permitidas, cadências RVT e
  perfil profissional da conta interna de referência;
- Configurações > Agenda mostra um único CTA no estado vazio;
- a medição E2E do Centro de Documentos funciona com lista preenchida ou vazia;
- dois testes Flutter novos foram formatados sem alterar a intenção.

## Evidência concluída

- backend unit: 118 suites, 721 testes;
- frontend unit: 23 arquivos, 198 testes;
- mobile: 995 testes;
- lint/typecheck/build de backend e frontend verdes no baseline;
- Flutter analyze e format verdes;
- migrations fresh: 64/64, zero pending;
- PostgreSQL fresh: 118 tabelas, 108 com `ENABLE/FORCE RLS`;
- runtime `orbit_app`: `NOSUPERUSER`, `NOBYPASSRLS`, sem ownership de relações;
- 16 funções `SECURITY DEFINER`, todas com `search_path` fixo e nenhuma com
  `PUBLIC EXECUTE`;
- backup/restore do banco validado, com 118 tabelas, 5 planos e 64 migrations
  iguais na origem e no restore;
- E2E sobre o banco restaurado: 2 suites, 26 testes;
- navegador focal das correções: 19/19;
- backend e frontend production dependency audits: zero vulnerabilidades;
- build temporário Web: 30 rotas, usuário `nextjs`, sem privilégios adicionais.

## Evidência parcial ou anterior ao baseline final

- uma rodada Web em banco vazio mostrou 120 aprovados, 40 falhas por estado de
  partida ausente, 1 pulado e 27 não executados; ela motivou as correções de
  bootstrap e documentou o acoplamento das fixtures legadas;
- a primeira rodada Web no tenant E2E provisionado foi interrompida a pedido do
  owner com 108 aprovados, zero falhas, 1 interrompido e 79 não executados;
- três rodadas backend anteriores passaram 32 suites/384 testes, mas pertencem
  ao checkpoint `bbb8896`, não ao HEAD acima;
- Android AAB e iOS sem code signing foram construídos no checkpoint anterior,
  também não no commit final.

## Decisão

Pelos critérios estritos do prompt, o estado é:

`PR-36 OPEN / ORBIT V2 V1 RELEASE CANDIDATE NOT READY`

O motivo é exclusivamente evidência obrigatória ainda não concluída no commit
final: Web E2E completo duas vezes, backend global três vezes, artefatos finais,
SBOM/CVE final e restore conjunto do storage. Não há autorização para chamar
esses gates de verdes depois que sua execução foi encerrada.
