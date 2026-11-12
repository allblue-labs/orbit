#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/stacks/orbit
[[ -f .env && -f docker-compose.lock.yml ]] || { echo 'Configure .env e o lock de imagens antes.' >&2; exit 1; }
[[ $(stat -c '%a' .env) == 600 ]] || { echo 'Use chmod 600 .env.' >&2; exit 1; }
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml)
"${compose[@]}" config --quiet
# Valida sem imprimir valores e impede Stripe real neste staging.
python3 - <<'PY'
import json, subprocess, sys
x=json.loads(subprocess.check_output(['docker','compose','--env-file','.env','-f','docker-compose.yml','-f','docker-compose.lock.yml','config','--format','json']))
env=x['services']['api']['environment']
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
print('Preflight concluído; segredos não foram exibidos.')
PY
"${compose[@]}" pull
"${compose[@]}" up -d --wait postgres
# Migração é um serviço efêmero; up aguarda seu exit 0 antes de iniciar a API.
"${compose[@]}" up -d --wait --wait-timeout 180 api frontend
"${compose[@]}" ps
curl --fail --silent --show-error http://127.0.0.1:6001/health/ready
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:7070/login
echo 'API e frontend respondendo localmente. Valide o HTTPS antes de liberar usuários.'
