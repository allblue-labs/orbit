#!/usr/bin/env bash
# Executar no Mac/CI; nunca no servidor. Um repositório privado, três tags.
set -Eeuo pipefail
cd "$(dirname "$0")/../../.."
[[ -z $(git status --porcelain) ]] || { echo 'Faça commit das alterações antes de gerar imagens.' >&2; exit 1; }
sha=$(git rev-parse HEAD)
tag="staging-${sha:0:12}"
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
for component in api migrator frontend; do
    case "$component" in
        api) context=backend; target=runner ;;
        migrator) context=backend; target=migrator ;;
        frontend) context=frontend; target=runner ;;
    esac
    image="$repository:$tag-$component"
    # Digest é obtido do próprio resultado do push, não de uma tag mutável.
    docker buildx build --builder "$builder" --platform linux/amd64 --pull --provenance=mode=min \
        --target "$target" --build-arg "ORBIT_COMMIT_SHA=$sha" \
        --build-arg "ORBIT_BUILD_TIME=$created" --tag "$image" \
        --metadata-file "$output/$component.json" --push "$context"
done
python3 - "$output" "$repository" "$tag" "$sha" "$created" <<'PY'
import json, pathlib, re, sys
p=pathlib.Path(sys.argv[1]); repository, tag, sha, created=sys.argv[2:]
services={'api':'api', 'migrate':'migrator', 'bootstrap-admin':'migrator', 'frontend':'frontend'}
lock=['# Referências imutáveis publicadas no Docker Hub privado.', 'services:']
manifest={'commit': sha, 'created': created, 'tag': tag, 'images': {}}
for service, component in services.items():
    digest=json.loads((p/(component+'.json')).read_text())['containerimage.digest']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',digest): raise SystemExit('Digest inválido.')
    reference=repository+'@'+digest
    lock += ['  '+service+':', '    image: '+reference]
    manifest['images'][service]={'tag': repository+':'+tag+'-'+component, 'digest': reference}
(p/'docker-compose.lock.yml').write_text('\n'.join(lock)+'\n')
(p/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Release publicada:', tag, '\nLock:', p/'docker-compose.lock.yml')
PY
