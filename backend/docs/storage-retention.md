# Retenção operacional e exclusão física — PR-13

A política é explícita: conservar acesso pelo período pago e, após expiração,
conservar os dados operacionais por 30 dias. Apenas assinaturas com
`data_retention_ends_at` vencido entram na rotina; não há exclusão retroativa por
idade de cadastro. Conta, consentimentos, antifraude e histórico financeiro têm
políticas próprias e permanecem fora desta exclusão.

## Fronteiras e estados

1. O worker consulta o estado remoto da assinatura e dos checkouts fora de
   transações. Estado desconhecido, compra concluída aguardando conciliação,
   assinatura recuperada e eventos financeiros pendentes/dead-letter impedem o
   purge. Checkout aberto deve ser expirado antes da exclusão.
2. Claim e commit usam o advisory lock da organização, também adotado pelas
   mutações canônicas de assinatura/conciliação. Revalidam prazo, acesso atual e
   intenções de pagamento. Uploads com lease ativa e renderizações em execução
   impedem a exclusão. O mesmo lock curto de admissão protege a transição:
   novos uploads são recusados após o claim, sem prender conexão durante I/O.
   Reativação/adiamento entre as fases aborta o claim.
3. `tenant_data_purges` registra `PREPARING`, `BLOCKED`, `ABORTED`, `FILES_PENDING`
   e `COMPLETE`. `organizations.data_purged_at` continua significando exclusão
   **no banco**. Não comprova que os objetos já foram removidos.
4. Inventário e exclusão operacional pertencem ao mesmo commit. A outbox inclui
   `storage_files`, fontes originais em metadata, anexos de operações,
   documentos gerados, documentos congelados de PMOC e anexos antigos de
   execução sem `file_id`. Anexos modernos usam o `file_id`, nunca seu UUID como
   uma chave de objeto. Soft deletes e reservas também entram no inventário.
5. Um único consumidor de outbox usa `FOR UPDATE SKIP LOCKED`, lease de cinco
   minutos e token por tentativa. I/O ocorre fora da transação. DELETE e HEAD
   têm deadline total de 45 segundos no adapter S3/R2/MinIO. ACK e retry são
   condicionados ao token. Resposta perdida/crash permite repetir DELETE;
   objeto ausente é sucesso. Falha mantém a única referência durável ao objeto.
6. A outbox preserva `origin_deleted_at`, `completed_at`, tentativas e código de
   falha; não é apagada no sucesso. Ownership conflitante ou provider diferente
   ficam `BLOCKED`; não se substitui automaticamente o provider pela configuração
   atual. R2/S3/MinIO compartilham o adapter oficial AWS; LOCAL é apenas dev/test.
7. O purge só chega a `COMPLETE` quando todos os jobs confirmam ausência na origem
   e, para o bucket público R2, a Cloudflare aceita o purge do cache. O campo
   `object_count` conta locators únicos da outbox; aliases podem representar o
   mesmo objeto físico. Backups e
   cópias externas possuem política independente, descrita abaixo.

`JOBS_WORKER_ENABLED=false` desliga os timers de retenção e limpeza. É possível
executar os serviços explicitamente em testes/rotinas controladas. O shutdown
aguarda o processamento ativo; não inicia outro lote. Cada drain processa até
25 objetos. Providers antigos indisponíveis nunca são considerados removidos.

## Pré-implantação e legado

A migration `20261117130000_storage_retention_lifecycle` é aditiva. Não move nem
apaga mídia. Acrescenta localização nullable aos quatro formatos legados e
sincroniza a allowlist SQL com a política operacional (incluindo admissões de
upload, aceite de orçamento e agendamento de equipamentos PMOC).

Uploads/documentos novos gravam provider e bucket no momento da escrita.
Registros anteriores sem localização comprovada bloqueiam o purge antes de
apagar dados. Não preencher esses campos cegamente com o provider de hoje.

Com credenciais administrativas fornecidas **somente ao processo operacional**
e as configurações do provider correto no ambiente, executar após build/migration:

```sh
npm run storage:retention:check -- --organization=UUID_DA_ORGANIZACAO
```

O comando não carrega `.env` automaticamente. A saída padrão contém contagens e
estados, sem conteúdo, nomes de clientes, URLs assinadas ou credenciais. Código
0: inspeção concluída; 2: localização desconhecida/provider diferente/falha de
inspeção ou objeto marcado concluído ainda presente; 1: configuração/execução
inválida. Ausência isolada é contabilizada separadamente: reservas podem nunca
ter recebido bytes. Resultado 0 não certifica credenciais do CDN ou backups.

