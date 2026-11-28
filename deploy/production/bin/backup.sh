#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
cd /opt/stacks/orbit
exec 9>/run/lock/orbit-backup.lock
flock -n 9 || { echo 'Outro backup do Orbit está em execução.' >&2; exit 1; }

export ORBIT_BACKUP_IMAGE
ORBIT_BACKUP_IMAGE=$(python3 -c '
import json, re, sys
release = json.load(open("release.json"))
ref = release.get("images", {}).get("backup", {}).get("digest", "")
if release.get("deployment") != "production" or not re.fullmatch(r"docker\.io/allbluelabs/orbit-api@sha256:[a-f0-9]{64}", ref):
    sys.exit("A rotina requer uma release de produção com digest de backup.")
print(ref)
')
cadence=daily
[[ $(date -u +%u) != 7 ]] || cadence=weekly
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml -f docker-compose.backup.yml --profile backup)
api=$(docker compose --env-file .env ps --all --quiet api)
if [[ -z "$api" ]] || ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api" | grep -Fx 'ORBIT_DEPLOYMENT=production' >/dev/null; then
    echo 'O host ainda não tem um contêiner Orbit de produção.' >&2
    exit 1
fi
"${compose[@]}" pull backup
"${compose[@]}" run --rm --no-deps -T backup backup "$cadence"
