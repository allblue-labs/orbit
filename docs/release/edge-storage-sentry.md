# Estáticos, armazenamento e Sentry

| Fluxo | Staging | Produção |
| --- | --- | --- |
| HTML, API e documentos privados | Origem, sem cache compartilhado | Origem ou URL assinada de curta duração, sem cache compartilhado |
| JavaScript, CSS, fontes e marcas do build | Next.js, com as regras de cache atuais | Cache Cloudflare → R2 `orbit-assets` no prefixo `_next/static/` → Next.js do mesmo build na falta do objeto |
| Avatares e logos enviados | Volume Docker local e URLs assinadas | R2 `orbit-assets` pelo domínio `cdn-orbit.allblue-labs.com` |
| Evidências, assinaturas e PDFs | Mesmo volume e URLs assinadas | R2 privado `orbit-assets-private` |
| Backup PostgreSQL | Sem rotina em R2 | R2 privado `orbit-production-backups`, separado da mídia |

## Seleção de ambiente

No servidor de produção, o Compose base com o lock fixa
`ORBIT_DEPLOYMENT=production` e `STORAGE_PROVIDER=R2` na API e nos dois
workers. O backend exige as credenciais do R2 e os buckets público e privado.
Em staging, o Compose padrão também carrega `docker-compose.staging.yml`.
O overlay fixa `ORBIT_DEPLOYMENT=staging` e `STORAGE_PROVIDER=LOCAL`,
limpa a configuração R2 e monta o volume `staging_media` nos três serviços.
O backend rejeita um provider de nuvem ou configuração R2 nesse ambiente.
Os dois ambientes rodam com `NODE_ENV=production`. O DNS aponta para o host,
e a configuração do Compose desse host seleciona o provider.

## Cloudflare em produção em `portal-orbit.com.br`

