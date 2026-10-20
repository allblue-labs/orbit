# Storage Provider & URLs assinadas

A infraestrutura de arquivos da plataforma.

---

## 1. A abstração

Toda a plataforma depende de **uma interface**:

```ts
interface StorageProvider {
  name: StorageProviderName;
  defaultBucket: string;
  put(input: PutObjectInput): Promise<ObjectStat>;
  get(ref: StorageObjectRef): Promise<Buffer>;
  head(ref: StorageObjectRef): Promise<ObjectStat | null>;
  remove(ref: StorageObjectRef): Promise<void>;
  sign(request: SignedUrlRequest): Promise<SignedUrl>;
}
```

A escolha do provider acontece em um único lugar — `storage.module.ts` — a
partir de `STORAGE_PROVIDER`. Nenhum módulo de domínio lê variável de ambiente,
conhece bucket ou importa uma classe concreta: recebe o token `STORAGE_PROVIDER`
por injeção.

| Provider     | Situação                                              |
| ------------ | ----------------------------------------------------- |
| `LOCAL`      | implementado; padrão de desenvolvimento               |
| `S3`         | implementado (SigV4)                                  |
| `MINIO`      | implementado — mesma classe do S3, protocolo idêntico |
| `AZURE_BLOB` | **não implementado**; recusado na configuração        |
| `GCS`        | **não implementado**; recusado na configuração        |

Azure e GCS constam do contrato e a configuração os **recusa explicitamente**
em vez de fingir suporte. Ambos assinam URL por mecanismo próprio (SAS e V4
signed URL) — é por isso que assinar é operação do provider, e não uma função
utilitária compartilhada. Implementá-los é escrever uma classe.

## 2. Por que a assinatura é a operação central

Um documento emitido pode ter dezenas de megabytes. Fazer o binário passar pela
API em toda leitura transformaria o Orbit em proxy de arquivos: banda dobrada,
memória do processo presa, nenhum ganho.

As URLs assinadas deixam o transporte acontecer **direto entre cliente e object
store**, com prazo curto e escopo de um único objeto. O backend continua sendo
o único a decidir **se** aquele acesso pode acontecer — a URL só é emitida
depois de RLS, capability e permissão.

```
cliente ──pede acesso──▶ API ──autoriza──▶ assina ──▶ devolve URL
   │                                                      │
   └──────────────── transfere direto ◀───────────────────┘
                      (object store)
```

## 3. S3 Compatible sem SDK

A implementação assina SigV4 com `node:crypto` — quatro HMAC-SHA256 encadeados,
cerca de 60 linhas. Trazer o SDK da AWS acrescentaria dezenas de megabytes de
dependência para reimplementar isso, e ainda exigiria adaptação para MinIO.

Transferências do lado do servidor usam `fetch` sobre a **mesma URL assinada
que o cliente usaria**. Não existe caminho privilegiado paralelo: um erro de
política de bucket aparece no primeiro teste, não em produção.

### Verificado contra MinIO real

O teste unitário prova que o algoritmo produz o `canonical request` da
especificação. Isso não é o mesmo que provar que um servidor **aceita** a URL —
e foi o round-trip contra MinIO que revelou dois defeitos reais:

| Defeito                                                    | Sintoma | Correção                       |
| ---------------------------------------------------------- | ------- | ------------------------------ |
| cabeçalhos `x-amz-meta-*` enviados sem entrar na assinatura | **400** | não enviar; o metadado já vive em `storage_files` |
| assinar como `GET` e requisitar `HEAD`                     | **403** | assinar para o método que será usado |

O round-trip cobre: gravar, ler byte a byte, consultar metadados, objeto
inexistente, URL de download, URL de preview, URL de upload, assinatura
adulterada e assinatura expirada. Sem MinIO no ar, a suíte é **pulada**, não
quebrada — o build não depende de infraestrutura externa.

```bash
docker run -d --rm --name orbit-minio -p 9210:9000 \
  -e MINIO_ROOT_USER=orbitkey -e MINIO_ROOT_PASSWORD=orbitsecret123 \
  minio/minio server /data
docker run --rm --network host --entrypoint sh minio/mc -c \
  "mc alias set local http://localhost:9210 orbitkey orbitsecret123 && \
   mc mb --ignore-existing local/orbit-artifacts"
npm test -- minio-roundtrip
```

## 4. O provider local

Não há serviço externo para assinar. A URL aponta para a própria API, e o que a
torna assinada é um HMAC-SHA256 sobre `bucket|objectKey|operação|expiração`,
com segredo de servidor, conferido em tempo constante.

A propriedade é a mesma do S3: **quem tem a URL tem acesso àquele objeto, por
pouco tempo, e a nada mais**.