Para um legado comprovadamente no provider configurado, a opção explícita
abaixo **só altera metadados de localização**, após HEAD indicando até 50 MiB,
download e SHA-256 igual ao registro. Não exclui nem sobrescreve arquivos, não
certifica objetos ausentes ou sem hash, não altera provider já registrado:

```sh
npm run storage:retention:check -- --organization=UUID_DA_ORGANIZACAO \
  --attest --legacy-provider=R2 --legacy-bucket=orbit-assets-private
```

Para LOCAL usar a raiz original e `--legacy-provider=LOCAL`; a produção recusa
LOCAL. Quando houver migração real entre providers, usar o procedimento de
[migração R2](cloudflare-r2.md), que verifica os bytes de destino antes de mudar
referências. O script de migração agora também grava a proveniência legada.
Jobs de providers antigos exigem reconciliação individual da localização; não
alterar seus providers em massa para fazer a fila avançar.

O scanner opcional lista um prefixo de um tenant, até 10 mil objetos, sem apagar
candidatos a órfãos. São candidatos, não prova de ausência de referência em
snapshots/backups/integrações. Não existe comando automático para apagá-los:

```sh
npm run storage:retention:check -- --organization=UUID_DA_ORGANIZACAO \
  --scan-bucket=orbit-assets-private --scan-prefix=field-evidence/UUID_DA_ORGANIZACAO/
```

Executar o preflight antes e depois da retenção. Após o commit no banco, ele
continua verificando HEAD pelas referências preservadas na outbox. Comparar
inventário anterior, quantidade do purge e estados/ausência dos jobs. Exportações
operacionais e logs devem ficar protegidos, fora do Git.

## CDN público

Configurar no processo API/worker:

- `CLOUDFLARE_CACHE_PURGE_ZONE_ID`: Zone ID da zona que atende o custom domain R2.
- `CLOUDFLARE_CACHE_PURGE_TOKEN`: API token com **Zone / Cache Purge**, limitado
  somente àquela zona. É separado do token de objetos R2.

Sem esses valores, um objeto público removido da origem fica com job
`BLOCKED / CACHE_PURGE_NOT_CONFIGURED`; falha da API produz retry. Nunca se chama
`purge_everything`. A requisição envia uma URL codificada e usa exclusivamente
`https://api.cloudflare.com`, transporte SSRF protegido da PR-11, sem redirects,
com deadline de 15 s. A API exige HTTP 200 e `success:true`.

Referência: [Cloudflare — purge cached content](https://developers.cloudflare.com/api/resources/cache/methods/purge/).
Essa confirmação é aceite do provider; validar a URL externamente no rollout.
Manter cache key padrão do CDN, sem variações por headers/query que demandem
outras chaves de purge. Buckets privados devem continuar sem domínio público,
com URLs assinadas curtas e `private, no-store`.

## Backups, versões e restore

`deploy/staging/bin/backup.sh` conserva snapshots locais por 14 dias e mantém
um último backup completo. Portanto a exclusão da base ativa aos 30 dias não
promete remoção imediata de cópias isoladas anteriores. Os snapshots devem
permanecer restritos, criptografados fora do host e expirar pela política
publicada. R2 não está no SSD; backup/versionamento externo do bucket precisa
ter expiração própria compatível, sem retenção infinita de objetos excluídos.
DELETE do adapter remove a chave corrente; versões históricas/delete markers
de S3 com versionamento ou Object Lock exigem política lifecycle e verificação
específicas do operador antes de considerar a infraestrutura qualificada.

O backup passa a exportar `retention-ledger.jsonl` (purges com banco excluído e
locators da outbox), além de `retention-ledger-latest.jsonl` separado dos
snapshots antigos. O arquivo usa umask 077 e entra no checksum do snapshot.
Copiar o ledger mais recente para armazenamento protegido independente do host;
o export diário local não é um arquivo externo imutável nem garantia contra
perda do SSD. Nunca restaurar apenas um dump antigo e reabrir a aplicação.

Restore deve ocorrer com API/workers desligados em rede isolada: migrar schema,
obter o ledger mais recente de fonte independente, excluir do restore os dados
operacionais que já haviam sido removidos após a data daquele snapshot e não
republicar objetos dessas organizações. Reconciliar billing e novas contratações
separadamente; uma assinatura reativada não autoriza ressuscitar dados já
excluídos. Confirmar ausência por provider/CDN e só então liberar acesso.
O ensaio completo de restore e a comprovação da cópia externa são gates da
PR-19. Este PR não executa purge, backup, restore ou migração em produção.
