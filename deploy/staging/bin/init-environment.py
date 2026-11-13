#!/usr/bin/env python3
"""Cria .env 0600 uma única vez; não lê nem copia credenciais de produção."""
import base64
import os
from pathlib import Path
import secrets

target = Path('/opt/stacks/orbit/.env')
template = target.with_name('.env.example')
settings = {
    'POSTGRES_USER': 'orbit_admin',
    'POSTGRES_DB': 'orbit_staging',
    'POSTGRES_PASSWORD': secrets.token_hex(32),
    'APP_DATABASE_PASSWORD': secrets.token_hex(32),
    'JWT_ACCESS_SECRET': secrets.token_hex(48),
    'TRIAL_FINGERPRINT_SECRET': secrets.token_hex(48),
    'TRUSTED_PROXY_SECRET': secrets.token_hex(32),
    'AUTH_RATE_LIMIT_SECRET': secrets.token_hex(32),
    'ENCRYPTION_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
    'FRONTEND_ORIGIN': 'https://orbit.allblue-labs.com',
    'IDENTITY_PUBLIC_WEB_URL': 'https://orbit.allblue-labs.com',
    'STORAGE_PUBLIC_API_URL': 'https://orbit.allblue-labs.com/api/v1',
    'AWS_REGION': 'us-east-2',
    'AWS_SES_FROM_EMAIL': '',
    'PLATFORM_ADMIN_EMAIL': '',
    'PLATFORM_ADMIN_PASSWORD': '',
    'PUSH_PROVIDER': 'disabled',
    'STRIPE_ENABLED': 'false',
}
lines = []
for line in template.read_text().splitlines():
    key = line.partition('=')[0]
    lines.append(f'{key}={settings[key]}' if key in settings else line)
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write('\n'.join(lines) + '\n')
print('Arquivo criado com segredos exclusivos do staging:', target)
print('Preencha as variáveis AWS_* e R2_* sem enviar credenciais pelo chat.')
