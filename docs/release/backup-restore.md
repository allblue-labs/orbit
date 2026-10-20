# Backup and restore

Banco e storage formam uma unidade lógica. O banco guarda manifests, hashes e
storage keys; restaurar apenas um lado pode produzir documentos irrecuperáveis.

## Backup do banco

1. registre SHA da aplicação, migration atual e timestamp UTC;
2. use `pg_dump` em formato custom com credencial de backup read-only quando
   disponível;
3. criptografe o arquivo fora do host da aplicação;
4. gere SHA-256 e aplique retenção/controle de acesso;
5. para RPO menor, preserve WAL/PITR conforme a plataforma.

O backup nunca deve ser enviado ao repositório nem usado em testes se dados
sanitizados forem suficientes.

## Backup do storage

Inclua `operation_attachments`, `generated_documents` e `artifact_objects` (ou
os buckets equivalentes). Preserve versionamento do objeto, metadata, hash e o
mesmo ponto temporal do banco. URLs assinadas não são material de backup.

## Teste de restore obrigatório

1. crie destino isolado e confirme que não é produção;
2. restaure o dump e os objetos selecionados;
3. aplique migrations somente se o teste pretende validar upgrade;
4. reconcilie o papel `orbit_app`;
5. confirme zero pending migrations e RLS/role audit;
6. compare contagens tenant-safe e hashes de uma amostra de artifacts;
7. abra documentos, evidence metadata, PMOC/RVT/OS e pacote offline;
8. rode E2E de isolamento e smoke funcional;
9. registre duração, RPO/RTO observado e resultado;
10. remova o ambiente somente após validar precisamente o alvo.

## Critério de sucesso

Restore só é válido quando aplicação e banco sobem com papel restrito, objetos
amostrados conferem por hash, nenhuma leitura cross-tenant ocorre e jobs não
reaplicam efeitos históricos. Uma execução documentada por release é o mínimo;
runbook sem exercício não fecha o gate.

