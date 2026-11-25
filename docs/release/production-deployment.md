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
7. Configure R2 com os dois buckets e o domínio CDN, conforme
   [`cloudflare-r2.md`](../../backend/docs/cloudflare-r2.md). Em instalações
   existentes, migre os volumes antes de iniciar a API nova. Produção recusa
   `STORAGE_PROVIDER=LOCAL`; a API não monta diretórios de mídia. Preserve no
   Nginx `/api/v1/` para a API e `/api/orbit/`/`/api/auth/` para o Next.js.
8. Use o [runbook de estáticos, backup e Sentry](edge-storage-sentry.md) para
   publicar os assets do digest de produção no R2 e ativar a rota restrita da
   Cloudflare. O lock e o manifesto de produção também são usados pelo backup.

## Build reproduzível e provenance

Em um checkout limpo, publique as imagens e gere o lock e o manifesto:

```bash
ORBIT_RELEASE_DEPLOYMENT=production ORBIT_BUILD_BACKUP_IMAGE=true \
  ORBIT_RELEASE_OUTPUT=/caminho/privado/orbit-release bash deploy/staging/bin/build-push.sh
```

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

```bash
docker compose run --rm migrate
docker compose up -d --no-build postgres api frontend worker documents
```

O migrator cria/reconcilia primeiro somente os atributos seguros do papel,
executa `prisma migrate deploy`, reconcilia todos os grants de `orbit_app` e,
por fim, executa o seed idempotente dos quatro planos comerciais. Esse catálogo
é referência obrigatória para cadastro e billing e não é dado demo. O runtime
usa somente `APP_DATABASE_URL` e recusa privilégios administrativos diretos,
herdados e ownership de objetos da aplicação na inicialização. A verificação
é obrigatória em produção, mesmo sem a flag de enforcement.
Seeds de owner/admin e o bootstrap de assinaturas existentes continuam sendo
ações operacionais explícitas, nunca parte do boot normal.
O runtime de produção recusa `DATABASE_URL`, `POSTGRES_PASSWORD`,
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
