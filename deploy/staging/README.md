# Orbit — staging Ubuntu

Destino: `ninja@192.168.18.200` (`robozao`, Ubuntu 24.04 LTS, amd64).
URL pública: `https://orbit.allblue-labs.com`; IP fixo: `177.74.108.132`.
Instalação nova, banco vazio, independente de produção. Os PRs de liberação
continuam pendentes: subir staging não aprova a aplicação para produção.

Implantação validada em 12/11/2026: release de aplicação
`staging-6616a00961e0`, kernel 6.8.0-149, 110 migrations aplicadas e 131 tabelas
com RLS forçado. Landing, login e imagem responderam 200 pela Cloudflare;
HTTP redirecionou com 301; as recusas de origem/autenticação e os bloqueios de
rotas internas foram verificados. Os digests e demais verificações estão em
[`deployment-2026-11-12.json`](deployment-2026-11-12.json), sem segredos.
Infraestrutura e aplicação têm revisões separadas: as correções operacionais
posteriores não alteraram o código da aplicação presente nessas imagens.

## Rede e limites de confiança

```text
Internet → Cloudflare (proxy + TLS) → roteador TCP 443 → Ubuntu Nginx 443
                                                      ├─ 127.0.0.1:7070 Next.js
                                                      └─ 127.0.0.1:6001 API
                                                                         └─ PostgreSQL (rede Docker)
Mac LAN → SSH 22 → túnel para 127.0.0.1:5001 Dockge
```

Docker Hub: `allbluelabs/orbit-api`, **privado**, com tags
`staging-<commit>-api`, `staging-<commit>-migrator`,
`staging-<commit>-frontend`. O plano consultado permite um repositório privado;
as três imagens são diferentes, mesmo compartilhando o repositório.
O lock usa digests completos. Nenhum build ou checkout Git ocorre no Ubuntu.

Depois da implantação, `docker compose up -d` em `/opt/stacks/orbit` usa o
mesmo lock e o overlay `docker-compose.staging.yml` por meio de `COMPOSE_FILE`. Para conferir, rode
`docker compose config --images`. Uma nova revisão no Git vira release de
staging após publicar as três imagens, instalar o lock correspondente e
executar o deploy. `docker compose down -v` apaga os volumes do projeto,
incluindo o banco. Para recriar somente os contêineres, use
`docker compose up -d --force-recreate`.

PostgreSQL 17.11/Alpine 3.24 está fixado por digest; mantém-se o major 17
suportado pelo projeto, com o patch atual, sem impor um upgrade de dados para 18.
Nginx stable vem do repositório oficial, com chave GPG conferida e atualizações
APT disponíveis. Docker/Compose usam o repositório já instalado no servidor.
Confirme versões efetivas e pacotes pendentes após cada atualização.

## Preparação do host

Os arquivos desta pasta são copiados para `~/orbit-bootstrap/` no Ubuntu.
O usuário executa, sem transmitir sua senha:

```bash
sudo bash ~/orbit-bootstrap/bin/bootstrap-host.sh
```

O script preserva configurações anteriores em `/root/orbit-bootstrap-<UTC>`:

- Atualiza pacotes, instala Nginx stable e valida sua chave oficial.
- SSH somente por chave, sem root/senha; mantém encaminhamento local para túnel.
- UFW permite SSH somente de `192.168.18.0/24`, HTTP/HTTPS da LAN e HTTPS das
  redes oficiais Cloudflare. Remove regras globais das portas conhecidas.
- A cadeia `DOCKER-USER` bloqueia entrada direta pela interface física,
  preservando conexões estabelecidas e saída dos containers. Exige backend
  iptables do Docker, sem desligar a gestão de regras pelo daemon.
- Dockge conserva dados, passa a publicar `127.0.0.1:5001` e tem imagem fixada
  por digest. O socket Docker é equivalente a acesso root: somente admins.
- Fail2ban e atualizações de segurança automáticas, sem reboot automático.
- Logs Docker rotacionados no Compose; Nginx não registra query strings.

Há reversão automática do firewall após **10 minutos**. Antes de executar o
bootstrap (ou `repair-firewall.sh`), mantenha um terminal neste Mac com:

```bash
python3 deploy/staging/bin/confirm-firewall.py ninja@192.168.18.200
```

O observador abre uma **nova conexão SSH** depois de as regras serem aplicadas.
Somente essa confirmação permite ao observador root cancelar o rollback.
Confira `~/orbit-bootstrap/firewall-verified.txt` no Ubuntu. Não é necessário
cancelar o timer manualmente. A proteção Docker fica habilitada tanto por
`multi-user.target` quanto por `docker.service`.

