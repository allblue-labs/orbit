#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $# == 1 ]] || { echo 'Uso: publish-web-static.sh CAMINHO/release.json' >&2; exit 1; }
script_dir=$(cd "$(dirname "$0")" && pwd)
image=$(python3 - "$1" <<'PY'
import json, re, sys
with open(sys.argv[1]) as source:
    release = json.load(source)
ref = release["images"]["frontend"]["digest"]
if (
    release.get("deployment") != "production"
    or not re.fullmatch(r"docker\.io/allbluelabs/orbit-api@sha256:[a-f0-9]{64}", ref)
):
    sys.exit("É necessário um manifesto de produção com digest válido do frontend.")
print(ref)
PY
)
work=$(mktemp -d)
container=
cleanup() {
    if [[ -n "$container" ]]; then docker rm "$container" >/dev/null; fi
    rm -rf -- "$work"
}
trap cleanup EXIT
docker pull --platform linux/amd64 "$image"
container=$(docker create --platform linux/amd64 "$image")
docker cp "$container:/app/.next/static" "$work/static"
node "$script_dir/publish-web-static.mjs" "$work/static"
