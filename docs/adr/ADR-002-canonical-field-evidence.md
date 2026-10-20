# ADR-002 — Pipeline canônico de evidência de campo

Status: accepted (PR-MB-05)

Operation, PMOC e RVT possuíam estruturas independentes de anexos. Manter três
pipelines duplicaria validação de MIME, autorização, idempotência, cleanup e
contratos mobile. Adotamos `FieldEvidenceUpload` + `FieldEvidence`, sempre sobre
`StorageFile`, para todo upload novo.

Não usamos `targetType + targetId` sem integridade. Existem três FKs explícitas
e um CHECK exige exatamente uma delas. O custo é acrescentar uma coluna ao
suportar um quarto target; aceitamos esse custo porque o conjunto é uma
allowlist de segurança, não uma extensão arbitrária.

Registros legados permanecem nas tabelas originais. Não há backfill de valores
que o histórico não conhece. Consumidores novos consultam o pipeline canônico;
uma migração futura só poderá promover legado quando Storage, hash e autoria
forem demonstráveis.
