#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/stacks/orbit
[[ -f .env && -f docker-compose.lock.yml && -f release.json ]] || { echo 'Configure .env, docker-compose.lock.yml e release.json antes.' >&2; exit 1; }
[[ $(stat -c '%a' .env) == 600 ]] || { echo 'Use chmod 600 .env.' >&2; exit 1; }
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml)
"${compose[@]}" config --quiet
"${compose[@]}" --profile admin config --format json | python3 "$(dirname "$(readlink -f "$0")")/deployment_preflight.py"
# Valida sem imprimir valores e impede Stripe real neste staging.
python3 - <<'PY'
import base64, json, re, subprocess, sys
from pathlib import Path
x=json.loads(subprocess.check_output(['docker','compose','--env-file','.env','-f','docker-compose.yml','-f','docker-compose.lock.yml','config','--format','json']))
env=x['services']['api']['environment']
web=x['services']['frontend']['environment']
origin='https://orbit.allblue-labs.com'
for key, value in [('FRONTEND_ORIGIN',origin),('IDENTITY_PUBLIC_WEB_URL',origin),('STORAGE_PUBLIC_API_URL',origin+'/api/v1')]:
    if env.get(key) != value: sys.exit('Corrija a URL pública de staging: '+key)
if web.get('FRONTEND_ORIGIN') != origin: sys.exit('Use uma única origem HTTPS no frontend.')
if str(web.get('AUTH_COOKIE_SECURE')).lower() != 'true' or str(web.get('ALLOW_INSECURE_LOCAL_COOKIES')).lower() != 'false':
    sys.exit('Staging exige cookies Secure e proíbe a exceção de HTTP local.')
if not env.get('APP_DATABASE_URL') or any(env.get(k) for k in ['DATABASE_URL','POSTGRES_PASSWORD','PLATFORM_ADMIN_PASSWORD','OWNER_PASSWORD']):
    sys.exit('O runtime não pode receber credenciais administrativas.')
release=json.loads(Path('release.json').read_text())
commit=release.get('commit', '')
if not re.fullmatch(r'[a-f0-9]{40}', commit) or release.get('tag') != 'staging-'+commit[:12]:
    sys.exit('Revisão de staging inválida em release.json.')
for service in ('api', 'worker', 'documents', 'migrate', 'frontend'):
    image=x['services'][service]['image']
    if image != release.get('images', {}).get(service, {}).get('digest'):
        sys.exit('A imagem do lock difere de release.json: '+service)
zone=str(env.get('CLOUDFLARE_CACHE_PURGE_ZONE_ID', '')).strip()
token=str(env.get('CLOUDFLARE_CACHE_PURGE_TOKEN', '')).strip()
if (zone or token) and (not token or not re.fullmatch(r'[a-f0-9]{32}',zone)):
    sys.exit('Preencha as duas variáveis de expurgo Cloudflare com um Zone ID válido.')
required=['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ENDPOINT','R2_PUBLIC_URL','R2_BUCKET_NAME','R2_PRIVATE_BUCKET_NAME','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','AWS_SES_FROM_EMAIL','EMAIL_SUPPRESSION_HASH_KEY']
if str(env.get('AWS_SES_FEEDBACK_ENABLED','false')).lower() == 'true':
    required += ['AWS_SES_CONFIGURATION_SET','AWS_SES_FEEDBACK_ACCOUNT_ID','AWS_SES_FEEDBACK_TOPIC_ARN','AWS_SES_FEEDBACK_IDENTITY_ARN']
missing=[key for key in required if not str(env.get(key,'')).strip()]
if missing: sys.exit('Preencha as variáveis: '+', '.join(missing))
try:
    if len(base64.b64decode(env['EMAIL_SUPPRESSION_HASH_KEY'], validate=True)) != 32: raise ValueError()
except (ValueError, TypeError):
    sys.exit('EMAIL_SUPPRESSION_HASH_KEY deve ser uma chave própria de 32 bytes em base64.')
if str(env.get('STRIPE_ENABLED','')).lower() == 'true' and not str(env.get('STRIPE_SECRET_KEY','')).startswith(('sk_test_', 'rk_test_')):
    sys.exit('Staging aceita somente chave de teste do Stripe.')
if any('build' in s for s in x['services'].values()): sys.exit('Build no servidor não é permitido.')
if x['services']['postgres'].get('ports'): sys.exit('PostgreSQL não deve publicar portas.')
for name in ['api','frontend']:
    if any(p.get('host_ip') != '127.0.0.1' for p in x['services'][name].get('ports',[])):
        sys.exit('Porta interna exposta: '+name)
    expected='6001' if name=='api' else '7070'
    if [str(p.get('published')) for p in x['services'][name].get('ports',[])] != [expected]:
        sys.exit('A porta não corresponde ao upstream Nginx: '+name)
print('Preflight concluído; segredos não foram exibidos.')
PY
if [[ ${1:-} == --check ]]; then
    exit 0
fi
"${compose[@]}" pull
# Preserve os segredos e faça o Compose sem -f usar a mesma release.
python3 - <<'PYENV'
import json, os, re, subprocess, tempfile
from pathlib import Path

target = Path('.env')
release = json.loads(Path('release.json').read_text())
settings = {
    'COMPOSE_FILE': 'docker-compose.yml:docker-compose.lock.yml',
    'ORBIT_VERSION': release['tag'],
}
lines = [
    line for line in target.read_text().splitlines(keepends=True)
    if not any(re.match(r'^\s*(?:export\s+)?'+key+r'\s*=', line) for key in settings)
]
fd, filename = tempfile.mkstemp(prefix='.env.release-', dir='.')
try:
    with os.fdopen(fd, 'w') as out:
        out.write(''.join(lines).rstrip('\n') + '\n')
        for key, value in settings.items():
            out.write(f'{key}={value}\n')
    preview = json.loads(subprocess.check_output(
        ['docker', 'compose', '--env-file', filename, 'config', '--format', 'json']
    ))
    for service in ('api', 'worker', 'documents', 'migrate', 'frontend'):
        if preview['services'].get(service, {}).get('image') != release['images'][service]['digest']:
            raise SystemExit('O Compose padrão não carrega o lock para '+service)
    os.replace(filename, target)
finally:
    Path(filename).unlink(missing_ok=True)
PYENV
"${compose[@]}" up -d --wait postgres
# Migração é um serviço efêmero; up aguarda seu exit 0 antes de iniciar a API.
"${compose[@]}" up -d --wait --wait-timeout 180 api frontend worker documents
"${compose[@]}" ps
expected_revision=$(python3 -c 'import json; print(json.load(open("release.json"))["commit"])')
for service in api worker documents migrate frontend; do
    container=$("${compose[@]}" ps --all --quiet "$service")
    revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")
    [[ "$revision" == "$expected_revision" ]] || { echo "Revisão em execução incorreta: $service" >&2; exit 1; }
done
echo "Revisão aplicada: $expected_revision"
curl --fail --silent --show-error http://127.0.0.1:6001/health/ready
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:7070/login
echo 'API e frontend respondendo localmente. Valide o HTTPS antes de liberar usuários.'
