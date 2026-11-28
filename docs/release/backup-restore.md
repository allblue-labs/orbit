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


## Produção — backup PostgreSQL em R2

A rotina de backup R2 é exclusiva de produção. Staging qualifica migrations
e RLS com snapshot sanitizado em ambiente descartável.

### Cloudflare

Em R2 → Object Storage, crie `orbit-production-backups` como bucket privado.
Mantenha desativados `r2.dev` e domínios personalizados. Em Settings →
Object Lifecycle Rules, publique expiração de 30 dias para `daily/` e de
90 dias para `weekly/`. Crie um token Object Read & Write restrito ao
bucket e um token Object Read only para os ensaios de restore.
Guarde as chaves no cofre. [Política de ciclo de vida do R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

### Instalação no host de produção

1. Gere a imagem `backup` com `ORBIT_RELEASE_DEPLOYMENT=production` e
   `ORBIT_BUILD_BACKUP_IMAGE=true` e confira
   seu digest em `release.json`. Disponibilize `docker-compose.backup.yml`
   junto ao Compose e lock da release.
2. Configure `BACKUP_DATABASE_PASSWORD` no `.env` do Compose e execute o
   migrador para provisionar `orbit_backup`. Use uma senha aleatória
   hexadecimal própria. O papel lê o banco completo com `BYPASSRLS`,
   sem permissões de escrita. API, consumers e PgBouncer usam suas próprias
   credenciais.
3. Instale `/etc/orbit/backup.env` e `/etc/orbit/backup-restore.env` com
   permissão 600 e credenciais distintas, conforme
   `deploy/production/backup.env.example`. Disponibilize a chave age em
   `/etc/orbit/backup-passphrase` com permissão 0400 e proprietário UID 1001
   dentro de um diretório privado. Custodie a mesma chave em cofre fora do host.
4. Crie `/var/lib/orbit-backup/scratch` com permissão 0700 e dono 1001:1001.
   O diretório contém apenas artefatos cifrados durante uma execução.
   Reserve espaço para o maior dump cifrado e limite acesso ao Docker.
5. Instale os scripts de `deploy/production/bin` como
   `/usr/local/sbin/orbit-backup` e
   `/usr/local/sbin/orbit-verify-backup-restore`. Instale as unidades de
   `deploy/production/systemd`. Execute os dois scripts uma vez, verifique os
   eventos `orbit_backup_complete` e `orbit_backup_restore_verified` e
   só então habilite `orbit-backup.timer` e
   `orbit-verify-backup-restore.timer`.

```bash
sudo install -d -m 0700 /etc/orbit
sudo install -d -o 1001 -g 1001 -m 0700 /var/lib/orbit-backup/scratch
sudo install -m 0750 deploy/production/bin/backup.sh /usr/local/sbin/orbit-backup
sudo install -m 0750 deploy/production/bin/verify-backup-restore /usr/local/sbin/orbit-verify-backup-restore
sudo install -m 0644 deploy/production/systemd/orbit-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start orbit-backup.service
sudo journalctl -u orbit-backup.service -n 20 --no-pager
sudo systemctl start orbit-verify-backup-restore.service
sudo journalctl -u orbit-verify-backup-restore.service -n 20 --no-pager
sudo systemctl enable --now orbit-backup.timer orbit-verify-backup-restore.timer
systemctl list-timers 'orbit-*'
```

O timer dispara às 03:15 UTC, com até cinco minutos de atraso aleatório
(00:15 a 00:20 em Recife). O script exige um manifesto de produção e um
contêiner Orbit identificado como produção. Use a credencial de restore
somente no ensaio e mantenha o acesso ao Docker restrito aos operadores
autorizados. [Tokens R2 por bucket](https://developers.cloudflare.com/r2/api/tokens/)

O dump, metadados e ledger cifrados usam o mesmo snapshot PostgreSQL.
Um prefixo só é elegível a restore quando `complete.json` existe e os
tamanhos e SHA-256 conferem. Domingo o backup usa o prefixo semanal.
A verificação semanal restaura no PostgreSQL em tmpfs, sem serviços de produto
e sem tráfego de clientes. Ajuste `ORBIT_RESTORE_TMPFS_SIZE` à capacidade
do host de recuperação. Para uma base maior que a RAM, use um host dedicado
com volume efêmero criptografado aprovado para a recuperação.

### Incidente e critérios de liberação

**Meta inicial** de RPO de 24 horas. Investigue atraso quando o último
`orbit_backup_complete` ultrapassar esse intervalo. **Meta de RTO do
banco** de 2 horas. Registre a duração observada do restore e meça o RTO
completo com a amostra de objetos R2.

1. Escolha o último ponto íntegro anterior ao incidente. Preserve os originais.
2. Execute o restore em destino isolado. Compare o schema, migrations,
   contagens, permissões, RLS e integridade referencial com o manifesto.
3. Compare o ledger de exclusão do ponto restaurado com o ledger verificado
   mais recente. Reaplique as exclusões por retenção posteriores ao ponto
   escolhido antes de publicar o destino. Periodicidade e retenção dos
   backups seguem a política de dados da produção.
4. Verifique a presença e o hash da amostra de mídia no backup de objetos.
   O dump guarda referências e hashes. Recupere o conteúdo pelo procedimento
   de storage correspondente.
5. Faça smoke web e mobile, teste leitura entre organizações e confira a
   reconciliação de filas e outboxes antes de reativar os consumers.
