#!/usr/bin/env bash
# Root-only preparation. Does not deploy images, migrate databases or enable email workers.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
source_dir=$(cd "$(dirname "$0")/.." && pwd)
[[ -f /opt/stacks/orbit/.env && -f "$source_dir/nginx/proxy-common.inc" ]] || { echo 'Arquivos de staging não encontrados.' >&2; exit 1; }
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/var/backups/orbit-host/$stamp
mkdir -p "$backup"
cp /etc/nginx/orbit-proxy.inc "$backup/"
[[ ! -f /etc/nginx/orbit-proxy-secret.inc ]] || cp /etc/nginx/orbit-proxy-secret.inc "$backup/"
python3 "$source_dir/bin/configure-proxy-origin.py"
install -m 0644 "$source_dir/nginx/proxy-common.inc" /etc/nginx/orbit-proxy.inc
if ! nginx -t; then
    cp "$backup/orbit-proxy.inc" /etc/nginx/orbit-proxy.inc
    echo 'Nginx recusou o include. A configuração anterior foi restaurada.' >&2
    exit 1
fi
systemctl reload nginx
echo 'Cópia da configuração do Nginx preservada e proxy privado preparado.'
