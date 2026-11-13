#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
python3 "$source_dir/bin/configure-proxy-origin.py"
cert=/etc/nginx/ssl/orbit-origin.pem
key=/etc/nginx/ssl/orbit-origin.key
openssl x509 -in "$cert" -noout -checkend 604800 >/dev/null
openssl x509 -in "$cert" -noout -checkhost orbit.allblue-labs.com
cert_pub=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_pub=$(openssl pkey -in "$key" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[[ "$cert_pub" == "$key_pub" ]] || { echo 'Certificado e chave não correspondem.' >&2; exit 1; }
chown root:root "$cert" "$key"
chmod 644 "$cert"
chmod 600 "$key"
target=/etc/nginx/conf.d/10-orbit.conf
backup=$(mktemp /etc/nginx/orbit-config.XXXXXX)
cp "$target" "$backup"
trap 'cp "$backup" "$target"; rm -f "$backup"' ERR
install -m 644 "$source_dir/nginx/orbit-tls.conf" "$target"
nginx -t
systemctl reload nginx
trap - ERR
rm -f "$backup"
echo 'TLS ativado. Valide pela Cloudflare em modo Full (strict).'