A rota que entrega o objeto é pública **porque ela é o object store**: a
autorização aconteceu quando a URL foi assinada. Exigir sessão ali quebraria o
propósito — um `<img>` ou uma aba nova não carregam cookie de outra origem — e
não acrescentaria segurança.

`objectKey` nunca é interpolado às cegas: o caminho resolvido precisa ficar
dentro da raiz configurada, e uma chave com `..` é recusada.

## 5. File Objects

Cada arquivo tem id, provider, bucket, objectKey, mimeType, tamanho, SHA-256,
metadata e `createdAt` — como pedido. O Read Model publica **tudo menos bucket
e objectKey**:

```ts
{ id, fileName, mimeType, sizeBytes, sha256, status, provider, metadata, createdAt }
```

Publicar o endereço interno daria ao cliente algo que muda ao trocar de
provider, que não é autorizável e que convida a tentar acesso direto ao object
store. Um teste serializa os Read Models e falha se o nome do bucket ou a chave
aparecerem.

### Chave do objeto

```
{organização}/{namespace}/{ano}/{mês}/{uuidv7}{extensão}
```

O nome original **não** entra: nome de cliente carrega acentuação, espaço,
caminho relativo e colisão. Ele é guardado no registro — que é onde serve, e é
o que a URL de download devolve ao navegador.

### Estados

`PENDING` → nada foi transferido ainda, sem hash. `AVAILABLE` → o servidor leu
o objeto e calculou o SHA-256 do que está lá. `MISSING` → a reserva expirou sem
upload. O banco recusa `AVAILABLE` sem hash por *check constraint*.

## 6. Fluxo de upload

```
1. domínio reserva  → StorageFile PENDING + URL de upload assinada
2. cliente envia    → direto para o object store
3. domínio confirma → servidor lê o objeto, calcula o hash, marca AVAILABLE
```

O hash **nunca** vem do cliente. Confiar no hash informado seria confiar no
cliente sobre o próprio conteúdo — e é o hash que prova o documento.

## 7. Configuração

| Variável                          | Padrão                        | Uso                       |
| --------------------------------- | ----------------------------- | ------------------------- |
| `STORAGE_PROVIDER`                | `LOCAL`                       | qual provider             |
| `STORAGE_BUCKET`                  | `orbit-artifacts`             | bucket padrão             |
| `STORAGE_SIGNED_URL_TTL_SECONDS`  | `300` (teto de 3600)          | validade das URLs         |
| `STORAGE_LOCAL_DIR`               | `storage/objects`             | raiz do provider local    |
| `STORAGE_LOCAL_PUBLIC_URL`        | `http://localhost:6001/api/v1`| base das URLs locais      |
| `STORAGE_LOCAL_SIGNING_SECRET`    | `JWT_ACCESS_SECRET`           | segredo da assinatura local |
| `STORAGE_S3_ENDPOINT`             | —                             | obrigatório em S3/MinIO   |
| `STORAGE_S3_REGION`               | `us-east-1`                   |                           |
| `STORAGE_S3_ACCESS_KEY_ID`        | —                             | obrigatório em S3/MinIO   |
| `STORAGE_S3_SECRET_ACCESS_KEY`    | —                             | obrigatório em S3/MinIO   |
| `STORAGE_S3_FORCE_PATH_STYLE`     | `true`                        | `false` para AWS S3       |

Configuração incompleta falha na **subida da aplicação**, não na primeira
requisição de arquivo.

## 8. Remoção é recusada de propósito

O provider S3 recusa `remove`. Apagar objeto é ciclo de vida do bucket, e um
documento emitido não deve desaparecer por ação da aplicação: o manifest revoga,
e o objeto permanece para auditoria. Uma política de retenção é decisão de
infraestrutura, não de código de domínio.

## 9. Anexos de execução (Stage 7)

**Nenhum contrato público mudou.** `POST /artifact-executions/:id/attachments`
recebe os mesmos campos e o Read Model do anexo continua publicando
`storageKey`. Web e Flutter não precisaram de uma linha.

O que mudou por baixo: o anexo passa a ter um `StorageFile` correspondente
quando a `storageKey` informada é a de um arquivo reservado.

### A lacuna que isso fechou

Até aqui o anexo era **só metadado**: o cliente informava `storageKey`,
`sizeBytes` e `checksum` de um arquivo que a plataforma nunca recebia. Não havia
caminho de upload — o registro apontava para um objeto que não existia.

Duas rotas **aditivas** fecham o ciclo:

```
POST /artifact-executions/:id/attachments/upload-url          → reserva + URL de upload
GET  /artifact-executions/:id/attachments/:id/download        → URL de download
```

Anexos anteriores à PR-19 têm `fileId` nulo. Pedir download deles devolve uma
recusa explicando que o registro antecede o storage gerenciado — melhor do que
uma URL que daria 404.
