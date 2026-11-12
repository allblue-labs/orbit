# Mídia do Orbit no Cloudflare R2

A API usa o SDK AWS v3 com `region: auto`, credenciais explícitas de ambiente e
endpoint da conta R2. Não há fallback de gravação local em produção. Os três
caminhos anteriores (storage_files, anexos de operação e PDFs gerados) agora usam
object storage. O Flutter usa Dio; não há dependência de React Native/Expo.

## Configuração

Copie as chaves de `.env.example` para o ambiente do backend:

```dotenv
STORAGE_PROVIDER=R2
R2_ACCOUNT_ID=<32 caracteres hexadecimais da conta Cloudflare>
R2_ACCESS_KEY_ID=<Access Key ID do token S3 R2>
R2_SECRET_ACCESS_KEY=<Secret Access Key do token S3 R2>
R2_BUCKET_NAME=orbit-assets
R2_PRIVATE_BUCKET_NAME=orbit-assets-private
R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://cdn-orbit.allblue-labs.com
STORAGE_PUBLIC_API_URL=https://orbit.allblue-labs.com/api/v1
STORAGE_SIGNED_URL_TTL_SECONDS=300
# Se existirem referências antigas em snapshots imutáveis:
R2_LEGACY_PRIVATE_BUCKETS=orbit-artifacts,documents
```

A chave precisa de **Object Read & Write** nos dois buckets, não de permissão de
administração da conta. Restrinja seu uso a esse ambiente. Não use chaves SES no
R2, não versione JSON de credenciais e não configure segredos no Next/Flutter.

- `orbit-assets`: somente avatares/logos. Configure **Custom Domains** com
  `cdn-orbit.allblue-labs.com` e aguarde o status **Active**. `r2.dev` pode e deve
  continuar desativado: ele é independente do domínio personalizado.
- `orbit-assets-private`: evidências, assinaturas, anexos e PDFs. Não configure
  domínio público nem habilite `r2.dev`. Downloads usam URLs temporárias do
  endpoint S3, autorizadas após RLS/permissões. Não reescreva o host dessas URLs.

A configuração recusa credenciais ausentes, endpoint de outra conta, domínio
público sem HTTPS, nomes de bucket inválidos e buckets público/privado iguais.
Não inclua caminho de API nem bucket em `R2_PUBLIC_URL`.

Para downloads e compartilhamento pelo navegador, configure nos buckets a CORS
adequada à origem real (os uploads passam pela API e não precisam de PUT no R2):

```json
[
  {
    "AllowedOrigins": ["https://orbit.allblue-labs.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "Content-Type"],
    "ExposeHeaders": ["Content-Length", "Content-Disposition", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Upload e otimização

A reserva continua respondendo `{fileId, upload:{url,method,requiredHeaders}}`,
com PUT. O novo cabeçalho `x-orbit-upload-mode: multipart` informa aos clientes
que devem enviar `FormData`, campo `file`, incluindo nome e MIME. O navegador
escolhe o boundary; Dio usa `MultipartFile`. Clientes mobile já instalados que
mandam bytes crus continuam compatíveis, com leitura limitada em memória.

O gateway valida a capacidade assinada **antes** do Multer e verifica no banco a
organização, reserva pendente, tamanho e MIME declarados. Não concede perfil de
administrador à requisição. JPEG, PNG, WebP e HEIC são decodificados, limitados a
10 MB/40 megapixels, orientados e convertidos para WebP, qualidade 80. O maior
lado é limitado a 1920 px (512 px para avatar/logo), sem ampliar. EXIF/GPS são
removidos. HEIC usa libheif WASM em worker com timeout; até duas imagens são
processadas simultaneamente, com fila limitada. PDFs continuam como PDFs.

A chave final é `entidade/organizationId/timestamp-uuid.webp`; o nome enviado não
participa da chave. O bucket público recebe cache de um ano e `immutable`; o
privado usa `private, no-store`. A confirmação grava juntos a chave, MIME,
tamanho e SHA-256 do resultado. O hash/tamanho original ficam nos metadados do
servidor, permitindo validar a fila offline sem confundir os bytes otimizados.
Uma troca condicional consome a reserva: repetir bytes idênticos confirma o envio
anterior; conteúdo diferente é recusado, sem sobrescrever o objeto.

A API retorna URLs absolutas. Avatares/logos usam o CDN; o campo de validade do
avatar conserva compatibilidade com clientes antigos. Evidências e documentos
mantêm a expiração real. Para PDFKit, imagens WebP são convertidas em PNG apenas
em memória durante a renderização, sem alterar o arquivo/hash armazenado.

Trocas de avatar/logo removem o objeto anterior. Falhas de exclusão entram numa
fila durável com tentativas e recuo; o worker não mantém transação SQL aberta
durante chamadas ao R2. Assinaturas versionadas e arquivos de documentos emitidos
permanecem para integridade/auditoria até o fluxo de retenção aplicável. A remoção
de objeto não invalida cópias já armazenadas no cache público da Cloudflare:
quando isso for necessário, faça também purge da URL no painel Cloudflare.

## Migração de instalação existente

**Não basta trocar o provider no `.env`.** Faça backup, pause API/consumidores e
preserve os volumes antigos. Use imagens da mesma release para migrator e API.
O novo Compose não monta volumes de mídia na API; os antigos permanecem declarados
para a ferramenta de migração, nunca são removidos automaticamente.

No servidor, com `.env`, `docker-compose.yml`, lock da nova release e o override
de migração disponíveis:

```bash
# Use os mesmos arquivos/projeto Compose do deploy atual.
docker compose -f docker-compose.yml -f docker-compose.lock.yml stop api
# Atualiza schema/grants, incluindo o provider R2 e a fila de limpeza.
docker compose -f docker-compose.yml -f docker-compose.lock.yml run --rm migrate
# Inspeção: lê originais e confere hashes; não envia nem altera dados.
docker compose -f docker-compose.yml -f docker-compose.storage-migration.yml \
  -f docker-compose.lock.yml --profile storage-migration \
  run --rm storage-migration
