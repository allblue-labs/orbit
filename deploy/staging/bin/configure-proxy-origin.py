#!/usr/bin/env python3
"""Generate independent secrets and install the private Nginx ingress header.

Run with sudo before deploying PR-05. Never print secrets or copy live .env
values to the workstation. Existing valid secrets are preserved.
"""
import os
import re
import secrets
import tempfile
from pathlib import Path


def configure(env_file: Path, include_file: Path) -> None:
    original = env_file.read_text()
    content = original
    values = {}
    for key in ('TRUSTED_PROXY_SECRET', 'AUTH_RATE_LIMIT_SECRET'):
        matches = re.findall(r'^' + key + r'=(.*)$', content, re.MULTILINE)
        if len(matches) > 1:
            raise ValueError(f'{key}: configuração duplicada')
        value = matches[0].strip().strip('\"\'') if matches else ''
        if not value or value.startswith('change-me'):
            value = secrets.token_hex(32)
            if matches:
                content = re.sub(r'^' + key + r'=.*$', key + '=' + value, content, flags=re.MULTILINE)
            else:
                content = content.rstrip('\n') + '\n' + key + '=' + value + '\n'
        if not re.fullmatch(r'[a-f0-9]{64}', value):
            raise ValueError(f'{key}: use 64 caracteres hexadecimais gerados aleatoriamente')
        values[key] = value
    if values['TRUSTED_PROXY_SECRET'] == values['AUTH_RATE_LIMIT_SECRET']:
        raise ValueError('Os segredos do proxy e do contador devem ser independentes')
    if content != original:
        stat = env_file.stat()
        descriptor, temporary = tempfile.mkstemp(prefix='.orbit-origin-', dir=env_file.parent)
        try:
            os.fchmod(descriptor, 0o600)
            os.fchown(descriptor, stat.st_uid, stat.st_gid)
            with os.fdopen(descriptor, 'w') as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, env_file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    os.chmod(env_file, 0o600)
    include_file.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.orbit-origin-', dir=include_file.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write('proxy_set_header X-Orbit-Proxy-Secret "' + values['TRUSTED_PROXY_SECRET'] + '";\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, include_file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Execute com sudo; o include privado fica em /etc/nginx.')
    configure(Path('/opt/stacks/orbit/.env'), Path('/etc/nginx/orbit-proxy-secret.inc'))
    print('Segredos preservados/gerados e include privado instalado. Nenhum segredo foi exibido.')