1. Na mesma conta Cloudflare que contém os buckets, adicione a zona `portal-orbit.com.br`. No registrador, configure os nameservers atribuídos pela Cloudflare. Quando a zona estiver ativa e o servidor dedicado estiver preparado, crie o registro **A** `@` com o IPv4 público desse servidor e proxy laranja. Publique **AAAA** somente se o servidor tiver IPv6 configurado e protegido. [Configuração de uma zona Cloudflare](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
2. Em **SSL/TLS**, use **Full (strict)** e instale na origem um certificado válido para `portal-orbit.com.br`. Restrinja 443 do servidor às faixas oficiais da Cloudflare e SSH à VPN ou aos IPs administrativos. Use o mesmo Nginx com correlação, limites na origem e portas Docker em loopback. [Preparação da origem de produção](production-deployment.md#nginx-e-tls-no-servidor-dedicado) · [Proteção da origem Cloudflare](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)
3. Na zona nova, publique o [bypass de cache e o rate limit do Orbit](hotpath-cloudflare.md#cloudflare) usando `portal-orbit.com.br` no filtro de host. As regras da zona `allblue-labs.com` seguem atendendo staging.

### Estáticos do build e buckets existentes

O publicador e o Worker usam o bucket público existente `orbit-assets`,
com as chaves do build sob `_next/static/`. Avatares e logos ficam nos
prefixos atuais. Em **Manage R2 API tokens**, use uma credencial exclusiva
do pipeline com acesso somente a `orbit-assets`. Para restringir também o
prefixo `_next/static/`, use uma credencial temporária com leitura e gravação
nesse caminho e passe o session token. O Worker lê pelo binding, e o código
valida o host e o caminho antes de acessar objetos. [Credenciais temporárias R2](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/) · [Binding R2 em Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/r2/)

```dotenv
ORBIT_STATIC_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
ORBIT_STATIC_R2_ACCESS_KEY_ID=
ORBIT_STATIC_R2_SECRET_ACCESS_KEY=
# Preencha somente ao usar uma credencial temporária.
ORBIT_STATIC_R2_SESSION_TOKEN=
```

Antes de promover um build, publique arquivos de seu digest de frontend. O script confere os hashes registrados no R2 e rejeita sobrescrita de uma chave imutável com conteúdo diferente. Preserve os arquivos de releases ainda elegíveis a rollback.

```bash
ORBIT_RELEASE_DEPLOYMENT=production ORBIT_BUILD_BACKUP_IMAGE=true \
  ORBIT_RELEASE_OUTPUT=/caminho/privado/orbit-release bash deploy/staging/bin/build-push.sh
npm ci --omit=dev --ignore-scripts --prefix backend/ops/backup-node
bash deploy/production/bin/publish-web-static.sh /caminho/privado/orbit-release/release.json
```

Em **Workers & Pages**, publique `deploy/production/cloudflare/wrangler.toml`.
Ele fixa `portal-orbit.com.br`, cria o binding `ORBIT_WEB_STATIC` para
`orbit-assets` e mantém `workers.dev` e preview URLs desativados. Use uma
conta com MFA e acesso limitado ao Worker e à zona de produção.

```bash
npx wrangler deploy --config deploy/production/cloudflare/wrangler.toml
```

Quando o hostname apontar para a origem de produção, abra **Workers & Pages → orbit-production-static → Settings → Domains & Routes → Add → Route**. Na zona `portal-orbit.com.br`, adicione `https://portal-orbit.com.br/_next/static/*`. [Rotas de Workers](https://developers.cloudflare.com/workers/configuration/routing/routes/) · [Cache do Worker](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)

Confirme por duas requisições GET ao mesmo chunk referenciado no HTML. A primeira responde `X-Orbit-Static-Source: r2` ou `edge`, e a segunda deve responder `edge` no mesmo ponto de presença. Compare o SHA-256 dos bytes com a imagem. Para validar o fallback sem editar o bucket ativo, use um chunk presente na imagem que ainda não tenha sido publicado na primeira ativação, ou faça o teste em um host de homologação isolado. O fallback retorna `X-Orbit-Static-Source: origin` e `Cache-Control: no-store`. Um caminho inexistente deve retornar 404. Após o ensaio, publique todos os chunks e repita os GETs. Confira que login, API e links assinados continuam fora da rota do Worker.

Os uploads de produção usam os [dois buckets atuais](../../backend/docs/cloudflare-r2.md).
`cdn-orbit.allblue-labs.com` continua atendendo avatares e logos. Configure
CORS com a origem `https://portal-orbit.com.br`. Para expurgo de mídia, o
token e o Zone ID correspondem à zona **allblue-labs.com**, que hospeda o CDN
de mídia. Mantenha `orbit-assets-private` sem domínio público e sem `r2.dev`.

## Backup diário

Use o [runbook de backup e restore](backup-restore.md#produção--backup-postgresql-em-r2). Ele inclui criação do bucket privado, credenciais distintas, expiração e instalação do timer no Ubuntu de produção. O dump inclui os localizadores e hashes de arquivos, e recuperar mídia exige os objetos correspondentes no storage. O build do frontend pode ser republicado a partir do digest registrado.

## Sentry por ambiente

O primeiro passo é [criar uma conta e uma organização no Sentry](https://sentry.io/signup/),
ou aceitar um convite de um administrador da organização que já exista.
Enquanto isso, deixe os DSNs vazios. O Orbit inicia com os logs estruturados
e mantém o envio ao Sentry desativado.

1. Em **Sentry → Settings → Projects**, crie `orbit-staging` e `orbit-production`. Use Node.js como plataforma inicial se o primeiro teste for da API. Associe cada projeto à equipe certa. Em **Settings → Client Keys (DSN)** de cada projeto, copie o DSN público `https://<chave>@<host-de-ingestão>/<id-do-projeto>`. O Sentry SaaS já fornece a resolução DNS desse host. [Como funciona o DSN](https://docs.sentry.io/concepts/key-terms/dsn-explainer/)
2. Em **Organization Settings**, exija MFA, desative a entrada livre em equipes e restrinja o projeto de produção a quem opera produção. Nas opções de privacidade, ative a remoção de IP e a filtragem de dados sensíveis. Separe as chaves cliente de navegador e mobile das de servidor caso habilite esses canais, e defina limites de ingestão nessas chaves. Tokens administrativos do Sentry ficam no cofre e nunca em um cliente. [Controles da organização](https://docs.sentry.io/api/organizations/update-an-organization/) · [Limite de ingestão por chave](https://docs.sentry.io/api/projects/create-a-new-client-key/)
3. No `.env` protegido de cada host, configure as variáveis abaixo. Em staging o arquivo está em `/opt/stacks/orbit/.env`. Gere `SENTRY_TENANT_HASH_KEY` com `openssl rand -hex 32` em cada ambiente. O backend envia o ID de organização pseudonimizado, o papel do processo e a correlação. A chave HMAC fica restrita à API e aos workers.

```dotenv
SENTRY_DSN=<dsn da API deste ambiente>
SENTRY_WEB_DSN=<dsn do servidor Next.js deste ambiente, opcional>
SENTRY_ENVIRONMENT=staging
SENTRY_TENANT_HASH_KEY=<64 caracteres hexadecimais gerados localmente>
```

Em produção use `SENTRY_ENVIRONMENT=production` e os DSNs de produção. Caso habilite telemetria cliente, passe `NEXT_PUBLIC_SENTRY_DSN` e `NEXT_PUBLIC_SENTRY_ENVIRONMENT` durante o build web e `ORBIT_SENTRY_DSN` e `ORBIT_SENTRY_ENVIRONMENT` durante o build Flutter. O DSN público permite ingestão. Ele deve ser tratado separadamente de credenciais de leitura e administração.

Aplique as variáveis recriando os containers e execute a [prova controlada do Sentry](operacao-etapa-04.md#evento-real-no-sentry) de dentro da API. Confira o evento no projeto e ambiente corretos, valide a redação dos dados e resolva a issue sintética. Repita em produção com uma correlação gerada para o teste e a asserção `SENTRY_ENVIRONMENT=production`. A prova usa o terminal do servidor.