# Aplicação offline: copia, relê do R2, confere SHA-256 e só então troca referências.
STORAGE_MIGRATION_OFFLINE=true docker compose \
  -f docker-compose.yml -f docker-compose.storage-migration.yml \
  -f docker-compose.lock.yml --profile storage-migration \
  run --rm storage-migration --apply
```

No staging já preparado, atualize também o script de backup instalado **após**
validar a migração e antes de subir a API nova. Transfira a versão atual de
`deploy/staging/bin/backup.sh` para `~/orbit-bootstrap/bin/backup.sh` e execute:

```bash
sudo install -m 0750 ~/orbit-bootstrap/bin/backup.sh /usr/local/sbin/orbit-backup
```

A versão antiga tenta copiar diretórios locais que não existem na imagem nova.
O timer existente continua válido. Teste um backup do banco e o backup separado
dos buckets depois do rollout.

O lock deve ser o último arquivo do Compose, para que a ferramenta use o mesmo
digest do migrator da release, sem herdar uma tag antiga de `ORBIT_VERSION`.

A ferramenta usa a credencial administrativa **somente no container efêmero de
migração**. Monta os volumes originais em `/legacy/{objects,operations,documents}`
como somente leitura. Rodando fora do Docker, configure `LEGACY_STORAGE_ROOT`
para uma pasta com esses três diretórios. Reexecutar é seguro: uploads usam
chaves existentes/determinísticas e não há exclusão das fontes.

Imagens/documentos antigos são copiados sem recompressão, preservando hashes e
assinaturas. Novos uploads passam pela otimização. Logos em data URI são
convertidos em WebP e registrados no storage. Aliases de bucket permitem ler
referências antigas dentro de snapshots sem alterar conteúdo assinado. Inclua
em `R2_LEGACY_PRIVATE_BUCKETS` qualquer nome legado adicional utilizado.

Reservas antigas ainda pendentes não são migradas como arquivos disponíveis:
aguarde as filas ou recapture/reenvie esses anexos após o rollout. Qualquer
original ausente/hash divergente interrompe o processo, sem remover a fonte.
Valide os relatórios antigos, fotos, assinaturas e a fila mobile antes de iniciar
a API nova. Preserve também a cópia do banco anterior para rollback; o aplicativo
antigo não entende referências R2. Só remova volumes/backups locais após aceite
da migração e um backup independente dos buckets.

O backup diário do servidor passa a copiar somente o banco e os manifestos de
deploy. R2 não substitui backup: configure cópia independente/versionada dos
buckets, retenção e teste de restauração. Não coloque expiração global de 30 dias
no bucket: ela apagaria objetos ativos. Os 30 dias de cancelamento pertencem ao
fluxo de retenção do SaaS.

## Referências

- [AWS SDK v3 no R2](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Domínios públicos e independência do r2.dev](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [URLs assinadas: endpoint S3, sem custom domain](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Formatos e pré-requisitos HEIC do Sharp](https://sharp.pixelplumbing.com/api-output/)
