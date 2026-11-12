#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/stacks/orbit
[[ -f .env && -f docker-compose.lock.yml ]] || { echo 'Configure .env e o lock de imagens antes.' >&2; exit 1; }
[[ $(stat -c '%a' .env) == 600 ]] || { echo 'Use chmod 600 .env.' >&2; exit 1; }
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml)
"${compose[@]}" config --quiet
# Valida sem imprimir valores e impede Stripe real neste staging.
python3 - <<'PY'
import json, re, subprocess, sys
x=json.loads(subprocess.check_output(['docker','compose','--env-file','.env','-f','docker-compose.yml','-f','docker-compose.lock.yml','config','--format','json']))
env=x['services']['api']['environment']
web=x['services']['frontend']['environment']
origin='https://orbit.allblue-labs.com'
for key, value in [('FRONTEND_ORIGIN',origin),('IDENTITY_PUBLIC_WEB_URL',origin),('STORAGE_LOCAL_PUBLIC_URL',origin+'/api/v1')]:
    if env.get(key) != value: sys.exit('Corrija a URL pública de staging: '+key)
if web.get('FRONTEND_ORIGIN') != origin: sys.exit('Use uma única origem HTTPS no frontend.')
if str(web.get('AUTH_COOKIE_SECURE')).lower() != 'true' or str(web.get('ALLOW_INSECURE_LOCAL_COOKIES')).lower() != 'false':
    sys.exit('Staging exige cookies Secure e proíbe a exceção de HTTP local.')
if env.get('DATABASE_URL') != env.get('APP_DATABASE_URL') or env.get('PLATFORM_ADMIN_PASSWORD'):
    sys.exit('O runtime não pode receber credenciais administrativas.')
for service in ['api','migrate','frontend']:
    if not re.search(r'@sha256:[a-f0-9]{64}$',x['services'][service]['image']):
        sys.exit('Use uma imagem por digest no lock: '+service)
required=['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','AWS_SES_FROM_EMAIL']
missing=[key for key in required if not str(env.get(key,'')).strip()]
if missing: sys.exit('Preencha as variáveis: '+', '.join(missing))
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
"${compose[@]}" up -d --wait postgres
# Migração é um serviço efêmero; up aguarda seu exit 0 antes de iniciar a API.
"${compose[@]}" up -d --wait --wait-timeout 180 api frontend
"${compose[@]}" ps
curl --fail --silent --show-error http://127.0.0.1:6001/health/ready
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:7070/login
echo 'API e frontend respondendo localmente. Valide o HTTPS antes de liberar usuários.'
