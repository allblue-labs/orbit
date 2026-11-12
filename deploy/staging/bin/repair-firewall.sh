#!/usr/bin/env bash
# Commit confirmado: uma NOVA conexão SSH deve criar o arquivo de confirmação.
set -Eeuo pipefail
[[ $EUID -eq 0 && ${SUDO_USER:-} == ninja ]] || { echo 'Execute como ninja usando sudo.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
state=/root/orbit-firewall-$stamp
install -d -m 700 "$state"
cp -a /etc/ufw "$state/ufw"
cp -a /etc/default/ufw "$state/ufw-default"
nonce=$(openssl rand -hex 16)
proof=/home/ninja/orbit-bootstrap/.firewall-proof-$nonce
timer=orbit-firewall-repair-rollback-$stamp
cat > "$state/rollback.sh" <<ROLLBACK
#!/usr/bin/env bash
cp -a '$state/ufw/.' /etc/ufw/
cp -a '$state/ufw-default' /etc/default/ufw
ufw reload
ROLLBACK
chmod 700 "$state/rollback.sh"
systemd-run --unit="$timer" --on-active=10m "$state/rollback.sh"

# A regra de SSH da LAN é inserida antes de restringir qualquer outro acesso.
ufw limit from 192.168.18.0/24 to any port 22 proto tcp comment 'SSH somente LAN'
ufw allow from 192.168.18.0/24 to any port 80 proto tcp comment 'HTTP LAN redirect'
ufw allow from 192.168.18.0/24 to any port 443 proto tcp comment 'HTTPS LAN'
for port in 22 80 443 403 5001 6001 7070 5432; do
    ufw --force delete allow "$port/tcp" >/dev/null 2>&1 || true
    ufw --force delete allow "$port" >/dev/null 2>&1 || true
done
ufw --force delete allow OpenSSH >/dev/null 2>&1 || true
ufw --force delete allow 'Nginx Full' >/dev/null 2>&1 || true
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
python3 - <<'PY' > "$state/cloudflare-cidrs"
import ipaddress, re
from pathlib import Path
text=Path('/etc/nginx/cloudflare-realip.conf').read_text()
nets=re.findall(r'^set_real_ip_from ([^;]+);$',text,re.M)
if not 10 <= len(nets) <= 100: raise SystemExit('Revise os intervalos Cloudflare.')
for value in nets:
    net=ipaddress.ip_network(value,strict=True)
    if not net.is_global: raise SystemExit('Intervalo não público.')
    print(net)
PY
while IFS= read -r cidr; do
    ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare HTTPS'
done < "$state/cloudflare-cidrs"
ufw default deny incoming
ufw default allow outgoing
ufw logging low
ufw --force enable
install -m 750 "$source_dir/bin/docker-firewall.sh" /usr/local/sbin/orbit-docker-firewall
install -m 644 "$source_dir/systemd/orbit-docker-firewall.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now orbit-docker-firewall.service
systemctl reload-or-restart orbit-docker-firewall.service

# Este observador root só cancela o rollback quando o Mac confirma nova sessão.
cat > "$state/confirm.sh" <<CONFIRM
#!/usr/bin/env bash
set -e
for attempt in {1..600}; do
    if [[ -f '$proof' ]]; then
        systemctl stop '$timer.timer'
        {
            date -u
            echo 'Nova conexão SSH confirmada; rollback cancelado.'
            systemctl is-enabled orbit-docker-firewall.service
            systemctl is-active orbit-docker-firewall.service
            ufw status numbered
            iptables -w -S ORBIT-INGRESS
        } > /home/ninja/orbit-bootstrap/firewall-verified.txt
        chmod 644 /home/ninja/orbit-bootstrap/firewall-verified.txt
        exit 0
    fi
    sleep 1
done
exit 1
CONFIRM
chmod 700 "$state/confirm.sh"
systemd-run --unit="orbit-firewall-confirm-$stamp" "$state/confirm.sh"
printf '%s\n' "$proof" > /home/ninja/orbit-bootstrap/firewall-proof-request
chown ninja:ninja /home/ninja/orbit-bootstrap/firewall-proof-request
chmod 600 /home/ninja/orbit-bootstrap/firewall-proof-request
echo 'Regras aplicadas. Aguardando nova conexão SSH do Mac para confirmar.'
ufw status numbered