Se a janela expirar, as regras anteriores são restauradas. `inactive` no timer,
isoladamente, não prova cancelamento; confira o journal e o arquivo de
verificação. Reaplique com `sudo bash ~/orbit-bootstrap/bin/repair-firewall.sh`
mantendo o observador no Mac. Confirmações antigas não são reaproveitadas.

Se houver reboot pendente, agende-o depois do primeiro teste e valide novamente
SSH, firewall, Nginx e retorno automático dos containers. Não exponha as portas
no roteador antes de confirmar UFW/DOCKER-USER.

## Certificado fornecido pelo usuário

No Cloudflare, gere Origin Certificate cobrindo `orbit.allblue-labs.com`.
Instale **no servidor**, usando `sudoedit`, sem colar a chave em chat/Git:

```bash
sudoedit /etc/nginx/ssl/orbit-origin.pem
sudoedit /etc/nginx/ssl/orbit-origin.key
sudo chmod 600 /etc/nginx/ssl/orbit-origin.key
sudo bash ~/orbit-bootstrap/bin/activate-tls.sh
```

O script verifica validade, domínio e correspondência entre certificado/chave,
testa o Nginx e só então recarrega. No Cloudflare use **Full (strict)**,
registro A `orbit → 177.74.108.132` com proxy ativado (nuvem laranja),
Always Use HTTPS e TLS mínimo 1.2. Não crie AAAA para o servidor sem IPv6 público
preparado; respostas AAAA da própria Cloudflare são normais com proxy.
Configure bypass de cache para `/api/*`, `/login*`, `/signup*`, páginas privadas
e links de assinatura/aprovação; não use regra Cache Everything na aplicação.
Respostas privadas e autenticadas não podem ser cacheadas no edge.

O usuário optou por HTTPS **público**. Certificado Origin CA não é confiável
diretamente pelo navegador local. Não importe uma CA global nem desabilite TLS.
Na LAN, use a URL pública via Cloudflare; acesso direto local é administrativo
por SSH e pode validar os upstreams via loopback no próprio servidor.

## Acesso neste Mac

Alias SSH `orbit-staging` aponta para `ninja@192.168.18.200`.
Para um hostname local também resolvível fora do SSH:

```bash
sudo bash deploy/staging/bin/configure-mac-hosts.sh
ssh ninja@orbit-staging.home.arpa
```

Isso adiciona apenas o hostname local em `/etc/hosts`, preservando a resolução
pública de `orbit.allblue-labs.com` pela Cloudflare. Dockge via túnel:

```bash
ssh -N -L 127.0.0.1:15001:127.0.0.1:5001 orbit-staging
# Abra http://127.0.0.1:15001 neste Mac.
```

## Segredos e primeiro deploy

Arquivos no Ubuntu: `/opt/stacks/orbit/`, proprietário ninja, diretório 0700.
`init-environment.py` gera `.env` 0600 uma única vez, com JWT/AES/senhas de
banco exclusivos. Não sobrescreve arquivo existente nem copia `.env` do Mac.
Complete com editor local ao servidor:

```bash
nano /opt/stacks/orbit/.env
docker login --username allbluelabs
```

Para o Docker Hub, prefira PAT de **leitura** no Ubuntu e conta/token de push
apenas no Mac/CI. Sem credential helper, Docker guarda credencial no config
do usuário: preserve `~/.docker` 0700 e `config.json` 0600, ou use um helper.
Não compartilhe o config do Mac com o Dockge.

