# Orbit V2 production deployment

Este runbook é a sequência autoritativa de build, migration, deploy e smoke da
release V1. Execute os gates sequencialmente. Nunca use uma imagem já existente
como evidência de uma release nova. Para validar Compose, use `config --quiet`;
nunca imprima a configuração interpolada: ela contém segredos.

## Preflight

1. Confirme branch, SHA e árvore de trabalho. O artefato deve apontar para um
   commit imutável; alterações locais não entram silenciosamente na imagem.
2. Faça backup do banco e do storage conforme `backup-restore.md`.
3. Execute o SQL de PMOC descrito em `migration-runbook.md`. Qualquer PMOC
   operacional `ACTIVE` sem coverage bloqueia o upgrade até classificação e
   correção explícitas.
4. Injete os valores de `.env.example` pelo secret manager. Nenhum placeholder
   é aceito para JWT, AES ou trial fingerprint.
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
   `AWS_SES_FROM_EMAIL` e `IDENTITY_PUBLIC_WEB_URL` também são obrigatórios:
   e-mails transacionais usam exclusivamente Amazon SES. Consulte
   `backend/docs/amazon-ses.md` para configurar a identidade e o acesso de produção.
5. `CUSTOMER_PORTAL_ENABLED` liga a área do cliente no app (padrão `true` no
   compose). Com `false`, nenhuma rota `/portal/*` nem a gestão do acesso em
   `/customers/:id/portal/*` é registrada. Ligado, o acesso do cliente é criado
   pelo owner com senha temporária; convite e recuperação por e-mail respondem
   `PORTAL_EMAIL_DELIVERY_UNAVAILABLE` enquanto a entrega do portal for no-op.
6. Para produção pública, use TLS no edge, `FRONTEND_ORIGIN` exata e
   `AUTH_COOKIE_SECURE=true`. `ALLOW_INSECURE_LOCAL_COOKIES` é somente para um
   smoke local isolado. O mesmo `FRONTEND_ORIGIN` é injetado no frontend: ele é
   a autoridade da validação same-origin do BFF e não pode ser inferido do host
   interno do container ou do reverse proxy.
   No servidor dedicado, use estes valores:

   ```dotenv
   FRONTEND_ORIGIN=https://portal-orbit.com.br
   IDENTITY_PUBLIC_WEB_URL=https://portal-orbit.com.br
   STORAGE_PUBLIC_API_URL=https://portal-orbit.com.br/api/v1
   R2_PUBLIC_URL=https://cdn-orbit.allblue-labs.com
   AUTH_COOKIE_SECURE=true
   ALLOW_INSECURE_LOCAL_COOKIES=false
   COMPOSE_PROFILES=hotpath
   REDIS_HOTPATH_ENABLED=true
   ```

   Gere as senhas e segredos nesse ambiente. Para Redis, gere
   `REDIS_HOTPATH_PASSWORD` com `openssl rand -hex 32`.
7. Configure R2 com os dois buckets e o domínio CDN, conforme
   [`cloudflare-r2.md`](../../backend/docs/cloudflare-r2.md). Em instalações
   existentes, migre os volumes antes de iniciar a API nova. Produção recusa
   `STORAGE_PROVIDER=LOCAL`; a API não monta diretórios de mídia. Preserve no
   Nginx `/api/v1/` para a API e `/api/orbit/`/`/api/auth/` para o Next.js.
8. Use o [runbook de estáticos, backup e Sentry](edge-storage-sentry.md) para
   publicar os assets do digest de produção no R2 e ativar a rota restrita da
   Cloudflare. O lock e o manifesto de produção também são usados pelo backup.

## Nginx e TLS no servidor dedicado

