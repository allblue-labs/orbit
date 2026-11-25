#!/usr/bin/env bash
# Executar no Mac/CI; nunca no servidor. Um repositório privado. A imagem de backup é opcional.
set -Eeuo pipefail
cd "$(dirname "$0")/../../.."
[[ -z $(git -c core.fsmonitor=false status --porcelain) ]] || { echo 'Faça commit das alterações antes de gerar imagens.' >&2; exit 1; }
sha=$(git rev-parse HEAD)
deployment=${ORBIT_RELEASE_DEPLOYMENT:-staging}
case "$deployment" in staging|production) ;; *) echo 'Ambiente de release inválido.' >&2; exit 1 ;; esac
if [[ -n ${NEXT_PUBLIC_SENTRY_DSN:-} && ${NEXT_PUBLIC_SENTRY_ENVIRONMENT:-} != "$deployment" ]]; then
    echo 'NEXT_PUBLIC_SENTRY_ENVIRONMENT deve corresponder ao ambiente da release.' >&2
    exit 1
fi
tag="$deployment-${sha:0:12}"
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
repository=docker.io/allbluelabs/orbit-api
output=${ORBIT_RELEASE_OUTPUT:?Informe ORBIT_RELEASE_OUTPUT fora do repositório}
mkdir -p "$output"
# O driver docker clássico não suporta atestações em todos os Docker Desktop.
# Um builder dedicado evita mudar o builder selecionado de outros projetos.
builder=${ORBIT_BUILDX_BUILDER:-orbit-staging}
if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
    docker buildx create --name "$builder" --driver docker-container >/dev/null
fi
components=(api migrator frontend pgbouncer)
if [[ ${ORBIT_BUILD_BACKUP_IMAGE:-false} == true ]]; then components+=(backup); fi
for component in "${components[@]}"; do
    case "$component" in
        backup) context=backend; target=backup ;;
        api) context=backend; target=runner ;;
        migrator) context=backend; target=migrator ;;
        frontend) context=frontend; target=runner ;;
        pgbouncer) context=deploy/pgbouncer; target=runner ;;
    esac
    image="$repository:$tag-$component"
    build_args=(--target "$target")
    if [[ $component == frontend ]]; then
        build_args+=(--build-arg NEXT_PUBLIC_SENTRY_DSN --build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT)
    fi
    # Digest é obtido do próprio resultado do push, não de uma tag mutável.
    docker buildx build "${build_args[@]}" --builder "$builder" --platform linux/amd64 --pull --provenance=mode=min \
        --build-arg "ORBIT_COMMIT_SHA=$sha" \
        --build-arg "ORBIT_BUILD_TIME=$created" --tag "$image" \
        --metadata-file "$output/$component.json" --push "$context"
done
python3 - "$output" "$repository" "$tag" "$sha" "$created" "${ORBIT_BUILD_BACKUP_IMAGE:-false}" "$deployment" <<'PY'
import json, pathlib, re, sys
p=pathlib.Path(sys.argv[1]); repository, tag, sha, created, include_backup, deployment=sys.argv[2:]
services={'api':'api', 'worker':'api', 'documents':'api', 'migrate':'migrator', 'bootstrap-admin':'migrator', 'storage-migration':'migrator', 'frontend':'frontend', 'pgbouncer':'pgbouncer'}
lock=['# Referências imutáveis publicadas no Docker Hub privado.', 'services:']
manifest={'commit': sha, 'created': created, 'tag': tag, 'deployment': deployment, 'images': {}}
for service, component in services.items():
    digest=json.loads((p/(component+'.json')).read_text())['containerimage.digest']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',digest): raise SystemExit('Digest inválido.')
    reference=repository+'@'+digest
    lock += ['  '+service+':', '    image: '+reference]
    if service == 'storage-migration':
        lock += ['    profiles: [storage-migration]']
    manifest['images'][service]={'tag': repository+':'+tag+'-'+component, 'digest': reference}
if include_backup == 'true':
    backup_digest=json.loads((p/'backup.json').read_text())['containerimage.digest']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', backup_digest): raise SystemExit('Digest inválido para backup.')
    manifest['images']['backup']={'tag': repository+':'+tag+'-backup', 'digest': repository+'@'+backup_digest}
(p/'docker-compose.lock.yml').write_text('\n'.join(lock)+'\n')
(p/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Release publicada:', tag, '\nLock:', p/'docker-compose.lock.yml')
PY
