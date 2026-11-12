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
5. Mantenha `CUSTOMER_PORTAL_ENABLED=false`. O portal é dormant nesta release.
6. Para produção pública, use TLS no edge, `FRONTEND_ORIGIN` exata e
   `AUTH_COOKIE_SECURE=true`. `ALLOW_INSECURE_LOCAL_COOKIES` é somente para um
   smoke local isolado. O mesmo `FRONTEND_ORIGIN` é injetado no frontend: ele é
   a autoridade da validação same-origin do BFF e não pode ser inferido do host
   interno do container ou do reverse proxy.
7. Com `STORAGE_PROVIDER=LOCAL`, configure `STORAGE_LOCAL_PUBLIC_URL` com a URL
   HTTPS pública da API, incluindo `/api/v1` (por exemplo,
   `https://orbit.example.com/api/v1`). O padrão `localhost` do Compose é para
   desenvolvimento: em um link aberto por outra máquina, ele aponta para essa
   máquina. No Nginx, encaminhe `/api/v1/` para a API e deixe `/api/auth/`,
   `/api/orbit/` e `/api/cep/` no Next.js. O frontend encaminha imagens do
   storage local pelo BFF; links externos e clientes mobile usam a URL pública.

## Build reproduzível e provenance

Defina `ORBIT_VERSION`, o SHA completo em `ORBIT_COMMIT_SHA` e um timestamp UTC
RFC 3339 em `ORBIT_BUILD_TIME`. Então execute:

```bash
# Somente na estação de desenvolvimento/CI:
docker compose -f docker-compose.yml -f docker-compose.build.yml build --pull api migrate frontend
docker compose -f docker-compose.yml -f docker-compose.build.yml push api migrate frontend

# No servidor, use as imagens publicadas, sem Git/build:
docker compose pull
```

Registre digest, `org.opencontainers.image.revision` e
`org.opencontainers.image.created`. A ausência de qualquer build arg falha
antes do build; as imagens não usam `latest` implícito.

O Compose principal usa `docker.io/allbluelabs/orbit-api`,
`orbit-api-migrator` e `orbit-frontend`. `ORBIT_API_IMAGE`,
`ORBIT_MIGRATOR_IMAGE` e `ORBIT_FRONTEND_IMAGE` permitem fornecer referências
completas com digest. O staging usa um único repositório privado com três tags,
por limite do plano Docker Hub, e um arquivo de lock por digest; consulte
[`../../deploy/staging/README.md`](../../deploy/staging/README.md).

## Migrate e deploy

```bash
docker compose run --rm migrate
docker compose up -d --no-build postgres api frontend
```

O migrator cria/reconcilia primeiro somente os atributos seguros do papel,
executa `prisma migrate deploy`, reconcilia todos os grants de `orbit_app` e,
por fim, executa o seed idempotente dos quatro planos comerciais. Esse catálogo
é referência obrigatória para cadastro e billing e não é dado demo. O runtime
usa `APP_DATABASE_URL`, valida `NOSUPERUSER` e `NOBYPASSRLS` na inicialização.
Seeds de owner/admin e o bootstrap de assinaturas existentes continuam sendo
ações operacionais explícitas, nunca parte do boot normal.
O `DATABASE_URL` do runtime também usa o papel restrito. A senha administrativa
do PostgreSQL e `PLATFORM_ADMIN_PASSWORD` não entram no ambiente da API.
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