Use Nginx com HTTP/2 e os mesmos arquivos de segurança de staging. Configure
no firewall da nuvem e no host entrada TCP 443 pelas faixas IPv4/IPv6 oficiais da
Cloudflare e acesso SSH pelas redes administrativas autorizadas. Mantenha
PostgreSQL e Redis sem porta publicada. API e frontend ficam em loopback.
Instale em `/etc/nginx/cloudflare-realip.conf` uma linha
`set_real_ip_from <CIDR>;` para cada faixa oficial. A configuração comum usa
essa lista para validar a origem de `CF-Connecting-IP`. [Faixas Cloudflare](https://www.cloudflare.com/ips/)

Em **SSL/TLS → Origin Server** na zona de produção, emita um certificado
para `portal-orbit.com.br`. Instale o certificado em
`/etc/nginx/ssl/orbit-origin.pem` e a chave em `/etc/nginx/ssl/orbit-origin.key`.
Proteja a chave com modo 600. Com o `.env` da stack já criado em
`/opt/stacks/orbit`, instale a configuração comum e ative o vhost:

```bash
sudo install -m 0644 deploy/staging/nginx/00-orbit-common.conf /etc/nginx/conf.d/00-orbit-common.conf
sudo install -m 0644 deploy/staging/nginx/proxy-common.inc /etc/nginx/orbit-proxy.inc
sudo bash deploy/staging/bin/activate-tls.sh portal-orbit.com.br
```

Caso o pacote Nginx tenha instalado um vhost padrão nas mesmas portas, desative
esse vhost antes de ativar o Orbit. O ativador confere o certificado e sua
chave, instala o segredo do proxy e testa a configuração antes de recarregar.
Na zona de produção, selecione **Full (strict)**. [Certificados Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)

## Build reproduzível e provenance

Em um checkout limpo, com Trivy e Cosign v3 instalados no executor de build,
publique as imagens e gere o lock e o manifesto. Mantenha a chave de assinatura
em um cofre ou KMS. Use o caminho do arquivo protegido ou a URI do KMS em
`ORBIT_RELEASE_SIGNING_KEY` e distribua a chave pública por um canal confiável.

```bash
ORBIT_RELEASE_DEPLOYMENT=production ORBIT_BUILD_BACKUP_IMAGE=true \
  ORBIT_RELEASE_SIGNING_KEY=/caminho/seguro/orbit-release.key \
  ORBIT_RELEASE_PUBLIC_KEY=/caminho/confiavel/orbit-release.pub \
  ORBIT_RELEASE_OUTPUT=/caminho/privado/orbit-release bash deploy/staging/bin/build-push.sh
```

O builder só emite o lock depois de verificar o SBOM SPDX, o scan de
vulnerabilidades altas e críticas e a assinatura de cada digest. Guarde os
relatórios `*.spdx.json`, `*.scan.json` e `*.signature.json` com a release.
Com uma chave própria, a assinatura fica no registro privado e não é enviada
ao log público do Sigstore. A verificação confere o digest com a chave
pública confiável. [SBOM do BuildKit](https://docs.docker.com/build/metadata/attestations/sbom/) ·
[Trivy](https://trivy.dev/docs/latest/references/configuration/cli/trivy_image/) ·
[Cosign](https://docs.sigstore.dev/cosign/verifying/verify/)

Registre digest, `org.opencontainers.image.revision` e
`org.opencontainers.image.created`. A ausência de qualquer build arg falha
antes do build; as imagens não usam `latest` implícito.

O Compose principal usa o repositório privado `docker.io/allbluelabs/orbit-api`,
com sufixos `-api`, `-migrator` e `-frontend` nas tags. `ORBIT_API_IMAGE`,
`ORBIT_MIGRATOR_IMAGE` e `ORBIT_FRONTEND_IMAGE` permitem fornecer referências
completas com digest. Crie/confirme o repositório como privado antes do push.
Instale `release.json` e `docker-compose.lock.yml` em `/opt/stacks/orbit`.
Em produção use `COMPOSE_FILE=docker-compose.yml:docker-compose.lock.yml` e
`ORBIT_VERSION` igual a `tag` do manifesto. O staging usa um overlay separado. Consulte
[`../../deploy/staging/README.md`](../../deploy/staging/README.md).

## Migrate e deploy

No executor de deploy, compare o lock com o manifesto aprovado e valide os
digests usando a chave pública instalada por um canal independente.

```bash
set -o pipefail
jq -er '.images[].digest' release.json | sort -u | while IFS= read -r image; do
  cosign verify --key /caminho/confiavel/orbit-release.pub --insecure-ignore-tlog "$image" || exit 1
done
```

Com as assinaturas aprovadas, aplique as migrations e suba os serviços.

```bash
docker compose run --rm migrate
docker compose up -d --no-build postgres api frontend worker documents
```

O migrator cria/reconcilia primeiro somente os atributos seguros do papel,
executa `prisma migrate deploy`, reconcilia todos os grants de `orbit_app` e,
por fim, executa o seed idempotente dos quatro planos comerciais. Esse catálogo
é referência obrigatória para cadastro e billing e não é dado demo. O runtime
usa `DATABASE_URL` com o papel restrito via PgBouncer e recusa privilégios administrativos diretos,
herdados e ownership de objetos da aplicação na inicialização. A verificação
é obrigatória em produção, mesmo sem a flag de enforcement.
Seeds de owner/admin e o bootstrap de assinaturas existentes continuam sendo
ações operacionais explícitas, nunca parte do boot normal.
O runtime de produção recusa `DIRECT_DATABASE_URL`, `POSTGRES_PASSWORD`,
`PLATFORM_ADMIN_PASSWORD` e `OWNER_PASSWORD`; elas pertencem exclusivamente
aos jobs administrativos. Ao atualizar uma implantação externa ao Compose,
remova essas variáveis da API/worker antes de iniciar esta release.
Para provisionar o administrador global após as migrations, preencha os campos
`PLATFORM_ADMIN_*` e execute `docker compose --profile admin run --rm bootstrap-admin`
(inclua o arquivo de lock do ambiente, se houver). Remova a senha do `.env`
após guardar o acesso no cofre. PostgreSQL não publica porta; API/frontend
publicam somente em `127.0.0.1`, nas portas 6001/7070 por padrão.

## Health e smoke

- `GET /health/live` prova somente que o processo responde.
- `GET /health/ready` prova que a dependência crítica PostgreSQL responde.
- O healthcheck do container da API usa readiness, não a rota raiz.
- Nenhum probe retorna DSN, segredo, tenant ou detalhe de driver.

Após readiness verde, valide em sessão real:

1. login, refresh e logout;
2. isolamento de unidade/tenant e uma negação RBAC esperada;
3. criação e leitura de cliente/equipamento;
4. PMOC draft com coverage, ativação e preview 100 × 12;
5. RVT, OS, evidence e artifact/documento;
6. fila mobile, detalhe por ID, pacote offline, pull/push e replay;
7. QR válido e QR revogado;
8. assinatura do usuário e customer acknowledgement;
9. billing readiness; checkout apenas se Stripe estiver habilitado.

## Rollback trigger

Interrompa o rollout e siga `rollback-runbook.md` em qualquer um destes casos:
migration pendente/falha, readiness vermelha, erro cross-tenant, papel runtime
privilegiado, incompatibilidade de contrato, high/critical alcançável, perda de
storage ou taxa de 5xx acima do baseline. O primeiro passo é rollback da
aplicação; banco só é revertido manualmente com plano aprovado.

## Incidentes mínimos

- Segredo exposto: revogue, rotacione conforme `secrets-runbook.md`, preserve
  evidências e invalide sessões quando aplicável.
- Banco: pare writers, preserve backup/WAL, registre migration/SHA e acione DBA.
- Stripe webhook: mantenha dedupe, pause reconciliação se necessário e não
  promova subscription com evento incompleto.
- Storage: preserve banco e objetos, bloqueie emissão nova se o provider não
  puder garantir durabilidade e valide hashes após recuperação.

## Gate de menor privilégio (PR-14)

O script `deploy/staging/bin/deploy.sh --check` usa o módulo
`deployment_preflight.py` instalado no mesmo diretório. Copie ambos ao atualizar
o deploy; a validação captura o Compose normalizado sem expor valores. Exige
imagens por digest, papel distinto para migrations, portas internas canônicas,
UID/GID sem root, limites e filesystem protegido. O profile `admin` só cria uma
conta quando invocado explicitamente. O profile de migração offline de mídia
continua separado e não é iniciado pelo deploy normal.

As bases Node dos Dockerfiles fixam patch e digest. Uma atualização de segurança
exige atualizar os dois Dockerfiles, repetir os gates e gerar novos digests de
release. O código nas imagens de runtime pertence a root, mas o processo usa
UID 1001. Migrate/bootstrap usam UID 1000, capabilities removidas, filesystem
somente leitura e `/tmp` limitado em memória; somente PostgreSQL persiste dados.
`API_HOST` é uma configuração de execução fora de Docker. Dentro do Compose a
API escuta em `0.0.0.0:5001`, publicada em `127.0.0.1:6001` para Nginx.

Qualificação local sem credenciais reais e sem publicar imagens:

```bash
python3 scripts/test_deployment_preflight.py
docker build --target migrator --tag orbit-pr14-migrator:local backend
docker build --target runner --tag orbit-pr14-api:local backend
docker build --target runner --tag orbit-pr14-frontend:local frontend
python3 scripts/verify-deployment-images.py
```

O último gate cria projeto, redes, volumes e banco exclusivos; aplica migrations,
executa bootstrap explicitamente e verifica login WEB/MOBILE e BFF. Remove apenas
os recursos descartáveis que criou. Não usa `.env` do desenvolvedor nem envia
mensagens aos providers. O CI executa o mesmo gate.

Use o [runbook de workers](pr-15-worker-isolation.md) para readiness,
monitoramento, retomada de dead letters e rollback da topologia da PR-15.