A API exige `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
e `AWS_SES_FROM_EMAIL` reais mesmo no staging. Use IAM com `ses:SendEmail`
restrito à identidade verificada e credenciais próprias do staging. A região
inicial sugerida é `us-east-2`: confirme onde a identidade SES foi verificada.
Desde a PR-08, `EMAIL_SUPPRESSION_HASH_KEY` também é obrigatória: chave própria
de 32 bytes em base64, estável entre réplicas e backups. O inicializador gera-a
somente para ambientes novos; não execute-o sobre `.env` existente. Para upgrade,
gere a chave uma vez e adicione-a ao secret manager/`.env` protegido antes da API.
Configuração SNS e homologação: [guia de feedback SES](../../backend/docs/amazon-ses-feedback.md).
Na sandbox, tanto remetente quanto destinatário precisam estar verificados.
Não use credenciais fictícias para contornar o preflight.

`STRIPE_ENABLED=false` e `PUSH_PROVIDER=disabled` até configurar recursos de
teste. Se habilitar Stripe, o preflight exige chave `sk_test_`/`rk_test_`.
Firebase deve usar projeto/app de staging, sem reaproveitar tokens de usuários
de produção. SES/push exigem testes reais separados; a implantação não prova
entrega de mensagens nem saída da sandbox.

Build/push no Mac ou CI, com árvore limpa e login Docker Hub:

```bash
ORBIT_RELEASE_OUTPUT=/private/tmp/orbit-staging-release bash deploy/staging/bin/build-push.sh
```

O script usa builder Buildx dedicado `orbit-staging` (`docker-container`) para
suportar atestações de origem mesmo com image store clássico no Docker Desktop.
Não altera o builder selecionado para outros projetos.

Copie o `docker-compose.yml`, o lock gerado e `release.json` para o diretório
do servidor. O servidor **não recebe** `docker-compose.build.yml`, `.git`,
código do backend/frontend, nem segredos do Mac. O script de deploy valida os digests em `release.json` e atualiza
`COMPOSE_FILE` e `ORBIT_VERSION` no `.env` protegido do Ubuntu.

```bash
bash ~/orbit-bootstrap/bin/deploy.sh
```

Atualize `bin/deploy.sh` e `bin/deployment_preflight.py` juntos no servidor.
Para monitorar os workers, copie também `bin/worker-observability.py` e siga
o [runbook da PR-15](../../docs/release/pr-15-worker-isolation.md).
O preflight do PR-14 exige esse módulo no mesmo diretório.

Use `bash ~/orbit-bootstrap/bin/deploy.sh --check` para validar sem baixar
imagens nem alterar os containers. O preflight recusa origens localhost,
cookies inseguros, portas diferentes do Nginx, imagens sem digest e Stripe
habilitado com uma chave que não seja de teste. Não copie o `.env` de outro
ambiente: acrescente somente as credenciais das integrações necessárias.

O migrador efêmero usa `DIRECT_DATABASE_URL` para migrations, grants e catálogos.
API, worker e documentos usam `DATABASE_URL` via PgBouncer, cada um com seu papel
`NOSUPERUSER NOBYPASSRLS`. Siga o [runbook do PgBouncer](../../docs/release/rls-pgbouncer.md)
para preparar as credenciais e verificar a release. Se precisar de administrador
global, preencha `PLATFORM_ADMIN_*` e execute:

```bash
cd /opt/stacks/orbit
docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml \
  --profile admin run --rm bootstrap-admin
