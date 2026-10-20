# Rollback runbook

## Regra

Faça rollback da aplicação primeiro. Migrations são forward-only; não reverta
DDL automaticamente e nunca execute `migrate reset` em ambiente persistente.

## Aplicação

1. Congele novos deploys e registre versão, SHA, digest e horário do incidente.
2. Se necessário, pause workers antes dos HTTP writers.
3. Reimplante os digests imutáveis da última versão conhecida como saudável.
4. Confirme `/health/live`, `/health/ready`, login, RLS e os fluxos afetados.
5. Mantenha a base no schema novo quando ele for backward-compatible.

## Banco

Rollback de banco exige decisão do incident commander e DBA:

1. pare todos os writers;
2. preserve backup atual, WAL e logs redigidos;
3. prove que a aplicação anterior não suporta o schema novo;
4. escolha migration corretiva forward ou restore completo;
5. faça restore em ambiente isolado e valide antes do cutover;
6. reconcilie storage e filas pelo mesmo ponto temporal.

Não existe rollback parcial de uma tabela tenant-owned. Um restore sem os
objetos correspondentes pode deixar manifests/documentos apontando para bytes
inexistentes.

## Critérios de saída

- papel runtime permanece `NOSUPERUSER/NOBYPASSRLS`;
- migrations têm estado conhecido;
- E2E de tenant isolation passa;
- jobs/webhooks não duplicam efeitos;
- hashes de artifacts/storage conferem;
- a causa e os dados potencialmente afetados estão registrados.

