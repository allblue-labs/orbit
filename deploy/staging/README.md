# Orbit — staging Ubuntu

Destino: `ninja@192.168.18.200` (`robozao`, Ubuntu 24.04 LTS, amd64).
URL pública: `https://orbit.allblue-labs.com`; IP fixo: `177.74.108.132`.
Instalação nova, banco vazio, independente de produção. Os PRs de liberação
continuam pendentes: subir staging não aprova a aplicação para produção.

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
- Instala o script/timer de backup; habilite o timer após o primeiro deploy.

Há reversão automática do firewall após **10 minutos**. Depois de testar uma
**segunda conexão SSH a partir do Mac**, cancele-a no Ubuntu:

```bash
sudo systemctl stop "$(cat ~/orbit-firewall-rollback-unit)"
```

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
código do backend/frontend, nem segredos do Mac. Ajuste `ORBIT_VERSION` para a
tag registrada no manifest (os serviços efetivamente usam digests do lock).

```bash
bash ~/orbit-bootstrap/bin/deploy.sh
```

Migrations/grants/catálogos rodam no migrador efêmero, antes da API. A API usa
apenas papel `NOSUPERUSER NOBYPASSRLS`; a credencial administrativa não entra no
runtime. Se precisar de administrador global, preencha `PLATFORM_ADMIN_*` e:

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

## Backup e recuperação

Após deploy validado:

```bash
sudo /usr/local/sbin/orbit-backup
sudo systemctl enable --now orbit-backup.timer
sudo systemctl list-timers orbit-backup.timer
```

O backup diário às 03:15 UTC pausa a API brevemente, faz `pg_dump` e copia os
três storages, verifica a listagem do dump e registra SHA-256. Reinicia a API
mesmo em falha. Retenção local 14 dias. Arquivos ficam em `/var/backups/orbit`
0700; `.env` e chaves AES/JWT precisam de cópia **separada em cofre**.
Esse backup no mesmo disco **não é recuperação de desastre**: falta destino
externo criptografado e prova de restauração antes de qualquer produção real.
Teste restore em projeto/volumes novos, nunca com `down -v` no staging.

Atualizações: gere nova release no Mac/CI, faça backup, baixe imagens por
digest e rode migrations. Rollback de aplicação usa o lock anterior; banco
exige análise de compatibilidade. Nunca remova volumes para corrigir deploy.
Revise semanalmente atualizações APT/Docker/Nginx e listas oficiais Cloudflare.

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

## Referências oficiais

- [Docker e UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [DOCKER-USER](https://docs.docker.com/engine/network/firewall-iptables/)
- [Pacotes Nginx](https://nginx.org/en/linux_packages.html)
- [Correções de segurança Nginx](https://nginx.org/en/security_advisories.html)
- [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [IPs Cloudflare](https://www.cloudflare.com/ips/)