```

Guarde o acesso no cofre e retire a senha de bootstrap do `.env` após uso.
Não imprima `docker compose config` ou `docker inspect` de ambientes reais:
eles contêm segredos. Use `config --quiet` e consultas de campos específicos.

## Verificações antes da exposição

- Segunda conexão SSH funciona; rollback do firewall cancelado conscientemente.
- UFW ativo; nenhuma regra global para SSH/Dockge/banco/6001/7070.
- `ss -lnt`: Dockge/6001/7070 somente loopback; banco sem publicação.
- De outra máquina LAN, 5001/6001/7070/5432 indisponíveis.
- `iptables -S DOCKER-USER` chama ORBIT-INGRESS; timer/service persistem ao reboot.
- `nginx -t`, TLS por SNI e Cloudflare Full (strict) válidos.
- Containers saudáveis, migrações aplicadas e conexão da API com papel restrito.
- URL pública: landing/login, cookies Secure/HttpOnly, login/logout,
  cadastro com e-mail SES, arquivo/avatar/evidência por URL pública.
- Webhooks/links de aprovação e download assinados devem ser testados com
  contas sintéticas de staging. Nenhuma alteração de cobrança real.

## Qualificação e recuperação

Staging usa snapshots sanitizados em ambientes descartáveis para qualificar
migrations e RLS. Os timers de backup e restore em R2 são exclusivos da
produção. Em um staging que já recebeu a instalação anterior, desative o timer
legado com `sudo systemctl disable --now orbit-backup.timer`. Os arquivos
locais existentes ficam disponíveis para o período definido pela operação.

Depois de validar o deploy, a finalização do host confere Nginx e firewall.
Quando for necessário aplicar kernel ou microcódigo já instalados, execute:

```bash
sudo bash ~/orbit-bootstrap/bin/finalize-host.sh --reboot
```

Após o boot, confira `uname -r`, saúde dos containers, firewall e acesso público.
Atualizações seguem o lock por digest. Em rollback de aplicação, confira a
compatibilidade com a migration antes de trocar a imagem. Veja o
[runbook da Etapa 04](../../docs/release/operacao-etapa-04.md).

## Roteador — etapa final

Reserva/endereço estático: Ubuntu `192.168.18.200`. Encaminhe **somente TCP
443 externo → 192.168.18.200:443**. Desabilite DMZ, UPnP/NAT-PMP e administração
remota do roteador. Não encaminhe 22, 80, 403, 5001, 6001, 7070 nem 5432.
O redirect HTTP público acontece no Cloudflare (Always Use HTTPS), sem abrir
80 na origem. Se houver filtro de origem no roteador, aceite apenas as redes
Cloudflare; UFW reforça a mesma restrição no host. Administração fora da LAN
deve usar VPN; nunca exponha SSH/Dockge para isso.

Teste pelo 4G/5G a URL pública e confirme que o IP direto não serve a aplicação.
O servidor usa Wi-Fi atualmente: para operação estável, prefira Ethernet e
UPS; não altere a interface remotamente sem acesso de recuperação.

No Huawei **EG8041X6-10**, em **IPv4 Port Mapping**, a regra usada neste host é:

| Campo                       | Valor                   |
| --------------------------- | ----------------------- |
| Mapping Name                | `cloudflare_https`      |
| Enable Port Mapping         | Ativado                 |
| WAN Name                    | `1_INTERNET_R_VID_1000` |
| Internal Host               | `192.168.18.200`        |
| Protocol                    | `TCP`                   |
| External Source IP Address  | Vazio                   |
| External source port number | Ambos vazios            |
| External port number        | `443` até `443`         |
| Internal port number        | `443` até `443`         |

Clique Apply/Save. A porta de origem é variável: restringi-la a 443 impede
as conexões normais. Durante o diagnóstico, 443 estava no campo de porta de
origem e o campo de destino externo estava vazio, resultando em 522 e zero
pacotes 443 na interface do Ubuntu. Não adicione UDP nem outra porta pública.

## Referências oficiais

- [Docker e UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [DOCKER-USER](https://docs.docker.com/engine/network/firewall-iptables/)
- [Pacotes Nginx](https://nginx.org/en/linux_packages.html)
- [Correções de segurança Nginx](https://nginx.org/en/security_advisories.html)
- [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [IPs Cloudflare](https://www.cloudflare.com/ips/)

## Armazenamento local

Instale `docker-compose.staging.yml` ao lado do Compose base e do lock.
API, worker e geração de documentos compartilham o volume nomeado
`staging_media`. A aplicação entrega arquivos por URLs assinadas em
`STORAGE_PUBLIC_API_URL=https://orbit.allblue-labs.com/api/v1`. O overlay
remove do runtime as credenciais R2 e de expurgo. O deploy também as retira
do `.env` do staging. `docker compose down -v` remove o volume junto com o
banco. Para atualizar a release, use `bin/deploy.sh`.

Se o banco de staging já usa R2, importe os bytes uma única vez. O job coleta
referências do banco de staging confirmado pelo operador, baixa apenas os objetos correspondentes,
verifica a integridade e preserva chaves, hashes e IDs. Faça a importação com
os processos Orbit parados e o PostgreSQL ativo. Crie um arquivo temporário
`0600` fora da stack contendo `ORBIT_IMPORT_R2_ENDPOINT`,
`ORBIT_IMPORT_R2_ACCESS_KEY_ID` e `ORBIT_IMPORT_R2_SECRET_ACCESS_KEY`.
Use uma credencial de leitura limitada aos buckets de origem e revogue-a
após a transição.

```bash
cd /opt/stacks/orbit
docker compose stop api worker documents
ORBIT_API_IMAGE='docker.io/allbluelabs/orbit-api@sha256:<digest-api>' \
  ORBIT_STAGING_IMPORT_DATABASE='<nome exato do banco de staging>' \
  ORBIT_STAGING_IMPORT_ENV_FILE=/caminho/privado/staging-import.env \
  docker compose -f docker-compose.yml -f docker-compose.lock.yml \
    -f docker-compose.staging.yml -f docker-compose.staging-import.yml \
    --profile storage-import run --rm --no-deps -T storage-import
bash ~/orbit-bootstrap/bin/deploy.sh
```

Confirme o evento `orbit_staging_media_import_complete` antes do deploy.
O job não apaga objetos do R2. Depois da promoção, valide um upload, o download
e a ausência de credenciais R2 nos contêineres. Consulte o
[runbook de produção](../../docs/release/edge-storage-sentry.md).

## Atualização de segurança PR-05

Antes de publicar as imagens da PR-05, seguir a [sequência de implantação](../../docs/release/pr-05-rate-limit-proxies.md#implantação-posterior).
Ela exige migration, dois segredos internos independentes e o include privado
do Nginx. Não basta atualizar somente a imagem da API. O instalador
`bin/configure-proxy-origin.py` gera/preserva os valores sem exibi-los.
