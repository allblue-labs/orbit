#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(uname -s) == Darwin && $EUID -eq 0 ]] || { echo 'Execute com sudo neste Mac.' >&2; exit 1; }
cp -p /etc/hosts "/etc/hosts.orbit-backup.$(date -u +%Y%m%dT%H%M%SZ)"
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/hosts')
s=p.read_text()
alias='orbit-staging.home.arpa'
for line in s.splitlines():
    fields=line.split('#',1)[0].split()
    if alias in fields[1:] and fields[0] != '192.168.18.200':
        raise SystemExit('Existe um endereço conflitante para '+alias)
if not any(alias in line.split('#',1)[0].split()[1:] for line in s.splitlines()):
    p.write_text(s.rstrip()+'\n192.168.18.200\torbit-staging.home.arpa\n')
PY
dscacheutil -flushcache
killall -HUP mDNSResponder
echo 'Hostname local configurado: ssh ninja@orbit-staging.home.arpa'
echo 'O domínio público continua resolvendo pela Cloudflare.'
