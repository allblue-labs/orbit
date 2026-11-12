#!/usr/bin/env bash
# Ubuntu 24.04, Docker com backend iptables, host dedicado ao staging.
# Execute como ninja: sudo bash ~/orbit-bootstrap/bin/bootstrap-host.sh
set -Eeuo pipefail
[[ $EUID -eq 0 && ${SUDO_USER:-} == ninja ]] || { echo 'Execute como ninja usando sudo.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
. /etc/os-release
[[ $ID == ubuntu && $VERSION_CODENAME == noble ]] || { echo 'Esperado Ubuntu 24.04.' >&2; exit 1; }
iptables -w -S DOCKER-USER >/dev/null
[[ -s /home/ninja/.ssh/authorized_keys ]] || { echo 'Configure e teste SSH por chave antes.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/root/orbit-bootstrap-$stamp
install -d -m 700 "$backup"
cp -a /etc/ufw /etc/ssh/sshd_config.d "$backup/"
cp -a /opt/dockge/compose.yaml "$backup/dockge-compose.yaml"
ufw status numbered > "$backup/ufw-before.txt"
iptables-save > "$backup/iptables-before.txt"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg ubuntu-keyring ufw fail2ban unattended-upgrades jq
# Repositório oficial stable do Nginx; valide a chave publicada pelo fornecedor.
key_tmp=$(mktemp)
curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://nginx.org/keys/nginx_signing.key -o "$key_tmp"
gpg --show-keys --with-colons "$key_tmp" | grep -q 'fpr:::::::::573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62:'
gpg --dearmor --batch --yes --output /usr/share/keyrings/nginx-archive-keyring.gpg "$key_tmp"
rm -f "$key_tmp"
echo 'deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/ubuntu noble nginx' > /etc/apt/sources.list.d/nginx.list
printf 'Package: *\nPin: origin nginx.org\nPin-Priority: 900\n' > /etc/apt/preferences.d/99-nginx
apt-get update
apt-get install -y nginx
# Distribuição aplica os patches disponíveis; não reinicie automaticamente.
NEEDRESTART_MODE=l apt-get upgrade -y

install -d -m 755 /etc/nginx/ssl
install -d -m 700 /var/backups/orbit
install -d -o ninja -g ninja -m 700 /opt/stacks/orbit
install -m 644 "$source_dir/nginx/00-orbit-common.conf" /etc/nginx/conf.d/00-orbit-common.conf
install -m 644 "$source_dir/nginx/proxy-common.inc" /etc/nginx/orbit-proxy.inc
if [[ ! -f /etc/nginx/conf.d/10-orbit.conf ]]; then
    install -m 644 "$source_dir/nginx/orbit-http.conf" /etc/nginx/conf.d/10-orbit.conf
fi
if [[ -f /etc/nginx/conf.d/default.conf ]]; then
    mv /etc/nginx/conf.d/default.conf "$backup/nginx-default.conf"
fi

# Os dados remotos são validados como CIDR antes de entrarem em UFW/Nginx.
cidr_dir=$(mktemp -d)
curl --proto '=https' --tlsv1.2 -fsS https://www.cloudflare.com/ips-v4 -o "$cidr_dir/v4"
curl --proto '=https' --tlsv1.2 -fsS https://www.cloudflare.com/ips-v6 -o "$cidr_dir/v6"
python3 - "$cidr_dir" <<'PY'
import ipaddress, pathlib, sys
p=pathlib.Path(sys.argv[1])
for filename, version in [('v4', 4), ('v6', 6)]:
    lines=p.joinpath(filename).read_text().splitlines()
    if not 5 <= len(lines) <= 100: raise SystemExit('Lista Cloudflare inesperada.')
    for line in lines:
        net=ipaddress.ip_network(line, strict=True)
        if net.version != version or not net.is_global: raise SystemExit('CIDR inválido.')
PY
: > /etc/nginx/cloudflare-realip.conf
while IFS= read -r cidr || [[ -n "$cidr" ]]; do
    [[ -n "$cidr" ]] && printf 'set_real_ip_from %s;\n' "$cidr" >> /etc/nginx/cloudflare-realip.conf
done < <(cat "$cidr_dir/v4"; echo; cat "$cidr_dir/v6"; echo)
nginx -t

cat > /etc/ssh/sshd_config.d/00-orbit-staging.conf <<'SSH'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding local
PermitTunnel no
SSH
/usr/sbin/sshd -t
cat > /etc/fail2ban/jail.d/orbit-sshd.local <<'JAIL'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
cat > /etc/apt/apt.conf.d/52-orbit-security <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "false";
APT

install -m 750 "$source_dir/bin/backup.sh" /usr/local/sbin/orbit-backup
install -m 644 "$source_dir/systemd/orbit-backup.service" /etc/systemd/system/
install -m 644 "$source_dir/systemd/orbit-backup.timer" /etc/systemd/system/
rm -rf "$cidr_dir"
# Mesmo fluxo validado na recuperação: confirmação por NOVA conexão SSH.
bash "$source_dir/bin/repair-firewall.sh"

# Dockge tem acesso root via socket Docker: apenas loopback + túnel SSH.
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/dockge/compose.yaml')
s=p.read_text()
if '127.0.0.1:5001:5001' not in s:
    if '- 5001:5001' not in s: raise SystemExit('Revise o mapeamento do Dockge manualmente.')
    s=s.replace('- 5001:5001', '- "127.0.0.1:5001:5001"')
s=s.replace('image: louislam/dockge:1\n', 'image: louislam/dockge:1@sha256:335c6368b880ecc203236ed89e6e5232e0d6578e8ef5920e4a502390451502bf\n')
p.write_text(s)
PY
docker compose -f /opt/dockge/compose.yaml config --quiet
docker compose -f /opt/dockge/compose.yaml up -d --no-build
systemctl reload ssh
systemctl enable --now fail2ban nginx unattended-upgrades
systemctl restart fail2ban
systemctl reload nginx

echo 'Configuração aplicada. O observador no Mac confirma a nova conexão SSH.'
echo 'Confira ~/orbit-bootstrap/firewall-verified.txt para confirmar o cancelamento do rollback.'
echo "Backup da configuração: $backup"
echo 'Certificado: /etc/nginx/ssl/orbit-origin.pem (644)'
echo 'Chave: /etc/nginx/ssl/orbit-origin.key (600)'
ufw status numbered
nginx -v
[[ ! -f /var/run/reboot-required ]] || echo 'Reinicialização pendente; agendar após validação.'
