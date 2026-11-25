#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
host=${1:-orbit.allblue-labs.com}
if [[ $# -gt 1 || ( "$host" != orbit.allblue-labs.com && "$host" != portal-orbit.com.br ) ]]; then
    echo 'Informe o hostname Orbit do ambiente.' >&2
    exit 1
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cert=/etc/nginx/ssl/orbit-origin.pem
key=/etc/nginx/ssl/orbit-origin.key
openssl x509 -in "$cert" -noout -checkend 604800 >/dev/null
hostname_check=$(LC_ALL=C openssl x509 -in "$cert" -noout -checkhost "$host")
[[ "$hostname_check" == "Hostname $host does match certificate" ]] || { echo 'O certificado não corresponde ao hostname do ambiente.' >&2; exit 1; }
cert_pub=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_pub=$(openssl pkey -in "$key" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[[ "$cert_pub" == "$key_pub" ]] || { echo 'Certificado e chave não correspondem.' >&2; exit 1; }
python3 "$source_dir/bin/configure-proxy-origin.py"
chown root:root "$cert" "$key"
chmod 644 "$cert"
chmod 600 "$key"
target=/etc/nginx/conf.d/10-orbit.conf
work=$(mktemp -d /etc/nginx/orbit-config.XXXXXX)
if [[ -f "$target" ]]; then cp "$target" "$work/previous"; fi
rollback() {
    if [[ -f "$work/previous" ]]; then cp "$work/previous" "$target"; else rm -f "$target"; fi
}
trap 'rm -f "$work/previous" "$work/candidate"; rmdir "$work"' EXIT
sed "s/orbit\.allblue-labs\.com/$host/g" "$source_dir/nginx/orbit-tls.conf" > "$work/candidate"
trap rollback ERR
install -m 644 "$work/candidate" "$target"
nginx -t
systemctl reload nginx
trap - ERR
echo "TLS ativado para $host. Valide pela Cloudflare em modo Full (strict)."
