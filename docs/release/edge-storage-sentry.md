# Estáticos, armazenamento e Sentry

| Fluxo | Staging | Produção |
| --- | --- | --- |
| HTML, API e documentos privados | Origem, sem cache compartilhado | Origem ou URL assinada de curta duração, sem cache compartilhado |
| JavaScript, CSS, fontes e marcas do build | Next.js, com as regras de cache atuais | Cache Cloudflare → R2 privado → Next.js do mesmo build na falta do objeto |
| Avatares e logos enviados | Volume Docker local e URLs assinadas | R2 `orbit-assets` pelo domínio `cdn-orbit.allblue-labs.com` |
| Evidências, assinaturas e PDFs | Mesmo volume e URLs assinadas | R2 privado `orbit-assets-private` |
| Backup PostgreSQL | Sem rotina em R2 | R2 privado `orbit-production-backups`, separado da mídia |

## Cloudflare em produção

Em **R2 Object Storage**, crie `orbit-web-static` e mantenha `r2.dev` e domínios personalizados desativados. Em **Manage R2 API tokens**, crie um token **Object Read & Write** restrito a esse bucket para a máquina de release. Guarde o trio abaixo no cofre do pipeline. O Worker recebe acesso mediante binding do bucket. A aplicação e o Nginx continuam sem as chaves desse bucket. [Credenciais R2](https://developers.cloudflare.com/r2/api/tokens/) · [Binding R2 em Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/r2/)

```dotenv
ORBIT_STATIC_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
ORBIT_STATIC_R2_ACCESS_KEY_ID=
ORBIT_STATIC_R2_SECRET_ACCESS_KEY=
```

Antes de promover um build, publique arquivos de seu digest de frontend. O script confere os hashes registrados no R2 e rejeita sobrescrita de uma chave imutável com conteúdo diferente. Preserve os arquivos de releases ainda elegíveis a rollback.

```bash
ORBIT_RELEASE_DEPLOYMENT=production ORBIT_BUILD_BACKUP_IMAGE=true \
  ORBIT_RELEASE_OUTPUT=/caminho/privado/orbit-release bash deploy/staging/bin/build-push.sh
npm ci --omit=dev --ignore-scripts --prefix backend/ops/backup-node
bash deploy/production/bin/publish-web-static.sh /caminho/privado/orbit-release/release.json
```

Em **Workers & Pages**, publique `deploy/production/cloudflare/wrangler.toml`. O valor `ORBIT_PRODUCTION_HOST` deve ser o hostname efetivo de produção. Use uma conta Cloudflare com MFA e acesso ao Worker e à zona, limitado às permissões necessárias. Mantenha `workers.dev` e preview URLs desativados. O arquivo de configuração cria o binding `ORBIT_WEB_STATIC` e deixa a rota pendente para permitir publicar com segurança enquanto o domínio ainda estiver em staging.

```bash
npx wrangler deploy --config deploy/production/cloudflare/wrangler.toml
```

Somente quando o hostname apontar para produção, abra **Workers & Pages → orbit-production-static → Settings → Domains & Routes → Add → Route** na zona `allblue-labs.com`. Adicione `https://orbit.allblue-labs.com/_next/static/*` se esse continuar sendo o endereço de produção. O DNS existente permanece com proxy ativo e TLS **Full (strict)**. Preserve o bypass de cache de HTML e API. [Rotas de Workers](https://developers.cloudflare.com/workers/configuration/routing/routes/) · [Cache do Worker](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)

Confirme por duas requisições GET ao mesmo chunk referenciado no HTML. A primeira responde `X-Orbit-Static-Source: r2` ou `edge`, e a segunda deve responder `edge` no mesmo ponto de presença. Compare o SHA-256 dos bytes com a imagem. Para validar o fallback sem editar o bucket ativo, use um chunk presente na imagem que ainda não tenha sido publicado na primeira ativação, ou faça o teste em um host de homologação isolado. O fallback retorna `X-Orbit-Static-Source: origin` e `Cache-Control: no-store`. Um caminho inexistente deve retornar 404. Após o ensaio, publique todos os chunks e repita os GETs. Confira que login, API e links assinados continuam fora da rota do Worker.

Os uploads de mídia de produção continuam usando os dois buckets de [mídia Orbit](../../backend/docs/cloudflare-r2.md). Use credenciais restritas a esses dois buckets no runtime. Confirme que `cdn-orbit.allblue-labs.com` está ativo no bucket público e que o privado está sem domínio público e sem `r2.dev`.

## Backup diário

Use o [runbook de backup e restore](backup-restore.md#produção--backup-postgresql-em-r2). Ele inclui criação do bucket privado, credenciais distintas, expiração e instalação do timer no Ubuntu de produção. O dump inclui os localizadores e hashes de arquivos, e recuperar mídia exige os objetos correspondentes no storage. O build do frontend pode ser republicado a partir do digest registrado.

## Sentry por ambiente

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
